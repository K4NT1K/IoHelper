import test from 'node:test';
import assert from 'node:assert/strict';
import {App} from '../modules/App.js';
import {NativeTicketMethods} from '../modules/ticket/NativeData.js';
import {NativeDataStore} from '../modules/native/Store.js';

const id = '76561198000000001', other = '76561198000000002';

for (const match of [false, true]) {
    test(`Tracker player response updates only its visible detail (match=${match}) without scanning hidden chats`, () => {
        const calls = [], textarea = {}, scope = {};
        const ctx = {features: {showFaceitElo: true, showCybershokePlaytime: true, processTicketRules: true, translateText: true},
            document: {querySelectorAll() {calls.push('all-textareas'); return [];}},
            ticketService: {consumeNativeEvent: () => calls.push('consume'),
                findVisibleTicketResolutionTextarea: () => textarea, getTicketScopeRoot: () => scope,
                getNativeTicket: () => ({suspectId: match ? id : other}),
                refreshComplaintPunishmentButtons: () => calls.push('buttons'),
                renderFaceitElo: () => calls.push('faceit'), renderOffenderProjectInfo: () => calls.push('profile')},
            messageService: {processChatMessages: () => calls.push('chat')},
            maybeAutoConnectOnTicketMount: () => calls.push('connect-guard'),
            ensureTicketChatHistoryObserver: value => {assert.equal(value, textarea); calls.push('analysis');},
            _reapplyTicketRowHighlights: () => calls.push('all-rows')};
        App.prototype.handleNativeDataEvent.call(ctx, {source: 'tracker', kind: 'player', payload: {steamId: id}});
        assert.deepEqual(calls, match ? ['consume', 'connect-guard', 'buttons', 'faceit', 'profile', 'analysis'] : ['consume']);
        calls.length = 0;
        App.prototype.handleNativeDataEvent.call(ctx, {kind: 'history', payload: {steamId: id}});
        assert(calls.includes('chat') && calls.includes('all-rows'), 'Site chat events keep the normal analysis/translation path');
    });
}

test('Scoped queue render decorates only rows containing the changed player, as suspect or sender', () => {
    const tickets = [{senderId: other, suspectId: id}, {senderId: id, suspectId: other}, {senderId: other, suspectId: other}];
    const visited = [];
    const rows = tickets.map(ticket => ({ticket, classList: {toggle() {}},
        querySelectorAll: () => [ticket.senderId, ticket.suspectId].map(value => ({href: `https://cybershoke.net/id/${value}`}))}));
    const ctx = {nativeData: {}, settings: {features: {trackOffenderServer: false}},
        findComplaintQueueTables: () => [{querySelectorAll: () => rows}],
        getNativeRowTicket(row) {visited.push(row); return row.ticket;}, nativePlayer: () => ({}), renderNativeParticipant: () => false};
    NativeTicketMethods.renderNativeQueue.call(ctx, {steamIds: new Set([id])});
    assert.deepEqual(visited, rows.slice(0, 2));
});

test('Queue identity inventory is reused across player polling and refreshed on queue/detail/clear', () => {
    const store = new NativeDataStore(); let sequence = 0;
    const apply = (kind, payload) => store.apply({version: 1, kind, key: kind === 'queue' ? 'queue' : kind + ':' + id,
        startedAt: ++sequence, receivedAt: sequence, sequence, payload});
    const ticket = {key: 'ticket:1', id: 1, senderId: other, suspectId: id};
    apply('queue', {entity: 'ticket', items: [ticket]});
    const inventory = store.queueTickets();
    for (let i = 0; i < 1000; i++) {
        apply('player', {steamId: id, playtime: i});
        assert.equal(store.queueTickets(), inventory);
    }
    apply('ticket', {...ticket, reason: 'Спам'});
    assert.notEqual(store.queueTickets(), inventory);
    assert.equal(store.queueTickets()[0].reason, 'Спам');
    apply('queue', {entity: 'ticket', items: []});
    assert.deepEqual(store.queueTickets(), []);
    store.clear(); assert.deepEqual(store.queueTickets(), []);
});
