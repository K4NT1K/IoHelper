import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeDataStore} from '../modules/native/Store.js';
import {describeRequest, normalizeResponse} from '../modules/native/model.js';
import {NativeTicketMethods} from '../modules/ticket/NativeData.js';
import {OffenderProfileMethods} from '../modules/ticket/OffenderProfile.js';
import {MessageService} from '../modules/MessageService.js';

const id = '76561198000000001', sender = '76561198000000002', origin = 'https://io.cybershoke.net';
const complaint = {id: 1, steamid64_suspect: id, steamid64_sender: sender, reason: 'ReasonPlayer_ViolatingRules', status: 1};
function event(path, raw, data, sequence = 1) {
    return normalizeResponse(describeRequest({baseURL: origin + '/api', url: path, method: data ? 'post' : 'get', data}, origin), raw,
        {startedAt: sequence, receivedAt: sequence, sequence});
}

test('Complete report without suspect_notice becomes analysis-ready after the three successful histories; queue alone does not', () => {
    const store = new NativeDataStore();
    store.apply(event('/reports/list', [complaint]));
    const ctx = {...NativeTicketMethods, nativeData: store, getNativeTicket: () => store.tickets.get('report:1')};
    assert.equal(ctx.nativeAnalysisReady({}), false);
    store.apply(event('/reports/get/1', {result: 'success', json: complaint}, null, 2));
    assert.deepEqual(store.tickets.get('report:1').warnings, []);
    for (const resource of ['bans', 'mutes', 'chats']) store.apply(event(`/ticket/${resource}/history`, [], {data: {steamid64: id}}, 3));
    assert.equal(ctx.nativeAnalysisReady({}), true);
    const ticket = event('/ticket/get/1', {json: complaint}, null, 4);
    assert.equal(Object.hasOwn(ticket.payload, 'warnings'), false, 'The report schema default does not invent ticket warnings');
});

test('Partial null playtime cannot erase known zero or positive hours in either player or complaint', () => {
    for (const playtime of [0, 370, 25200]) {
        const store = new NativeDataStore();
        store.apply(event('/reports/list', [{...complaint, playtime_suspect: playtime}]));
        store.mergePlayer(id, {playtime: null}, {startedAt: 2, receivedAt: 2, sequence: 2});
        store.apply(event('/reports/list', [{...complaint, playtime_suspect: null}], null, 3));
        assert.equal(store.player(id).playtime, playtime);
        assert.equal(store.tickets.get('report:1').playtime, playtime);
    }
});

test('New-account highlights use current player data, preserve zero and floor hours like the visible site label', () => {
    const service = new MessageService({document: {}, utils: {}, badgeService: {}, settings: {newAccountHours: 7}});
    let current, ticket, highlighted;
    const native = {...NativeTicketMethods, nativeData: {player: () => current}};
    service.ticketService = {...native, getNativeRowTicket: () => ticket};
    service._applyNativeRowHoursHighlight = () => {highlighted = true;};
    service._clearRowHoursHighlight = () => {highlighted = false;};
    for (const [playerTime, queueTime, expected, hours] of [
        [0, null, true, 0], [370, null, true, 0], [null, 0, true, 0], [28799, 0, true, 7], [28800, 0, false], [null, null, false]
    ]) {
        current = {playtime: playerTime}; ticket = {suspectId: id, playtime: queueTime};
        const row = {dataset: {}}; highlighted = !expected;
        service.highlightNewAccounts(row);
        assert.equal(highlighted, expected);
        if (expected) assert.equal(row.dataset.iohNewAccountHours, String(hours));
    }
});

function profileFixture(queueTime, playerTime, responseTime) {
    const store = new NativeDataStore(); let calls = 0, errors = 0;
    if (playerTime !== undefined) store.mergePlayer(id, {playtime: playerTime}, {startedAt: 1, receivedAt: 1, sequence: 1});
    const context = {offenderSteamId: id, offenderField: {}, scope: {}};
    const value = {textContent: '', classList: {remove() {}}, closest: () => ({})};
    const service = {...OffenderProfileMethods, ...NativeTicketMethods, nativeData: store,
        settings: {features: {showCybershokePlaytime: true, showOffenderCountry: false}},
        getOffenderFieldContext: () => context, getNativeTicket: () => ({suspectId: id, playtime: queueTime}),
        clearOffenderCountry() {}, ensureCybershokePlaytimeNode: () => value,
        renderProfileFieldError() {errors++;},
        async fetchParsedUserData() {calls++; store.mergePlayer(id, {playtime: responseTime}, {startedAt: 2, receivedAt: 2, sequence: 2});}
    };
    return {service, store, value, calls: () => calls, errors: () => errors};
}

test('Opened complaint shows known zero from either queue or user/data without a redundant request', async () => {
    for (const [queueTime, playerTime] of [[0, undefined], [undefined, 0], [undefined, 370]]) {
        const f = profileFixture(queueTime, playerTime, undefined);
        await f.service.renderOffenderProjectInfo();
        assert.equal(f.value.textContent, '0ч'); assert.equal(f.calls(), 0);
    }
});

test('Incomplete profile response exposes retry without a request loop; retry can recover a valid zero', async () => {
    const f = profileFixture(undefined, undefined, null);
    await f.service.renderOffenderProjectInfo();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(f.calls(), 1); assert(f.errors() > 0);
    for (let i = 0; i < 5; i++) await f.service.renderOffenderProjectInfo({force: true});
    assert.equal(f.calls(), 1, 'Tracker refresh must not restart a failed profile on each response');
    f.service._nativeProfileLoads.delete(id);
    f.service.fetchParsedUserData = async () => f.store.mergePlayer(id, {playtime: 0}, {startedAt: 3, receivedAt: 3, sequence: 3});
    await f.service.renderOffenderProjectInfo();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(f.value.textContent, '0ч');
});
