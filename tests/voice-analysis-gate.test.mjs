import test from 'node:test';
import assert from 'node:assert/strict';
import {TicketService} from '../modules/TicketService.js';
import {App} from '../modules/App.js';
import {clock, deferred} from './clock.mjs';
import {readFileSync} from 'node:fs';

const configuredTriggers = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8')).settings.reasonTriggersAutoconnect;

function fixture(t) {
    const time = clock(t);
    const before = globalThis.window;
    globalThis.window = {location: {pathname: '/ticket/2000001', href: 'https://io.cybershoke.net/ticket/2000001'}};
    t.after(() => {if (before === undefined) delete globalThis.window; else globalThis.window = before;});
    const scope = {steamId: '76561198000000001', category: 'Нарушение правил', playerText: 'проверьте игрока'};
    const textarea = {scope, connected: true, visible: true};
    const connections = [];
    const document = {body: {dataset: {}}, contains: el => el?.connected !== false};
    const service = new TicketService({document, utils: {}, badgeService: {}, rules: [], settings: {
        features: {autoConnectServer: true, processTicketRules: true},
        reasonTriggersAutoconnect: ['мешает'], autoConnectReasons: ['Читерство']
    }});
    Object.assign(service, {
        getTicketScopeRoot: el => el.scope,
        getChatCacheKey: el => `${window.location.pathname}|${el.scope.steamId}`,
        getAutoConnectScope: () => textarea.scope,
        isVisibleTicketTextarea: el => el.connected && el.visible,
        findInfoFieldScoped: (_label, root) => root,
        extractSteamIdFromField: field => field.steamId,
        getTicketComplaintCategory: (root = textarea.scope) => root.category,
        getPlayerComplaintText: (root = textarea.scope) => root.playerText,
        isActiveComplaintScope: () => true, scopeHasInProgressStatus: () => true,
        ticketServerShowsOffenderLeft: () => false,
        findTicketServerConnectLink: () => ({href: 'steam://connect/127.0.0.1:27015', click() {connections.push('ticket');}}),
        hasActivePunishmentForVoiceFallback: () => null,
        waitForSettledChatHistory: async () => true,
        processTicketRules: async () => ({kind: 'none'})
    });
    const app = {document, features: service.settings.features, ticketService: service,
        domCoordinator: {notify() {}}, ticketChatHistoryObservers: new Map([[textarea, {}]])};
    const run = () => App.prototype._runTicketChatAnalysis.call(app, textarea);
    return {time, scope, textarea, service, app, connections, run};
}

test('An allowed category without a text trigger still waits for analysis', async t => {
    const f = fixture(t), analysis = deferred();
    f.service.settings.autoConnectReasons.push('Нарушение правил');
    f.service.processTicketRules = () => analysis.promise;
    const running = f.run();
    await f.time.flush();
    assert.equal(f.service.connectToCurrentServer(), false);
    assert.equal(f.service.connectToCurrentServer({analysisFallback: true}), false);
    assert.deepEqual(f.connections, []);
    analysis.resolve({kind: 'none'});
    await running;
    assert.deepEqual(f.connections, ['ticket']);
    assert.equal(f.time.timers.size, 0, 'No extra connection delay after completion');
});

for (const kind of ['mute', 'skip', 'pending', 'unchanged']) {
    test(`Incomplete or refusing ${kind} analysis never authorizes connect`, async t => {
        const f = fixture(t);
        f.service.processTicketRules = async () => ({kind});
        await f.run();
        assert.equal(f.service.connectToCurrentServer(), false);
        assert.deepEqual(f.connections, []);
    });
}

test('A completed warning allows immediate connection, unchanged reuses its completed result', async t => {
    const f = fixture(t);
    f.service.processTicketRules = async () => ({kind: 'warning'});
    await f.run();
    assert.deepEqual(f.connections, ['ticket']);
    f.service.processTicketRules = async () => ({kind: 'unchanged'});
    await f.run();
    assert.equal(f.service.getCompletedChatAnalysis(f.scope).kind, 'warning');
    assert.deepEqual(f.connections, ['ticket'], 'Existing server deduplication still works');
});

test('Load timeout never analyzes/authorizes an unfinished chat; later ready event can complete', async t => {
    const f = fixture(t), loading = deferred();
    let calls = 0;
    f.service.waitForSettledChatHistory = () => loading.promise;
    f.service.processTicketRules = async () => {calls++; return {kind: 'none'};};
    const running = f.run();
    await f.time.flush();
    assert.equal(f.service.connectToCurrentServer(), false);
    loading.resolve(false);
    await running;
    assert.equal(calls, 0);
    assert.deepEqual(f.connections, []);
    f.service.waitForSettledChatHistory = async () => true;
    await f.run();
    assert.equal(calls, 1);
    assert.deepEqual(f.connections, ['ticket']);
});

for (const change of ['navigation', 'player', 'hidden', 'removed', 'disabled', 'mutation']) {
    test(`A late analysis after ${change} cannot connect`, async t => {
        const f = fixture(t), analysis = deferred();
        f.service.processTicketRules = () => analysis.promise;
        const running = f.run();
        await f.time.flush();
        if (change === 'navigation') window.location.pathname = '/ticket/2000002';
        if (change === 'player') f.scope.steamId = '76561198000000002';
        if (change === 'hidden') f.textarea.visible = false;
        if (change === 'removed') f.textarea.connected = false;
        if (change === 'disabled') f.app.features.processTicketRules = false;
        if (change === 'mutation') f.service.invalidateChatAnalysis(f.textarea);
        analysis.resolve({kind: 'none'});
        await running;
        assert.deepEqual(f.connections, []);
        assert.equal(f.service.canAutoConnectAfterAnalysis(f.scope), false);
    });
}

test('A newer analysis wins over an older pending run and debounce blocks previous approval immediately', async t => {
    const f = fixture(t), old = deferred();
    f.service.processTicketRules = () => old.promise;
    const first = f.run();
    await f.time.flush();
    f.service.processTicketRules = async () => ({kind: 'mute'});
    await f.run();
    old.resolve({kind: 'none'});
    await first;
    assert.deepEqual(f.connections, []);
    f.service.processTicketRules = async () => ({kind: 'none'});
    await f.run();
    assert.equal(f.service.canAutoConnectAfterAnalysis(f.scope), true);
    App.prototype._debouncedProcessTicketRules.call(f.app, f.textarea);
    assert.equal(f.service.canAutoConnectAfterAnalysis(f.scope), false);
    for (const id of f.time.timers.keys()) clearTimeout(id);
});

test('Tracker return and forced relocation use the same analysis gate for their own scope', async t => {
    const f = fixture(t), session = {scope: f.scope, steamId: f.scope.steamId};
    f.service._openTicketTrackingSessions.set(f.scope, session);
    f.service.isOpenTicketTrackingSessionCurrent = () => true;
    f.service.connectToSteamServer = ip => {f.connections.push(ip); return true;};
    f.service.markOffenderRelocated(f.scope.steamId, '127.0.0.2:27015');
    assert.equal(f.service.connectToTrackedOffenderServer(session, '127.0.0.2:27015'), false);
    assert.equal(session.lastConnectedIp, undefined);
    assert.equal(f.service.connectToRelocatedServerForced(), false);
    const state = f.service.beginChatAnalysis(f.textarea);
    f.service.completeChatAnalysis(state, {kind: 'none'});
    assert.equal(f.service.connectToTrackedOffenderServer(session, '127.0.0.2:27015'), true);
    assert.equal(session.lastConnectedIp, '127.0.0.2:27015');
});

test('Unrelated cheating category keeps its direct connection path', t => {
    const f = fixture(t);
    f.scope.category = 'Читерство';
    assert.equal(f.service.connectToCurrentServer(), true);
    assert.deepEqual(f.connections, ['ticket']);
});

test('An unchanged signature from an interrupted analysis cannot reuse a different completed verdict', async t => {
    const f = fixture(t);
    const key = f.service.getChatCacheKey(f.textarea);
    f.service.chatSignatureByKey.set(key, 'completed-input');
    await f.run();
    f.service.invalidateChatAnalysis(f.textarea);
    f.service.chatSignatureByKey.set(key, 'interrupted-new-input');
    f.service.processTicketRules = async () => ({kind: 'unchanged'});
    await f.run();
    assert.equal(f.service.canAutoConnectAfterAnalysis(f.scope), false);
    assert.equal(f.connections.length, 1);
});

test('Analysis failure and newly loaded active punishment keep every automatic entry blocked', async t => {
    const f = fixture(t);
    f.service.processTicketRules = async () => {throw Error('simulated analysis failure');};
    await f.run();
    assert.equal(f.service.connectToCurrentServer(), false);
    f.service.processTicketRules = async () => ({kind: 'none'});
    const state = f.service.beginChatAnalysis(f.textarea);
    f.service.completeChatAnalysis(state, {kind: 'none'});
    f.service.hasActivePunishmentForVoiceFallback = () => 'mute';
    assert.equal(f.service.connectToCurrentServer(), false);
    assert.deepEqual(f.connections, []);
});

test('Navigation preserves completed hidden-ticket approval but cancels unfinished work; rule reset clears both', async t => {
    const f = fixture(t);
    const completed = f.service.beginChatAnalysis(f.textarea);
    f.service.completeChatAnalysis(completed, {kind: 'none'});
    const otherScope = {...f.scope, steamId: '76561198000000002'};
    const otherTextarea = {...f.textarea, scope: otherScope};
    const pending = f.service.beginChatAnalysis(otherTextarea);
    f.service.resetChatAnalysisCache(null, {preserveCompleted: true});
    f.textarea.visible = false;
    assert.equal(f.service.canAutoConnectAfterAnalysis(f.scope), true);
    assert.equal(f.service.completeChatAnalysis(pending, {kind: 'none'}), null);
    assert.equal(f.service.canAutoConnectAfterAnalysis(otherScope), false);
    f.service.resetChatAnalysisCache();
    assert.equal(f.service.canAutoConnectAfterAnalysis(f.scope), false);
});

for (const playerText of ['препятствует игре', 'играет с АХК', 'uses AHK']) {
    test(`Configured trigger «${playerText}» connects on mount before analysis and a later mute cannot duplicate it`, async t => {
        const f = fixture(t), analysis = deferred();
        f.scope.playerText = playerText;
        f.service.settings.reasonTriggersAutoconnect = configuredTriggers;
        f.service.processTicketRules = () => analysis.promise;
        App.prototype.maybeAutoConnectOnTicketMount.call(f.app);
        assert.deepEqual(f.connections, ['ticket']);
        assert.equal(f.service.getCompletedChatAnalysis(f.scope), null);
        const running = f.run();
        await f.time.flush();
        assert.equal(f.service.connectToCurrentServer(), false);
        assert.equal(f.time.timers.size, 0, 'Trigger path does not schedule a delay');
        assert.deepEqual(f.connections, ['ticket']);
        analysis.resolve({kind: 'mute'});
        await running;
        assert.equal(f.service.getCompletedChatAnalysis(f.scope).kind, 'mute');
        assert.deepEqual(f.connections, ['ticket']);
    });
}

test('A trigger bypasses pending analysis but does not override an existing active punishment', async t => {
    const f = fixture(t);
    f.scope.playerText = 'ахк';
    f.service.settings.reasonTriggersAutoconnect = configuredTriggers;
    f.service.processTicketRules = async () => ({kind: 'pending'});
    await f.run();
    assert.equal(f.service.canAutoConnectAfterAnalysis(f.scope), true);
    f.service.processTicketRules = async () => ({kind: 'mute'});
    f.service.hasActivePunishmentForVoiceFallback = () => 'ban';
    await f.run();
    assert.equal(f.service.connectToCurrentServer(), false);
    assert.deepEqual(f.connections, []);
});

test('A hidden tracked ticket uses its own complaint trigger when chat suggests a mute', t => {
    const f = fixture(t);
    f.service.settings.reasonTriggersAutoconnect = configuredTriggers;
    f.scope.playerText = 'препятствует';
    const state = f.service.beginChatAnalysis(f.textarea);
    f.service.completeChatAnalysis(state, {kind: 'mute'});
    f.textarea.visible = false;
    f.service.getAutoConnectScope = () => ({category: 'Нарушение правил', playerText: 'проверьте игрока'});
    const session = {scope: f.scope, steamId: f.scope.steamId};
    f.service._openTicketTrackingSessions.set(f.scope, session);
    f.service.isOpenTicketTrackingSessionCurrent = () => true;
    f.service.connectToSteamServer = ip => {f.connections.push(ip); return true;};
    assert.equal(f.service.connectToTrackedOffenderServer(session, '127.0.0.2:27015'), true);
    assert.deepEqual(f.connections, ['127.0.0.2:27015']);
});

test('A complaint trigger remains immediate with chat analysis disabled', t => {
    const f = fixture(t);
    f.scope.playerText = 'uses ahk';
    f.service.settings.reasonTriggersAutoconnect = configuredTriggers;
    f.service.settings.features.processTicketRules = false;
    App.prototype.maybeAutoConnectOnTicketMount.call(f.app);
    assert.deepEqual(f.connections, ['ticket']);
    assert.equal(f.time.timers.size, 0);
});
