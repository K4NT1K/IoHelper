import test from 'node:test';
import assert from 'node:assert/strict';
import {OffenderTrackingMethods} from '../modules/ticket/OffenderTracking.js';
import {App} from '../modules/App.js';
import {AutoConnectMethods} from '../modules/ticket/AutoConnect.js';
import {clock, deferred} from './clock.mjs';

function location(t, pathname = '/support/tickets') {
    globalThis.window = {location: {pathname, href: 'https://example.invalid' + pathname}};
    t.after(() => { delete globalThis.window; });
    return globalThis.window;
}

function tracker(t, count, fetchData = async () => ({}), playerCount = count) {
    const view = location(t);
    const rows = Array.from({length: count}, (_, i) => {
        const offenderLink = {href: 'https://cybershoke.net/' + (76561198000000000n + BigInt(i % playerCount))};
        const serverLink = {href: 'steam://connect/127.0.0.1:27015'};
        return {dataset: {}, isConnected: true, offenderLink, serverLink,
            querySelector(selector) {
                if (selector.startsWith('td:nth-child(4)')) return offenderLink;
                if (selector.startsWith('td:nth-child(2)')) return serverLink;
                return null;
            }};
    });
    const calls = [];
    const jobs = [];
    const rendered = [];
    const ctx = {
        settings: {features: {trackOffenderServer: true}, ticketAgeLimit: 0},
        document: {hidden: false, querySelectorAll: () => rows},
        utils: {},
        isCheckingServer: false,
        _offenderRowSnapshots: new WeakMap(),
        ensureServerLinkOriginalIp: () => '127.0.0.1:27015',
        getCachedUserData: () => null,
        async fetchParsedUserData(id) { calls.push(id); return fetchData(id, ctx); },
        rowActionIsInReview: () => false,
        scheduleOffenderUi: job => jobs.push(job),
        applyOffenderServerStatus: link => rendered.push(link),
        applyOffenderPunishmentHighlight() {}, applyOffenderVipBadge() {},
        applyOffenderModeratorHighlight() {}, applyOffenderProfileVerification() {}, applyOffenderMuteBanIcons() {}
    };
    return {ctx, rows, calls, jobs, rendered, view,
        run: options => OffenderTrackingMethods.checkOffendersServers.call(ctx, 5000, options)};
}

test('T2: 20 rows finish once even when the first row expires before the end', async t => {
    const time = clock(t);
    const s = tracker(t, 20);
    await time.finish(s.run());
    assert.equal(s.calls.length, 20);
    assert.equal(new Set(s.calls).size, 20);
    assert.equal(s.rows.filter(row => row.dataset.lastIpCheck).length, 20);
    assert.equal(s.ctx.isCheckingServer, false);
    s.jobs.forEach(job => job());
    assert.equal(s.rendered.length, 20);
});

test('T2: failure attempts each player once and delays retries until the next eligible pass', async t => {
    const time = clock(t);
    const s = tracker(t, 5, async () => { throw new Error('HTTP 500'); });
    await time.finish(s.run());
    assert.equal(s.calls.length, 5);
    assert.equal(new Set(s.calls).size, 5);
    assert.equal(s.jobs.length, 0);
    await time.finish(s.run());
    assert.equal(s.calls.length, 5);
    await time.advance(5000);
    await time.finish(s.run());
    assert.equal(s.calls.length, 10);
});

test('T2: duplicate players share one result throughout a long pass', async t => {
    const time = clock(t);
    const s = tracker(t, 20, async () => ({}), 2);
    await time.finish(s.run());
    assert.equal(s.calls.length, 2);
    assert.equal(s.jobs.length, 20);
});

test('T2: removing the first row cannot lose its shared result for a later duplicate', async t => {
    const time = clock(t);
    let first = true;
    const s = tracker(t, 20, async () => {
        if (first) {
            first = false;
            s.rows.at(-1).isConnected = false;
        }
        return {};
    }, 19);
    await time.finish(s.run());
    assert.equal(s.calls.length, 19);
    assert.equal(new Set(s.calls).size, 19);
    assert.equal(s.jobs.length, 19);
});

test('T2: 429 retries the same player before advancing the queue', async t => {
    const time = clock(t);
    let attempts = 0;
    const s = tracker(t, 3, async (_id, ctx) => {
        if (++attempts === 1) {
            ctx.globalServerCooldown = Date.now() + 660;
            throw new Error('429');
        }
        return {};
    });
    await time.finish(s.run());
    assert.equal(s.calls.length, 4);
    assert.equal(new Set(s.calls).size, 3);
    assert.deepEqual(s.calls, [s.rows[2], s.rows[2], s.rows[1], s.rows[0]].map(row => row.offenderLink.href.split('/').at(-1)));
    assert.equal(s.jobs.length, 3);
    assert(s.rows.every(row => row.dataset.lastIpCheck));
});

test('T2: repeated 429 respects cooldown and shares eventual success with duplicate rows', async t => {
    const time = clock(t);
    const requestTimes = [];
    const s = tracker(t, 6, async (_id, ctx) => {
        requestTimes.push(Date.now());
        if (requestTimes.length <= 3) {
            ctx.globalServerCooldown = Date.now() + 2000;
            throw new Error('429');
        }
        return {};
    }, 2);
    await time.finish(s.run());
    assert.equal(s.calls.length, 5);
    assert(s.calls.slice(0, 4).every(id => id === s.calls[0]));
    for (let i = 1; i <= 3; i++) assert(requestTimes[i] - requestTimes[i - 1] >= 2000);
    assert.equal(s.jobs.length, 6);
    assert.equal(s.ctx.isCheckingServer, false);
});

test('T2: a non-429 failure after a retry lets the remaining queue proceed', async t => {
    const time = clock(t);
    let attempts = 0;
    const s = tracker(t, 3, async () => {
        if (++attempts === 1) throw new Error('429');
        if (attempts === 2) throw new Error('HTTP 500');
        return {};
    });
    await time.finish(s.run());
    assert.equal(s.calls.length, 4);
    assert.equal(s.calls[0], s.calls[1]);
    assert.equal(s.jobs.length, 2);
});

for (const change of ['navigation', 'disabled', 'hidden', 'player replaced', 'row removed', 'generation']) {
    test('T2: 429 retry stops after ' + change, async t => {
        const time = clock(t);
        const s = tracker(t, 1, async () => { throw new Error('429'); });
        let current = true;
        const pass = s.run({isCurrent: () => current});
        await time.advance(340);
        assert.equal(s.calls.length, 1);
        assert.equal(s.rows[0].dataset.lastIpCheck, undefined);
        if (change === 'navigation') s.view.location.href += '/other';
        if (change === 'disabled') s.ctx.settings.features.trackOffenderServer = false;
        if (change === 'hidden') s.ctx.document.hidden = true;
        if (change === 'player replaced') s.rows[0].offenderLink.href = 'https://cybershoke.net/76561198999999999';
        if (change === 'row removed') s.rows[0].isConnected = false;
        if (change === 'generation') current = false;
        await time.finish(pass);
        assert.equal(s.calls.length, 1);
        assert.equal(s.jobs.length, 0);
        assert.equal(s.ctx.isCheckingServer, false);
    });
}

for (const change of ['navigation', 'disabled', 'hidden', 'player replaced']) {
    test('Pending request cannot render after ' + change, async t => {
        const time = clock(t);
        const request = deferred();
        const s = tracker(t, 2, () => request.promise);
        const pass = s.run();
        await time.advance(340);
        if (change === 'navigation') s.view.location.href += '/other';
        if (change === 'disabled') s.ctx.settings.features.trackOffenderServer = false;
        if (change === 'hidden') s.ctx.document.hidden = true;
        if (change === 'player replaced') {
            s.rows.forEach(row => { row.offenderLink.href = 'https://cybershoke.net/76561198999999999'; });
        }
        request.resolve({});
        await time.finish(pass);
        assert.equal(s.calls.length, 1);
        assert.equal(s.jobs.length, 0);
    });
}

test('Queued UI does not mark a cancelled render as already applied', async t => {
    const time = clock(t);
    const s = tracker(t, 1);
    await time.finish(s.run());
    s.view.location.href += '/other';
    s.jobs.forEach(job => job());
    assert.equal(s.rendered.length, 0);
    assert.equal(s.ctx._offenderRowSnapshots.has(s.rows[0]), false);
});

function scheduler(t, pathname = '/support/tickets') {
    const view = location(t, pathname);
    const ctx = Object.assign(Object.create(App.prototype), {
        window: view, document: {hidden: false},
        features: {trackOffenderServer: true},
        settings: {trackOffenderInterval: 5, trackOffenderIntervalWhileReviewing: 30},
        ipTrackTimeoutId: null, _offenderTrackingPassPromise: null,
        _offenderTrackingGeneration: 0, _offenderTrackingRestartRequested: false,
        _wasOnComplaintDetail: pathname.includes('/ticket/'),
        _offenderTrackingHref: view.location.href, _offenderTrackingTextarea: null,
        ticketService: {findVisibleTicketResolutionTextarea: () => null, syncOpenTicketOffenderTracking() {},
            async checkOffendersServers() {}, async trackOpenTicketOffenderServer() {}}
    });
    return ctx;
}

test('T1: one active pass and the interval starts after completion', async t => {
    const time = clock(t);
    const app = scheduler(t);
    const pending = deferred();
    let passes = 0;
    app.ticketService.checkOffendersServers = () => ++passes === 1 ? pending.promise : Promise.resolve();
    const first = app.runOffenderTrackingPass();
    assert.equal(app.runOffenderTrackingPass(), first);
    await time.advance(20000);
    assert.equal(passes, 1);
    pending.resolve();
    await time.flush();
    await time.advance(4999);
    assert.equal(passes, 1);
    await time.advance(1);
    assert.equal(passes, 2);
});

test('T1: detail checks the current offender and the whole queue, then pauses 30 seconds', async t => {
    const time = clock(t);
    const app = scheduler(t, '/ticket/1/example');
    const order = [];
    app.ticketService.trackOpenTicketOffenderServer = async () => { order.push('open'); };
    app.ticketService.checkOffendersServers = async (_ttl, options) => {
        assert.notEqual(options.singleRowPerPass, true);
        order.push('queue');
    };
    await app.runOffenderTrackingPass();
    assert.deepEqual(order, ['open', 'queue']);
    await time.advance(29999);
    assert.equal(order.length, 2);
    await time.advance(1);
    assert.deepEqual(order, ['open', 'queue', 'open', 'queue']);
});

test('Mode change invalidates pending work and uses the new review interval', async t => {
    const time = clock(t);
    const app = scheduler(t);
    const pending = deferred();
    let oldIsCurrent;
    let passes = 0;
    app.ticketService.checkOffendersServers = (_ttl, {isCurrent}) => {
        passes++;
        oldIsCurrent = isCurrent;
        return pending.promise;
    };
    app.runOffenderTrackingPass();
    await time.flush();
    app.window.location.pathname = '/ticket/1/example';
    app.window.location.href = 'https://example.invalid/ticket/1/example';
    app.syncOffenderTrackingForPage();
    assert.equal(oldIsCurrent(), false);
    pending.resolve();
    await time.flush();
    await time.advance(29999);
    assert.equal(passes, 1);
    await time.advance(1);
    assert.equal(passes, 2);
});

test('Disabling while a request is pending cannot resurrect the loop', async t => {
    const time = clock(t);
    const app = scheduler(t);
    const pending = deferred();
    let passes = 0;
    app.ticketService.checkOffendersServers = () => { passes++; return pending.promise; };
    app.runOffenderTrackingPass();
    await time.flush();
    app.features.trackOffenderServer = false;
    app.handleTrackOffenderLoop();
    pending.resolve();
    await time.advance(60000);
    assert.equal(passes, 1);
    assert.equal(time.timers.size, 0);
});

test('Interval changes wait for the old pass and restart exactly one loop', async t => {
    const time = clock(t);
    const app = scheduler(t);
    const pending = deferred();
    let calls = 0;
    let current;
    app.ticketService.checkOffendersServers = (_ttl, {isCurrent}) => {
        current = isCurrent;
        return ++calls === 1 ? pending.promise : Promise.resolve();
    };
    app.runOffenderTrackingPass();
    await time.flush();
    app.settings.trackOffenderInterval = 9;
    app.handleTrackOffenderLoop({trackOffenderInterval: 5, trackOffenderIntervalWhileReviewing: 30});
    assert.equal(current(), false);
    await time.advance(20000);
    assert.equal(calls, 1);
    pending.resolve();
    await time.flush();
    assert.equal(calls, 2);
    assert.equal(time.timers.size, 1);
    await time.advance(8999);
    assert.equal(calls, 2);
    await time.advance(1);
    assert.equal(calls, 3);
});

test('Open-ticket result cannot mark another scope or trigger Steam after closing its ticket', async t => {
    const time = clock(t);
    const pending = deferred();
    let scope = {};
    const originalScope = scope;
    const effects = [];
    location(t, '/ticket/1983900');
    const ctx = {
        ...AutoConnectMethods, ...OffenderTrackingMethods,
        settings: {features: {trackOffenderServer: true, autoConnectServer: true}},
        document: {hidden: false, contains: node => node.connected !== false},
        getAutoConnectScope: () => scope,
        isActiveComplaintScope: () => true,
        isOpenComplaintScope: () => true,
        scopeHasInProgressStatus: () => true,
        findInfoFieldScoped: label => label === 'Нарушитель' ? {} : null,
        isOffenderOffline: () => false,
        extractSteamIdFromField: () => '76561198000000000',
        findTicketServerConnectLink: () => null,
        extractServerIpFromConnectLink: () => '127.0.0.1:27015',
        getCachedUserData: () => null,
        fetchParsedUserData: () => pending.promise,
        clearOffenderOffline: () => effects.push('clear'),
        getOffenderRelocatedServer: () => null,
        markOffenderRelocated: () => effects.push('relocated'),
        connectToCurrentServer: () => effects.push('connect')
    };
    const pass = OffenderTrackingMethods.trackOpenTicketOffenderServer.call(ctx, 30000);
    originalScope.connected = false;
    scope = {};
    assert.notEqual(scope, originalScope);
    pending.resolve({serverIp: '127.0.0.2:27015'});
    await time.finish(pass);
    assert.deepEqual(effects, []);
});
