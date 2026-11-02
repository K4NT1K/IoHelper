import test from 'node:test';
import assert from 'node:assert/strict';
import {ServerConnectionMemory, ServerConnectionStore, normalizeServerEndpoint} from '../modules/ServerConnectionMemory.js';
import {AutoConnectMethods} from '../modules/ticket/AutoConnect.js';
import {deferred} from './clock.mjs';

const A = '127.0.0.1:27015', B = '127.0.0.2:27015';
const sender = {tab: {url: 'https://io.cybershoke.net/support/tickets'}};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function environment() {
    const stored = {}, tabs = [], listeners = new Set(), events = new Map();
    const chrome = {
        storage: {local: {async get(key) { return {[key]: stored[key]}; }, async set(value) { Object.assign(stored, value); }}},
        tabs: {async query() { return tabs; }, async sendMessage(_id, message) { for (const listener of listeners) listener(message); }},
        runtime: {onMessage: {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)}}
    };
    const store = new ServerConnectionStore(chrome);
    chrome.runtime.sendMessage = request => store.handle(request, sender);
    const document = {addEventListener: (type, fn, capture) => events.set(type, {fn, capture}), removeEventListener: type => events.delete(type)};
    const memory = new ServerConnectionMemory({document, chrome});
    const click = (endpoint, extra = {}) => events.get('click').fn({button: 0, target: {closest: () => ({href: 'steam://connect/' + endpoint})}, ...extra});
    return {chrome, store, stored, tabs, listeners, events, document, memory, click};
}

test('Endpoint normalization strips Steam parameters and rejects non-connect targets', () => {
    assert.equal(normalizeServerEndpoint(' STEAM://CONNECT/Example.COM:027015/password?x=1 '), 'example.com:27015');
    assert.equal(normalizeServerEndpoint('steam://connect/[::1]:27015/'), '[::1]:27015');
    for (const target of ['https://example.com:443', 'steam://run/730', 'a:0', 'a:65536', 'a:abc', 'a:2 x', '']) assert.equal(normalizeServerEndpoint(target), null);
});

test('Delegated manual capture preserves the original click and survives page navigation/recreation', async () => {
    const f = environment();
    await f.memory.start();
    assert.equal(f.events.get('click').capture, true);
    f.click(A, {preventDefault() { throw Error('Must not prevent native connection'); }});
    assert.equal(f.memory.endpoint, A);
    await flush();
    assert.equal(f.stored.iohLastServerConnection.endpoint, A);
    assert.equal(f.stored.iohLastServerConnection.source, 'manual');
    assert.equal(f.stored.iohLastServerConnection.password, undefined);
    f.memory.stop();
    assert.equal(f.events.size, 0);
    assert.equal(f.listeners.size, 0);
    const nextPage = new ServerConnectionMemory({document: f.document, chrome: f.chrome});
    await nextPage.start();
    assert.equal(nextPage.endpoint, A);
    nextPage.stop();
});

test('A late hydration response cannot overwrite a newer manual connection', async () => {
    const f = environment(), hydration = deferred();
    const send = f.chrome.runtime.sendMessage;
    f.chrome.runtime.sendMessage = request => request.action === 'getServerConnection' ? hydration.promise : send(request);
    const started = f.memory.start();
    f.click(B);
    assert.equal(f.memory.endpoint, B);
    hydration.resolve({success: true, record: {endpoint: A, revision: 1}});
    await started;
    assert.equal(f.memory.endpoint, B);
    await flush();
    assert.equal(f.memory.endpoint, B);
    f.memory.stop();
});

test('Worker serializes updates and synchronizes the latest server to another admin tab', async () => {
    const f = environment();
    f.tabs.push({id: 1});
    await f.memory.start();
    await Promise.all([
        f.store.handle({action: 'rememberServerConnection', endpoint: A, source: 'manual'}, sender),
        f.store.handle({action: 'rememberServerConnection', endpoint: B, source: 'auto'}, sender)
    ]);
    assert.equal(f.memory.endpoint, B);
    assert.equal(f.memory.record.revision, 2);
    f.memory.onMessage({action: 'serverConnectionChanged', record: {endpoint: A, revision: 1}});
    assert.equal(f.memory.endpoint, B);
    assert.deepEqual(await f.store.handle({action: 'getServerConnection'}, {tab: {url: 'https://example.com/'}}), {success: false});
    f.memory.stop();
});

test('A new worker preserves the last server after a browser restart; restored pages refresh it', async () => {
    const f = environment();
    await f.memory.start();
    f.click(A);
    await flush();
    const restartedWorker = new ServerConnectionStore(f.chrome);
    f.chrome.runtime.sendMessage = request => restartedWorker.handle(request, sender);
    assert.equal((await f.chrome.runtime.sendMessage({action: 'getServerConnection'})).record.endpoint, A);
    await restartedWorker.handle({action: 'rememberServerConnection', endpoint: B, source: 'manual'}, sender);
    assert.equal(f.memory.endpoint, A);
    await f.memory.refresh();
    assert.equal(f.memory.endpoint, B);
    f.memory.stop();
});

test('Automatic clicks record auto intent once while manual A→B replaces A', async () => {
    const f = environment();
    await f.memory.start();
    f.memory.clickAutomatically({click: () => f.click(A)}, A);
    await flush();
    assert.equal(f.stored.iohLastServerConnection.source, 'auto');
    assert.equal(f.stored.iohLastServerConnection.revision, 1);
    f.click(B);
    assert.equal(f.memory.endpoint, B);
    await flush();
    f.memory.stop();
});

test('Current manual server skips ordinary auto-connect; historical A TTL allows returning after B', () => {
    const connections = [];
    const ctx = {...AutoConnectMethods,
        serverConnectionMemory: {endpoint: A, clickAutomatically(_link, endpoint) { this.endpoint = endpoint; connections.push(endpoint); }},
        autoConnectedServerIps: new Map([[A, Date.now() + 100000]]), _autoConnectSkipLoggedIps: new Set(),
        LEFT_OFFENDER_TTL_MS: 480000, document: {body: {dataset: {}}},
        shouldAutoConnectToServer: () => ({allowed: true}), getAutoConnectScope: () => ({}),
        findInfoFieldScoped: () => null, extractSteamIdFromField: () => null,
        findTicketServerConnectLink: () => ({href: 'steam://connect/' + A})};
    assert.equal(ctx.connectToCurrentServer(), false);
    ctx.serverConnectionMemory.endpoint = B;
    assert.equal(ctx.connectToCurrentServer(), true);
    assert.deepEqual(connections, [A]);
    ctx.clearAutoConnectedServers();
    assert.equal(ctx.serverConnectionMemory.endpoint, A);
    assert.equal(ctx.connectToCurrentServer(), false);
});

test('Forced return to current server skips Steam but acknowledges every matching tracking session', () => {
    const session = {steamId: 'player'}, sibling = {steamId: 'player'}, other = {steamId: 'other'};
    const connections = [];
    const ctx = {...AutoConnectMethods, serverConnectionMemory: {endpoint: A},
        settings: {},
        _openTicketTrackingSessions: new Map([[1, session], [2, sibling], [3, other]]),
        isOpenTicketTrackingSessionCurrent: () => true,
        getTicketComplaintCategory: () => 'Читерство',
        _autoConnectSkipLoggedIps: new Set(), markAutoConnected() {},
        connectToSteamServer: ip => { connections.push(ip); return true; }};
    assert.equal(ctx.connectToTrackedOffenderServer(session, A), false);
    assert.equal(session.lastConnectedIp, A);
    assert.equal(sibling.lastConnectedIp, A);
    assert.equal(other.lastConnectedIp, undefined);
    ctx.serverConnectionMemory.endpoint = B;
    assert.equal(ctx.connectToTrackedOffenderServer(session, A), true);
    assert.deepEqual(connections, [A]);
});

test('Closing the page during hydration does not install late state or resume memory listeners', async () => {
    const f = environment(), hydration = deferred();
    f.chrome.runtime.sendMessage = () => hydration.promise;
    const start = f.memory.start();
    f.memory.stop();
    hydration.resolve({success: true, record: {endpoint: A, revision: 1}});
    await start;
    assert.equal(f.memory.endpoint, null);
    assert.equal(f.events.size, 0);
    assert.equal(f.listeners.size, 0);
});
