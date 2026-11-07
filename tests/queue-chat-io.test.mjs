import test from 'node:test';
import assert from 'node:assert/strict';
import {QUEUE_CHAT_CHANNEL, QUEUE_CHAT_LIMIT, normalizeQueueChatResponse, requestQueueChat} from '../modules/native/QueueChatClient.js';
import {installQueueChatBridge} from '../modules/native/QueueChatBridge.js';

const id = '76561198000000001', otherId = '76561198000000002';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(post = async () => ({status: 200, data: []})) {
    const listeners = new Map(), sent = [], calls = [];
    let sequence = 0;
    const window = {
        location: {origin: 'https://io.cybershoke.net'},
        crypto: {randomUUID: () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0')},
        addEventListener(type, fn) {if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn);},
        removeEventListener(type, fn) {listeners.get(type)?.delete(fn);},
        dispatch(type, event = {}) {for (const fn of [...(listeners.get(type) || [])]) fn(event);},
        postMessage(data, origin) {sent.push(data); this.dispatch('message', {source: this, origin, data});}
    };
    const client = {defaults: {baseURL: window.location.origin + '/api'}, interceptors: {},
        async post(...args) {calls.push(args); return post(...args);}};
    const dependencies = {window, document: {querySelectorAll: () => [{src: window.location.origin + '/main.js'}]},
        fetchText: async () => 'api.interceptors.request.use(x);export{api as native}',
        importModule: async () => ({native: client})};
    return {window, sent, calls, dependencies, listeners};
}

test('chat normalization keeps duplicate spam messages and inclusive 24h boundaries, ignores other users/invalid dates', () => {
    const now = 1800000000000;
    const row = {steamid64: id, unixtime: now / 1000, msg: 'same', type: 1};
    const messages = normalizeQueueChatResponse({messages: [row, row,
        {...row, unixtime: (now - 86400000) / 1000}, {...row, unixtime: now / 1000 - 86401},
        {...row, unixtime: now / 1000 + 1}, {...row, unixtime: null}, {...row, unixtime: 'bad'},
        {...row, steamid64: otherId}, {...row, msg: null}]}, id, {now});
    assert.equal(messages.length, 3);
    assert.deepEqual(messages[0], {timeMs: now, text: 'same', channel: 'team'});
    assert.deepEqual(messages[0], messages[1]);
    assert.throws(() => normalizeQueueChatResponse({data: []}, id), {code: 'INVALID_RESPONSE'});
    assert.throws(() => normalizeQueueChatResponse({messages: 'error'}, id), {code: 'INVALID_RESPONSE'});
});

test('bridge performs only fixed chat/list read and returns minimal normalized fields', async () => {
    const f = fixture(async () => ({status: 200, data: [{steamid64: id, unixtime: Math.floor(Date.now() / 1000), msg: 'message', type: 0, avatar: 'private'}]}));
    const stop = installQueueChatBridge(f.dependencies);
    try {
        const result = await requestQueueChat({window: f.window, steamId: id});
        assert.equal(f.calls.length, 1);
        const [path, body, options] = f.calls[0];
        assert.equal(path, '/chat/list');
        assert.deepEqual(body.data, {steamid64_user: id});
        assert.deepEqual(body.other, {limit: QUEUE_CHAT_LIMIT, name_type: true});
        assert.equal(Object.hasOwn(body.other, 'name_unique'), false);
        assert.ok(options.signal instanceof AbortSignal);
        assert.deepEqual(Object.keys(result[0]).sort(), ['channel', 'text', 'timeMs']);
    } finally {f.window.dispatch('pagehide'); stop();}
});

test('live API regression: omit server date filters so recent triggers reach the local 24h filter', async () => {
    const now = Math.floor(Date.now() / 1000);
    const f = fixture(async (_path, body) => ({status: 200, data: 'created' in body.data || 'ends' in body.data ? [] : [
        {steamid64: id, unixtime: now - 600, msg: 'папа бич твой', type: 0},
        {steamid64: id, unixtime: now - 86401, msg: 'old trigger', type: 0},
        {steamid64: id, unixtime: now + 60, msg: 'future trigger', type: 0}
    ]}));
    const stop = installQueueChatBridge(f.dependencies);
    try {
        const messages = await requestQueueChat({window: f.window, steamId: id});
        assert.deepEqual(messages, [{text: 'папа бич твой', timeMs: (now - 600) * 1000, channel: 'all'}]);
    } finally {f.window.dispatch('pagehide'); stop();}
});

test('client rejects foreign origin/source, mismatched SteamID and invalid normalized replies', async () => {
    const f = fixture();
    const promise = requestQueueChat({window: f.window, steamId: id});
    const request = f.sent[0];
    const data = {...request, type: 'result', messages: []};
    f.window.dispatch('message', {source: {}, origin: f.window.location.origin, data});
    f.window.dispatch('message', {source: f.window, origin: 'https://evil.test', data});
    f.window.dispatch('message', {source: f.window, origin: f.window.location.origin, data: {...data, steamId: otherId}});
    let resolved = false; promise.then(() => {resolved = true;}, () => {});
    await tick(); assert.equal(resolved, false);
    f.window.postMessage({...data, messages: [{timeMs: NaN, text: 'x', channel: 'all'}]}, f.window.location.origin);
    await assert.rejects(promise, {code: 'INVALID_RESPONSE'});
    f.window.dispatch('pagehide');
});

test('MAIN ignores forged reads, duplicate nonces and invalid SteamID', async () => {
    const f = fixture(); const stop = installQueueChatBridge(f.dependencies);
    const data = {channel: QUEUE_CHAT_CHANNEL, type: 'read', nonce: '00000000-0000-4000-8000-000000000001', steamId: id};
    f.window.dispatch('message', {source: {}, origin: f.window.location.origin, data});
    f.window.dispatch('message', {source: f.window, origin: 'https://evil.test', data});
    f.window.postMessage({...data, steamId: '1'}, f.window.location.origin);
    f.window.postMessage(data, f.window.location.origin);
    f.window.postMessage(data, f.window.location.origin);
    await tick(); assert.equal(f.calls.length, 1); stop();
});

test('abort cancels only the matching request; late response cannot settle another request', async () => {
    const pending = [];
    const f = fixture((path, body, options) => new Promise(resolve => pending.push({resolve, options})));
    const stop = installQueueChatBridge(f.dependencies), controller = new AbortController();
    try {
        const first = requestQueueChat({window: f.window, steamId: id, signal: controller.signal});
        const rejected = assert.rejects(first, {code: 'ABORTED'});
        const second = requestQueueChat({window: f.window, steamId: otherId});
        await tick(); assert.equal(pending.length, 2);
        controller.abort(); await rejected;
        assert.equal(pending[0].options.signal.aborted, true);
        assert.equal(pending[1].options.signal.aborted, false);
        pending[0].resolve({status: 200, data: []}); pending[1].resolve({status: 200, data: []});
        assert.deepEqual(await second, []);
    } finally {f.window.dispatch('pagehide'); stop();}
});

test('errors never relay raw Axios errors/config; pagehide cleans requests/listeners', async () => {
    for (const [error, expected] of [[{response: {status: 429}, message: 'SECRET', config: {token: 'SECRET'}}, 'RATE_LIMIT'],
        [{message: 'SECRET'}, 'UNAVAILABLE']]) {
        const f = fixture(async () => {throw error;}); const stop = installQueueChatBridge(f.dependencies);
        await assert.rejects(requestQueueChat({window: f.window, steamId: id}), {code: expected});
        assert.equal(JSON.stringify(f.sent).includes('SECRET'), false);
        f.window.dispatch('pagehide'); stop();
        assert.equal(f.listeners.get('message').size, 0);
    }
    const f = fixture(() => new Promise(() => {})); const stop = installQueueChatBridge(f.dependencies);
    const promise = requestQueueChat({window: f.window, steamId: id});
    const rejected = assert.rejects(promise, {code: 'ABORTED'});
    await tick(); f.window.dispatch('pagehide'); await rejected;
    assert.equal(f.calls[0][2].signal.aborted, true);
    assert.equal(f.listeners.get('message').size, 0); stop();
});

test('bounded in-flight requests and pre-aborted signal do not dispatch extra reads', async () => {
    const f = fixture();
    const requests = Array.from({length: 8}, () => requestQueueChat({window: f.window, steamId: id}));
    const settled = Promise.allSettled(requests);
    await assert.rejects(requestQueueChat({window: f.window, steamId: id}), {code: 'BUSY'});
    const controller = new AbortController(); controller.abort();
    await assert.rejects(requestQueueChat({window: f.window, steamId: id, signal: controller.signal}), {code: 'ABORTED'});
    assert.equal(f.sent.filter(m => m.type === 'read').length, 8);
    f.window.dispatch('pagehide'); await settled;
});

test('MAIN deadline aborts hanging native requests and isolated deadline handles absent bridge', async t => {
    t.mock.timers.enable({apis: ['setTimeout']});
    const f = fixture(() => new Promise(() => {})); const stop = installQueueChatBridge(f.dependencies);
    try {
        const promise = requestQueueChat({window: f.window, steamId: id});
        const rejected = assert.rejects(promise, {code: 'TIMEOUT'});
        await tick(); t.mock.timers.tick(15000); await rejected;
        assert.equal(f.calls[0][2].signal.aborted, true);
        stop();
        const absent = requestQueueChat({window: f.window, steamId: id});
        const absentRejected = assert.rejects(absent, {code: 'TIMEOUT'});
        t.mock.timers.tick(16000); await absentRejected;
    } finally {f.window.dispatch('pagehide'); stop(); t.mock.timers.reset();}
});
