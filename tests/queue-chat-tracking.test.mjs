import test from 'node:test';
import assert from 'node:assert/strict';
import {TicketService} from '../modules/TicketService.js';
import {Utils} from '../modules/Utils.js';
import {QUEUE_CHAT_CHANNEL} from '../modules/native/QueueChatClient.js';
import {App} from '../modules/App.js';
import {clock, deferred} from './clock.mjs';

const day = 86400000;
const player = index => String(76561198000000000n + BigInt(index));
const toxic = (timeMs = Date.now() - 1000) => ({text: 'toxic', timeMs, channel: 'all'});
function classes() {
    const values = new Set();
    return {contains: value => values.has(value), add: (...items) => items.forEach(item => values.add(item)),
        remove: (...items) => items.forEach(item => values.delete(item)),
        toggle(value, on) {if (on ?? !values.has(value)) values.add(value); else values.delete(value);}};
}

function fixture(t, reasons = ['Нарушение правил'], {samePlayer = false, userData = {}, onRead} = {}) {
    const view = new EventTarget();
    Object.assign(view, {location: {pathname: '/support/tickets', href: 'https://io.cybershoke.net/support/tickets', origin: 'https://io.cybershoke.net'},
        crypto: globalThis.crypto, Icons: {warning: '<svg id="warning"/>', mute: '<svg id="mute"/>', ban: '<svg id="ban"/>'}});
    globalThis.window = view;
    const rows = reasons.map((reason, index) => {
        const id = player(samePlayer ? 0 : index);
        const offenderLink = {href: `https://cybershoke.net/${id}`};
        const serverLink = {href: 'steam://connect/127.0.0.1:27015'};
        const control = {innerHTML: 'Принять тикет', dataset: {}, classList: classes()};
        return {dataset: {iohNativeTicket: `ticket:${index + 1}`}, classList: classes(), isConnected: true,
            ticket: {key: `ticket:${index + 1}`, suspectId: id, reason, status: 0}, offenderLink, serverLink, control,
            querySelector(selector) {
                if (selector.startsWith('td:nth-child(4)')) return offenderLink;
                if (selector.startsWith('td:nth-child(2)')) return serverLink;
                if (selector === '.ioh-punishment-action') return control.classList.contains('ioh-punishment-action') ? control : null;
                return null;
            },
            querySelectorAll(selector) {
                if (selector === '.ioh-punishment-action') return control.classList.contains('ioh-punishment-action') ? [control] : [];
                return [];
            }};
    });
    const reads = [], requests = [], updates = [], jobs = [];
    const service = new TicketService({document: {hidden: false, querySelectorAll: selector => selector === 'tr.ioh-highlighted-chat-mute'
        ? rows.filter(row => row.classList.contains('ioh-highlighted-chat-mute')) : rows},
        utils: new Utils({document: {}}), badgeService: {}, nativeData: {},
        settings: {features: {trackOffenderServer: true, processTicketRules: false}},
        rules: [{name: 'Токсичность', duration: 720, severity: 7, keywords: ['toxic']},
            {name: 'Оскорбление', duration: 360, severity: 5, keywords: ['insult']},
            {name: 'Спам в микрофон/чат', duration: 360, severity: 2, keywords: []}]});
    Object.assign(service, {
        getNativeRowTicket: row => row.ticket,
        getCachedUserData: () => null,
        async fetchParsedUserData(id) {requests.push(id); return {serverIp: '127.0.0.1:27015', isMuted: false, isBanned: false, ...userData};},
        ensureServerLinkOriginalIp: () => '127.0.0.1:27015',
        scheduleOffenderUi: job => jobs.push(job),
        applyOffenderServerStatus: (_link, id, _ip, data) => updates.push({id, data}),
        applyOffenderVipBadge() {}, applyOffenderProfileVerification() {}, renderNativeQueue() {},
        getRowActionControl: row => row.control,
        applyOffenderMuteBanIcons: (_link, row, data) => service.applyOffenderPunishmentActionLabel(row, data)
    });
    const emit = (request, result = {}) => {
        const event = new Event('message');
        Object.assign(event, {source: view, origin: view.location.origin, data: {channel: QUEUE_CHAT_CHANNEL,
            nonce: request.nonce, steamId: request.steamId, type: result.code ? 'error' : 'result',
            ...result}});
        view.dispatchEvent(event);
    };
    view.postMessage = request => {
        if (request.type !== 'read') return;
        reads.push(request);
        Promise.resolve().then(async () => {
            const result = onRead ? await onRead(request) : {messages: [toxic()]};
            if (result) emit(request, result);
        });
    };
    const flushUi = () => jobs.splice(0).forEach(job => job());
    t.after(() => {service.stopQueueChatTracking(); view.dispatchEvent(new Event('pagehide')); delete globalThis.window;});
    return {service, rows, view, reads, requests, updates, jobs, emit, flushUi,
        run: options => service.checkOffendersServers(5000, options)};
}

for (const reason of ['Нарушение правил', 'Мониторинг', 'Спам', 'Попрошайничество', 'Читерство', 'Багоюз', '']) {
    test(`Queue integration: chat request and warning decoration use category «${reason}»`, async t => {
        const time = clock(t), f = fixture(t, [reason]);
        await time.finish(f.run()); f.flushUi();
        const expected = ['Нарушение правил', 'Мониторинг', 'Спам', 'Попрошайничество'].includes(reason);
        assert.equal(f.reads.length, expected ? 1 : 0);
        assert.equal(f.updates.length, 1, 'Presence tracking runs for every category');
        assert.equal(f.rows[0].classList.contains('ioh-highlighted-chat-mute'), expected);
        assert.equal(f.rows[0].control.dataset.iohPunishmentAction, expected ? 'warning' : undefined);
        if (expected) {
            assert.match(f.rows[0].control.innerHTML, /id="warning"/);
            assert.match(f.rows[0].control.innerHTML, /НУЖЕН МУТ/);
        }
        assert.equal(f.service.settings.features.processTicketRules, false, 'Queue checking is independent of the detail analysis flag');
    });
}

for (const [status, type, tint] of [
    [{isMuted: true}, 'mute', 'ioh-highlighted-muted'],
    [{isMuted: true, isBanned: true}, 'ban', 'ioh-highlighted-banned']
]) {
    test(`Queue integration: active ${type} takes precedence over fresh chat`, async t => {
        const time = clock(t), f = fixture(t, ['Нарушение правил'], {userData: status});
        await time.finish(f.run()); f.flushUi();
        assert.equal(f.rows[0].control.dataset.iohPunishmentAction, type);
        assert.equal(f.rows[0].classList.contains(tint), true);
        assert.equal(f.rows[0].classList.contains('ioh-highlighted-chat-mute'), false);
        assert.match(f.rows[0].control.innerHTML, new RegExp(`id="${type}"`));
    });
}

test('Queue integration: warning verdict does not decorate; a fresh mute verdict does', async t => {
    const time = clock(t), f = fixture(t, ['Нарушение правил'], {onRead: () => ({messages: [{...toxic(), text: 'insult'}]})});
    await time.finish(f.run()); f.flushUi();
    assert.equal(f.service.getQueueChatVerdict(f.rows[0]).kind, 'warning');
    assert.equal(f.rows[0].control.innerHTML, 'Принять тикет');
    assert.equal(f.rows[0].classList.contains('ioh-highlighted-chat-mute'), false);
    f.service._queueChatCache.set(player(0), {messages: [toxic()], fetchedAt: Date.now()});
    f.service.applyOffenderPunishmentHighlight(f.rows[0], {});
    f.service.applyOffenderPunishmentActionLabel(f.rows[0], {});
    assert.equal(f.rows[0].classList.contains('ioh-highlighted-chat-mute'), true);
    assert.equal(f.rows[0].control.dataset.iohPunishmentAction, 'warning');
});

test('Queue integration: inclusive day boundary expires cached verdict and restores the native action', async t => {
    const time = clock(t); await time.advance(day * 2);
    const f = fixture(t), row = f.rows[0], messages = [toxic(Date.now() - day)];
    f.service._queueChatCache = new Map([[player(0), {messages, fetchedAt: Date.now()}]]);
    f.service.applyOffenderPunishmentHighlight(row, {}); f.service.applyOffenderPunishmentActionLabel(row, {});
    assert.equal(row.classList.contains('ioh-highlighted-chat-mute'), true);
    await time.advance(1);
    f.service.applyOffenderPunishmentHighlight(row, {}); f.service.applyOffenderPunishmentActionLabel(row, {});
    assert.equal(row.classList.contains('ioh-highlighted-chat-mute'), false);
    assert.equal(row.control.innerHTML, 'Принять тикет');
    assert.equal(row.control.dataset.iohPunishmentAction, undefined);
    assert.equal(f.reads.length, 0, 'Expiration recomputes cached messages without a network request');
});

test('Queue integration: duplicate eligible complaints share chat; known mute skips reads after TTL while user/data continues', async t => {
    const time = clock(t), f = fixture(t, ['Нарушение правил', 'Мониторинг', 'Попрошайничество'], {samePlayer: true});
    await time.finish(f.run()); f.flushUi();
    assert.equal(f.reads.length, 1); assert.equal(f.requests.length, 1);
    assert.equal(f.rows.filter(row => row.classList.contains('ioh-highlighted-chat-mute')).length, 3);
    await time.finish(f.run()); f.flushUi();
    assert.equal(f.reads.length, 1); assert.equal(f.requests.length, 1);
    await time.advance(5000); await time.finish(f.run()); f.flushUi();
    assert.equal(f.reads.length, 1); assert.equal(f.requests.length, 2);
    assert.equal(f.rows.filter(row => row.classList.contains('ioh-highlighted-chat-mute')).length, 3);
});

for (const text of ['safe', 'insult']) {
    test(`Queue integration: ${text} result still refreshes chat after TTL`, async t => {
        const time = clock(t), f = fixture(t, undefined, {onRead: () => ({messages: [{...toxic(), text}]})});
        await time.finish(f.run()); f.flushUi();
        await time.advance(5000); await time.finish(f.run()); f.flushUi();
        assert.equal(f.reads.length, 2);
        assert.equal(f.rows[0].classList.contains('ioh-highlighted-chat-mute'), false);
    });
}

for (const invalidation of ['expiry', 'rules']) {
    test(`Queue integration: cached mute resumes chat reads after ${invalidation}`, async t => {
        const time = clock(t); await time.advance(day * 2);
        const firstTime = Date.now() - (invalidation === 'expiry' ? day - 1000 : 1000);
        const f = fixture(t, undefined, {onRead: () => ({messages: [toxic(firstTime)]})});
        await time.finish(f.run()); f.flushUi();
        assert.equal(f.rows[0].classList.contains('ioh-highlighted-chat-mute'), true);
        if (invalidation === 'rules') f.service.setRuleInputs([], {});
        await time.advance(5000); await time.finish(f.run()); f.flushUi();
        assert.equal(f.reads.length, 2);
        assert.equal(f.rows[0].classList.contains('ioh-highlighted-chat-mute'), false);
    });
}

test('Queue integration: non-eligible duplicate does not suppress a later eligible chat request', async t => {
    const time = clock(t), f = fixture(t, ['Спам', 'Читерство'], {samePlayer: true});
    await time.finish(f.run()); f.flushUi();
    assert.equal(f.requests.length, 1); assert.equal(f.reads.length, 1);
    assert.equal(f.rows[0].classList.contains('ioh-highlighted-chat-mute'), true);
    assert.equal(f.rows[1].classList.contains('ioh-highlighted-chat-mute'), false);
});

for (const change of ['navigation', 'disable', 'hidden', 'player', 'ticket', 'removed', 'generation']) {
    test('Queue integration: pending chat cannot decorate after ' + change, async t => {
        const time = clock(t), pending = deferred(), f = fixture(t, undefined, {onRead: () => pending.promise});
        let current = true;
        const run = f.run({isCurrent: () => current});
        await time.advance(680);
        assert.equal(f.reads.length, 1);
        const row = f.rows[0];
        if (change === 'navigation') f.view.location.href += '/other';
        if (change === 'disable') f.service.settings.features.trackOffenderServer = false;
        if (change === 'hidden') f.service.document.hidden = true;
        if (change === 'player') row.offenderLink.href = `https://cybershoke.net/${player(99)}`;
        if (change === 'ticket') row.dataset.iohNativeTicket = 'ticket:99';
        if (change === 'removed') row.isConnected = false;
        if (change === 'generation') current = false;
        pending.resolve({messages: [toxic()]});
        await time.finish(run); f.flushUi();
        assert.equal(f.updates.length, 0);
        assert.equal(row.classList.contains('ioh-highlighted-chat-mute'), false);
        assert.equal(row.dataset.lastIpCheck, undefined);
    });
}

for (const code of ['UNAVAILABLE', 'INVALID_RESPONSE', 'RATE_LIMIT']) {
    test(`Queue integration: chat ${code} clears stale chat verdict but preserves server update`, async t => {
        const time = clock(t), f = fixture(t, undefined, {onRead: () => ({code})});
        f.service._queueChatCache = new Map([[player(0), {messages: [{...toxic(), text: 'insult'}], fetchedAt: Date.now() - 6000}]]);
        await time.finish(f.run()); f.flushUi();
        assert.equal(f.updates.length, 1);
        assert.equal(f.service._queueChatCache.has(player(0)), false);
        assert.equal(f.rows[0].classList.contains('ioh-highlighted-chat-mute'), false);
        assert.equal(f.rows[0].control.innerHTML, 'Принять тикет');
        assert.equal(f.service.isCheckingServer, false);
    });
}

test('Queue integration: stop aborts inflight chat, clears cached decoration and rejects late result', async t => {
    const time = clock(t), f = fixture(t, undefined, {onRead: () => null}), row = f.rows[0];
    f.service._queueChatCache = new Map([[player(0), {messages: [toxic()], fetchedAt: Date.now() - 6000}]]);
    f.service.applyOffenderPunishmentHighlight(row, {}); f.service.applyOffenderPunishmentActionLabel(row, {});
    const pending = f.service.fetchQueueChat(player(0));
    await time.flush();
    assert.equal(f.service._queueChatInflight.size, 1);
    f.service.stopQueueChatTracking();
    await time.finish(pending);
    f.emit(f.reads[0], {messages: [toxic()]}); await time.flush();
    assert.equal(f.service._queueChatCache.size, 0);
    assert.equal(f.service._queueChatInflight.size, 0);
    assert.equal(row.classList.contains('ioh-highlighted-chat-mute'), false);
    assert.equal(row.control.innerHTML, 'Принять тикет');
});

test('Queue integration: navigation and interval restarts retain completed verdict while cancelling pending reads', async t => {
    const time = clock(t), f = fixture(t, undefined, {onRead: () => null}), row = f.rows[0];
    f.service._queueChatCache = new Map([[player(0), {messages: [toxic()], fetchedAt: Date.now()}]]);
    f.service.applyOffenderPunishmentHighlight(row, {}); f.service.applyOffenderPunishmentActionLabel(row, {});
    const pending = f.service.fetchQueueChat(player(99)); await time.flush();
    const app = {ticketService: f.service, features: {trackOffenderServer: true}, _offenderTrackingGeneration: 0,
        _offenderTrackingPassPromise: Promise.resolve(), ipTrackTimeoutId: null};
    App.prototype.restartOffenderTracking.call(app);
    await time.finish(pending);
    assert.equal(f.service._queueChatCache.has(player(0)), true);
    assert.equal(f.service._queueChatInflight.size, 0);
    assert.equal(row.classList.contains('ioh-highlighted-chat-mute'), true);
    assert.equal(row.control.dataset.iohPunishmentAction, 'warning');
    await time.advance(5000); await time.finish(f.run()); f.flushUi();
    assert.equal(f.reads.length, 1, 'No new read for the preserved mute; only the cancelled other player was requested');
    app.features.trackOffenderServer = false; App.prototype.restartOffenderTracking.call(app);
    assert.equal(f.service._queueChatCache.size, 0);
    assert.equal(row.control.innerHTML, 'Принять тикет');
});

test('Queue cache removes absent idle players after ten minutes but retains current complaints', t => {
    const time = clock(t), f = fixture(t);
    f.service.nativeData.queueTickets = () => f.rows.map(row => row.ticket);
    f.service._queueChatCache = new Map([player(0), player(99)].map(id => [id, {messages: [toxic()], fetchedAt: Date.now()}]));
    return time.advance(600000).then(() => {
        f.service.pruneQueueChatCache();
        assert.equal(f.service._queueChatCache.has(player(0)), true);
        assert.equal(f.service._queueChatCache.has(player(99)), false);
    });
});

test('Queue cache evicts least recently used history instead of an active mute after 256 players', async t => {
    const time = clock(t), f = fixture(t);
    f.service._queueChatCache = new Map(Array.from({length: 256}, (_, i) => [player(i), {messages: [toxic()], fetchedAt: Date.now()}]));
    assert.equal(f.service.getQueueChatVerdict(f.rows[0]).kind, 'mute');
    const pending = f.service.fetchQueueChat(player(999)); await time.flush();
    f.emit(f.reads[0], {messages: [toxic()]}); await pending;
    assert.equal(f.service._queueChatCache.size, 256);
    assert.equal(f.service._queueChatCache.has(player(0)), true);
    assert.equal(f.service._queueChatCache.has(player(1)), false);
});

for (const code of ['UNAVAILABLE', 'TIMEOUT', 'INVALID_RESPONSE', 'RATE_LIMIT', 'BUSY']) {
    test(`Queue chat retries transient ${code} once and then shows a successful mute verdict`, async t => {
        const time = clock(t); let calls = 0;
        const f = fixture(t, undefined, {onRead: () => ++calls === 1 ? {code} : {messages: [toxic()]}});
        await time.finish(f.run()); f.flushUi();
        assert.equal(f.reads.length, 2);
        assert.equal(f.rows[0].control.dataset.iohPunishmentAction, 'warning');
        assert.equal(f.service._queueChatInflight.size, 0);
    });
}

test('Queue chat retry is bounded and aborted backoff cannot dispatch a late read', async t => {
    const time = clock(t), f = fixture(t, undefined, {onRead: () => ({code: 'UNAVAILABLE'})});
    await time.finish(f.run()); f.flushUi();
    assert.equal(f.reads.length, 2);
    await time.advance(5000);
    const pending = f.run(); await time.advance(680);
    const count = f.reads.length;
    assert.equal(count, 3);
    f.service.stopQueueChatTracking({preserveCache: true});
    await time.finish(pending); await time.advance(1000);
    assert.equal(f.reads.length, count);
});
