import test from 'node:test';
import assert from 'node:assert/strict';
import {OffenderTrackingMethods} from '../modules/ticket/OffenderTracking.js';
import {AutoConnectMethods} from '../modules/ticket/AutoConnect.js';
import {App} from '../modules/App.js';
import {clock, deferred} from './clock.mjs';

function fixture(t, {left = true, path = '/ticket/1983900'} = {}) {
    const time = clock(t);
    globalThis.window = {location: {pathname: path, href: 'https://example.invalid' + path}};
    const observers = [];
    globalThis.MutationObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; this.connected = true; }
        disconnect() { this.connected = false; }
    };
    t.after(() => { delete globalThis.window; delete globalThis.MutationObserver; });
    const state = {scope: {}, steamId: '76561198000000000', inProgress: true, active: true,
        left, serverIp: null, requests: [], connections: [], ttl: []};
    const siteLabel = {nodeType: 1, textContent: 'Вышел с сервера несколько секунд назад', closest: () => null};
    const field = {querySelectorAll: () => state.left ? [siteLabel] : []};
    const ctx = {
        ...AutoConnectMethods, ...OffenderTrackingMethods,
        settings: {features: {trackOffenderServer: true, autoConnectServer: true},
            trackOffenderIntervalWhileReviewing: 30, trackOpenTicketOfflineInterval: 5},
        document: {hidden: false, body: {dataset: {}}, contains: scope => scope.connected !== false},
        offenderOffline: new Map(), offenderRelocated: new Map(), autoConnectedServerIps: new Map(),
        _autoConnectSkipLoggedIps: new Set(), LEFT_OFFENDER_TTL_MS: 8 * 60 * 1000,
        getAutoConnectScope: () => state.scope,
        isActiveComplaintScope: scope => state.active && scope === state.scope,
        isOpenComplaintScope: () => true,
        scopeHasInProgressStatus: scope => scope.inProgress ?? state.inProgress,
        findInfoFieldScoped: (label, scope) => label === 'Сервер'
            ? (scope.field || field) : {steamId: scope.steamId || state.steamId},
        extractSteamIdFromField: offenderField => offenderField?.steamId,
        findTicketServerConnectLink: () => ({href: 'steam://connect/127.0.0.1:27015'}),
        getCachedUserData: (_id, ttl) => { state.ttl.push(ttl); return null; },
        async fetchParsedUserData(id) { state.requests.push(id); return {serverIp: state.serverIp}; },
        connectToSteamServer: ip => { state.connections.push(ip); return true; }
    };
    return {ctx, state, time, observers, siteLabel, field};
}

for (const flag of ['autoConnectServer', 'trackOffenderServer']) {
    test('No extra polling or DOM tracking when ' + flag + ' is disabled', async t => {
        const {ctx, state, time, observers} = fixture(t);
        ctx.settings.features[flag] = false;
        ctx.getAutoConnectScope = () => { throw new Error('Must check flags first'); };
        ctx.syncOpenTicketOffenderTracking();
        await ctx.trackOpenTicketOffenderServer(30000);
        await time.advance(60000);
        assert.equal(state.requests.length, 0);
        assert.equal(observers.length, 0);
        assert.equal(time.timers.size, 0);
    });
}

test('Site departure starts a five-second loop for only the ticket offender, including reports', async t => {
    const {ctx, state, time, observers, field} = fixture(t, {path: '/reports/4983900'});
    ctx.syncOpenTicketOffenderTracking();
    assert.equal(observers[0].target, field);
    assert.equal(observers[0].options.characterData, true);
    await time.advance(4999);
    assert.equal(state.requests.length, 0);
    await time.advance(1);
    assert.deepEqual(state.requests, [state.steamId]);
    await time.advance(10000);
    assert.equal(state.requests.length, 3);
    assert(state.requests.every(id => id === state.steamId));
    assert(state.ttl.every(ttl => ttl === 5000));
});

test('Site changes arm the loop; labels from hidden/site-unrelated extension nodes are ignored', async t => {
    const {ctx, state, time, observers, siteLabel} = fixture(t, {left: false});
    ctx.syncOpenTicketOffenderTracking();
    assert.equal(time.timers.size, 0);
    state.left = true;
    siteLabel.closest = selector => selector === '[data-ioh]' ? {} : null;
    observers[0].callback([{target: siteLabel}]);
    assert.equal(time.timers.size, 0);
    siteLabel.closest = selector => selector === '[aria-hidden="true"]' ? {} : null;
    observers[0].callback([{target: siteLabel}]);
    assert.equal(time.timers.size, 0);
    siteLabel.closest = () => null;
    observers[0].callback([{target: siteLabel}]);
    await time.advance(5000);
    assert.equal(state.requests.length, 1);
});

test('Queue detection also arms the active offender; unrelated players do not', async t => {
    const {ctx, state, time} = fixture(t, {left: false});
    ctx.syncOpenTicketOffenderTracking();
    ctx.markOffenderOffline('76561198999999999');
    assert.equal(time.timers.size, 0);
    ctx.markOffenderOffline(state.steamId);
    await time.advance(5000);
    assert.deepEqual(state.requests, [state.steamId]);
});

for (const serverIp of ['127.0.0.1:27015', '127.0.0.2:27015']) {
    test('Return to ' + serverIp + ' connects once despite TTL and a stale site label', async t => {
        const {ctx, state, time} = fixture(t);
        ctx.markAutoConnected(serverIp);
        ctx.syncOpenTicketOffenderTracking();
        await time.advance(5000);
        state.serverIp = serverIp;
        await time.advance(5000);
        assert.deepEqual(state.connections, [serverIp]);
        assert.equal(ctx.isOffenderOffline(state.steamId), false);
        assert.equal(time.timers.size, 0);
        ctx.syncOpenTicketOffenderTracking();
        await ctx.trackOpenTicketOffenderServer(30000);
        await time.advance(30000);
        await ctx.trackOpenTicketOffenderServer(30000);
        assert.deepEqual(state.connections, [serverIp]);
        assert.equal(time.timers.size, 0);
        state.left = false;
        ctx.syncOpenTicketOffenderTracking();
        state.left = true;
        ctx.syncOpenTicketOffenderTracking();
        await time.advance(5000);
        assert.deepEqual(state.connections, [serverIp, serverIp]);
    });
}

for (const change of ['closed', 'removed', 'player', 'auto off', 'tracker off']) {
    test('Pending active response cannot connect after ' + change, async t => {
        const {ctx, state, time, observers} = fixture(t);
        const pending = deferred();
        ctx.fetchParsedUserData = async id => { state.requests.push(id); return pending.promise; };
        ctx.syncOpenTicketOffenderTracking();
        await time.advance(5000);
        if (change === 'closed') state.inProgress = false;
        if (change === 'removed') {state.scope.connected = false; state.active = false;}
        if (change === 'player') state.steamId = '76561198999999999';
        if (change === 'auto off') ctx.settings.features.autoConnectServer = false;
        if (change === 'tracker off') ctx.settings.features.trackOffenderServer = false;
        ctx.syncOpenTicketOffenderTracking();
        pending.resolve({serverIp: '127.0.0.2:27015'});
        await time.flush();
        assert.deepEqual(state.connections, []);
        assert.equal(observers[0].connected, false);
        if (change !== 'player') {
            await time.advance(60000);
            assert.equal(state.requests.length, 1);
            assert.equal(time.timers.size, 0);
        }
    });
}

test('Closed ticket is checked before a scheduled fetch even without a mount event', async t => {
    const {ctx, state, time, observers} = fixture(t);
    ctx.syncOpenTicketOffenderTracking();
    state.inProgress = false;
    await time.advance(60000);
    assert.equal(state.requests.length, 0);
    assert.equal(time.timers.size, 0);
    assert.equal(observers[0].connected, false);
});

test('Hiding and returning to the page preserves acknowledgement of a stale site label', async t => {
    const {ctx, state, time} = fixture(t);
    state.serverIp = '127.0.0.1:27015';
    ctx.syncOpenTicketOffenderTracking();
    await time.advance(5000);
    ctx.document.hidden = true;
    ctx.syncOpenTicketOffenderTracking();
    ctx.document.hidden = false;
    ctx.syncOpenTicketOffenderTracking();
    await time.advance(60000);
    assert.deepEqual(state.connections, ['127.0.0.1:27015']);
    assert.equal(time.timers.size, 0);
});

for (const change of ['SPA tab', 'route', 'browser tab']) {
    test('Active polling and a pending return continue after switching ' + change, async t => {
        const {ctx, state, time, observers} = fixture(t);
        const pending = deferred();
        ctx.fetchParsedUserData = async id => {state.requests.push(id); return pending.promise;};
        const session = ctx.syncOpenTicketOffenderTracking();
        await time.advance(5000);
        if (change === 'SPA tab') state.active = false;
        if (change === 'route') {
            window.location.pathname = '/support/tickets';
            window.location.href = 'https://example.invalid/support/tickets';
        }
        if (change === 'browser tab') ctx.document.hidden = true;
        ctx.syncOpenTicketOffenderTracking();
        assert.equal(ctx._openTicketTrackingSessions.get(session.scope), session);
        assert.equal(observers[0].connected, true);
        pending.resolve({serverIp: null});
        await time.flush();
        await time.advance(5000);
        assert.deepEqual(state.requests, [state.steamId, state.steamId]);
        ctx.fetchParsedUserData = async id => {state.requests.push(id); return {serverIp:'127.0.0.2:27015'};};
        await time.advance(5000);
        assert.deepEqual(state.connections, ['127.0.0.2:27015']);
        assert.equal(time.timers.size, 0);
    });
}

test('Several open complaints retain their own waiting player and connection target', async t => {
    const {ctx, state, time} = fixture(t);
    const original = state.scope;
    const firstSteamId = state.steamId;
    const secondSteamId = '76561198999999999';
    ctx.syncOpenTicketOffenderTracking();
    state.scope = {steamId:secondSteamId, inProgress:true};
    ctx.syncOpenTicketOffenderTracking();
    ctx.fetchParsedUserData = async id => {
        state.requests.push(id);
        return {serverIp:id === firstSteamId ? '127.0.0.2:27015' : null};
    };
    await time.advance(5000);
    assert.deepEqual(state.requests, [firstSteamId, secondSteamId]);
    assert.deepEqual(state.connections, ['127.0.0.2:27015']);
    assert.equal(ctx._openTicketTrackingSessions.get(original).waitingForReturn, false);
    assert.equal(ctx._openTicketTrackingSessions.get(state.scope).waitingForReturn, true);
    original.inProgress = false;
    ctx.syncOpenTicketOffenderTracking();
    assert.equal(ctx._openTicketTrackingSessions.size, 1);
    await time.advance(5000);
    assert.deepEqual(state.requests, [firstSteamId, secondSteamId, secondSteamId]);
    state.scope.connected = false;
    state.active = false;
    await time.advance(5000);
    assert.equal(ctx._openTicketTrackingSessions.size, 0);
    assert.equal(time.timers.size, 0);
});

test('Two open tickets for the same returning player connect once even with different original servers', async t => {
    const {ctx, state, time} = fixture(t);
    ctx.findTicketServerConnectLink = scope => ({href:'steam://connect/' + (scope.originalIp || '127.0.0.1:27015')});
    const first = ctx.syncOpenTicketOffenderTracking();
    state.scope = {steamId:state.steamId, inProgress:true, originalIp:'127.0.0.2:27015'};
    const second = ctx.syncOpenTicketOffenderTracking();
    const data = {serverIp:'127.0.0.1:27015'};
    ctx.fetchParsedUserData = async () => data;
    await time.advance(5000);
    assert.deepEqual(state.connections, ['127.0.0.1:27015']);
    assert.equal(first.waitingForReturn, false);
    assert.equal(second.waitingForReturn, false);
    assert.equal(time.timers.size, 0);
});

test('Slow/error/429 responses do not overlap active passes or stop future retries', async t => {
    const {ctx, state, time} = fixture(t);
    const pending = deferred();
    ctx.fetchParsedUserData = async id => {
        state.requests.push(id);
        if (state.requests.length === 1) return pending.promise;
        if (state.requests.length === 2) {
            ctx.globalServerCooldown = Date.now() + 660;
            throw new Error('429');
        }
        if (state.requests.length === 3) throw new Error('HTTP 500');
        return {serverIp: null};
    };
    ctx.syncOpenTicketOffenderTracking();
    await time.advance(20000);
    assert.equal(state.requests.length, 1);
    pending.resolve({serverIp: null});
    await time.flush();
    await time.advance(4999);
    assert.equal(state.requests.length, 1);
    await time.advance(15001);
    assert.equal(state.requests.length, 5);
    assert.equal(time.timers.size, 1);
});

test('Active polling does not accelerate the whole queue or wait for its slow pass', async t => {
    const {ctx, state, time} = fixture(t);
    const queue = deferred();
    let queuePasses = 0;
    ctx.checkOffendersServers = () => { queuePasses++; return queue.promise; };
    const app = Object.assign(Object.create(App.prototype), {window, document: ctx.document,
        settings: ctx.settings, features: ctx.settings.features, ticketService: ctx,
        _offenderTrackingGeneration: 0, _offenderTrackingRestartRequested: false,
        _offenderTrackingPassPromise: null, ipTrackTimeoutId: null});
    app.runOffenderTrackingPass();
    await time.advance(20000);
    assert.equal(queuePasses, 1);
    assert.equal(state.requests.length, 5);
    queue.resolve();
    await time.flush();
    await time.advance(29999);
    assert.equal(queuePasses, 1);
    await time.advance(1);
    assert.equal(queuePasses, 2);
});

test('Active interval is read from config and missing values fall back to five seconds', async t => {
    const {ctx, state, time} = fixture(t);
    ctx.settings.trackOpenTicketOfflineInterval = 7;
    ctx.syncOpenTicketOffenderTracking();
    await time.advance(6999);
    assert.equal(state.requests.length, 0);
    await time.advance(1);
    assert.equal(state.requests.length, 1);
    for (const value of [undefined, 0, -1, 'invalid', Infinity]) {
        ctx.settings.trackOpenTicketOfflineInterval = value;
        assert.equal(ctx.getOpenTicketOfflineIntervalMs(), 5000);
    }
});

test('Mount auto-connect skips the old server link when the site reports departure', t => {
    const {ctx} = fixture(t);
    ctx.getTicketComplaintCategory = () => { throw new Error('Offline must be checked before category'); };
    assert.equal(ctx.shouldAutoConnectToServer().allowed, false);
    assert.equal(ctx.connectToCurrentServer(), false);
});

test('Regular and active tracking share one actual request and connect only once', async t => {
    const {ctx, state, time} = fixture(t);
    const pending = deferred();
    ctx.offenderProjectInflight = new Map();
    ctx.offenderProjectCache = new Map();
    ctx.userDataCache = new Map();
    ctx.fetchParsedUserData = OffenderTrackingMethods.fetchParsedUserData;
    ctx.fetchUserData = id => {state.requests.push(id); return pending.promise;};
    const regular = ctx.trackOpenTicketOffenderServer(30000);
    await time.advance(5000);
    assert.deepEqual(state.requests, [state.steamId]);
    pending.resolve({ok:true, status:200, json:async () => ({
        server:{server_ip:'127.0.0.2', server_port:27015}, basic:{}, cybershoke:{global:{}}
    })});
    await regular;
    await time.flush();
    assert.deepEqual(state.connections, ['127.0.0.2:27015']);
    assert.equal(ctx.offenderProjectInflight.size, 0);
    assert.equal(time.timers.size, 0);
});
