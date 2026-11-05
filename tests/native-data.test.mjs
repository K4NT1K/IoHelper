import test from 'node:test';
import assert from 'node:assert/strict';
import {describeRequest, normalizeResponse, normalizeFailure, siteTime, punishmentActive, CHANNEL} from '../modules/native/model.js';
import {NativeDataStore} from '../modules/native/Store.js';
import {installNativeObserver} from '../modules/native/Observer.js';
import {startNativeDataClient} from '../modules/native/Client.js';
import {observeNativeBootstrap} from '../modules/native/Bootstrap.js';
import {clock} from './clock.mjs';

const origin = 'https://io.cybershoke.net', id = '76561198000000001', sender = '76561198000000002';
const now = Date.parse('2026-11-05T13:00:00Z');
const config = (path, data, baseURL = origin + '/api') => ({baseURL, url: path, method: data ? 'post' : 'get', data});
const normalize = (path, data, body, at = now, baseURL) => normalizeResponse(describeRequest(config(path, body, baseURL), origin), data, {startedAt: at, receivedAt: at + 20, sequence: at});
const row = (extra = {}) => ({id: 1, steamid64_sender: sender, steamid64_suspect: id, reason: 'ReasonPlayer_Cheating', server_ip: '127.0.0.1', server_port: 27015, ...extra});

test('Native normalizers: exact endpoint/method allowlist and safe request identity', () => {
    assert.equal(describeRequest(config('/ticket/accept/1'), origin), null);
    assert.equal(describeRequest({...config('/ticket/list'), method: 'POST'}, origin), null);
    assert.equal(describeRequest(config('/user/data', {steamid64: id}, 'https://evil.invalid/api'), origin), null);
    assert.equal(describeRequest(config('/user/data', {steamid64: id}, 'https://cybershoke.net/api'), origin).steamId, id);
    assert.equal(describeRequest(config('/ticket/get/1'), origin).id, 1);
});

test('Native list fields never imply current presence or active punishment', () => {
    const s = new NativeDataStore(); s.apply(normalize('/ticket/list', [row({playtime_suspect: '3600', country_suspect: 'ru'})]));
    assert.equal(s.tickets.get('ticket:1').complaintServer, '127.0.0.1:27015');
    assert.equal(s.player(id).playtime, 3600); assert.equal('serverIp' in s.player(id), false);
    assert.equal('isBanned' in s.player(id), false);
    s.apply(normalize('/ticket/list', [], null, now + 100)); assert.equal(s.queueTickets().length, 0);
});

test('Late responses and partial list updates preserve newer presence and profile fields', () => {
    const s = new NativeDataStore();
    s.apply(normalize('/user/data', {basic: {steamid64: id, country: 'de'}, server: {server_ip: '127.0.0.2', server_port: 27015}}, {steamid64: id}, now + 100, 'https://cybershoke.net/api'));
    s.apply(normalize('/ticket/list', [row({country_suspect: 'ru', playtime_suspect: 100})], null, now));
    assert.equal(s.player(id).country, 'de'); assert.equal(s.player(id).serverIp, '127.0.0.2:27015');
    assert.equal(s.apply(normalize('/ticket/list', [row({country_suspect: 'ru'})], null, now - 100)), false);
    const at = s.player(id).presenceAt; s.apply(normalize('/ticket/list', [row({message: 'new'})], null, now + 200));
    assert.equal(s.player(id).presenceAt, at);
});

test('Faceit: verified native basic.connect.faceit schema, hide, absence and no ELO-derived level', () => {
    const body = {steamid64: id}, base = 'https://cybershoke.net/api';
    const n = faceit => normalize('/user/data', {basic: {steamid64: id, connect: {faceit}}}, body, now, base);
    assert.deepEqual(n({name: 'example', elo: 2278, skill_level: 10, hide: false}).payload.faceit, {elo: 2278, level: 10});
    assert.equal(n({name: 'example', elo: 2278, skill_level: 10, hide: true}).payload.faceit, null);
    assert.equal(n(null).payload.faceit, null);
    assert.equal(n({name: null}).payload.faceit, null);
    assert.deepEqual(n({elo: 2278}).payload.faceit, {elo: 2278, level: null});
    assert.deepEqual(n({name: 'example', elo: 1500, skill_level: 0}).payload.faceit, {elo: 1500, level: null});
    assert.equal('faceit' in normalize('/user/data', {basic: {}}, body, now, base).payload, false);
});

test('Site timestamps are parsed explicitly as Moscow time; closed ticket may have a start', () => {
    assert.equal(siteTime('2026-11-05 15:57:55'), Date.parse('2026-11-05T12:57:55Z'));
    const e = normalize('/ticket/get/1', {result: 'success', json: row({status: 2, start_timestamp: '2026-11-05 15:00:00', end_unixtime: '1793883600'})});
    assert.equal(e.payload.status, 2); assert(e.payload.startedAt); assert(e.payload.endedAt);
});

test('Connections: only newest connection determines presence, including several true flags', () => {
    const e = normalize('/ticket/get/1', {json: row({suspect_connect: [
        {unixtime_connect: 100, is_online: true, server_ip: '127.0.0.1', server_port: 27015},
        {unixtime_connect: 200, is_online: false, unixtime_disconnect: 300, server_ip: '127.0.0.2', server_port: 27015}
    ]})});
    assert.equal(e.payload.presence.serverIp, null);
    assert.equal('presence' in normalize('/ticket/get/1', {json: row({suspect_connect: []})}).payload, false);
    assert.equal(normalize('/ticket/get/1', {json: row({suspect_connect: [{is_online: false, unixtime_connect: 100, server_ip: '127.0.0.1', server_port: 27015}]})}).payload.presence.serverIp, null);
});

test('Histories distinguish missing/error/filtered from a successful complete empty result', () => {
    const b = {data: {steamid64: id}}, s = new NativeDataStore();
    assert.equal(s.history(id, 'chats'), null);
    assert.equal(normalize('/ticket/chats/history', {result: 'error'}, b), null);
    assert.equal(normalize('/ticket/chats/history', [], {data: {steamid64: id, limit: 10}}), null);
    assert.equal(normalize('/ticket/chats/history', [], {data: {steamid64: id}, limit: 10}), null);
    const filtered = describeRequest({...config('/ticket/chats/history', b), params: {offset: 10}}, origin);
    assert.equal(normalizeResponse(filtered, []), null);
    s.apply(normalize('/ticket/chats/history', [], b)); assert.deepEqual(s.history(id, 'chats').items, []);
    assert.equal(normalize('/ticket/chats/history', [{unixtime: now / 1000, msg: '<script>', steamid64: sender}], b), null);
});

test('Chat identity survives insertion/reordering and preserves repeated messages separately', () => {
    const b = {data: {steamid64: id}}, a = {msg: 'one', unixtime: now / 1000}, x = {msg: 'two', unixtime: now / 1000 - 1};
    const before = normalize('/ticket/chats/history', [a, a], b).payload.items;
    const after = normalize('/ticket/chats/history', [x, a, a], b).payload.items;
    assert.equal(before[0].id, after[1].id); assert.equal(before[1].id, after[2].id);
    assert.notEqual(before[0].id, before[1].id);
});

test('Interleaved list/detail merge per field, and a full detail can remove its timer', () => {
    const s = new NativeDataStore();
    s.apply(normalize('/ticket/list', [row({message: 'new message', status: 1})], null, now + 100));
    s.apply(normalize('/ticket/get/1', {json: row({message: 'old message', status: 0, suspect_notice: [], start_timestamp: '2026-11-05 15:00:00'})}, null, now));
    const t = s.tickets.get('ticket:1');
    assert.equal(t.message, 'new message'); assert.equal(t.status, 1);
    assert.deepEqual(t.warnings, []); assert.equal(t.startedAt, siteTime('2026-11-05 15:00:00'));
    s.apply(normalize('/ticket/get/1', {json: row({status: 1})}, null, now + 200));
    assert.equal(s.tickets.get('ticket:1').startedAt, null);
});

test('Evicting resource replay does not permit old histories or deleted queue membership to return', () => {
    const s = new NativeDataStore(), b = {data: {steamid64: id}};
    s.apply(normalize('/ticket/chats/history', [{msg: 'new', unixtime: now / 1000}], b, now + 200));
    s.apply(normalize('/ticket/list', [], null, now + 200));
    for (let i = 0; i < 170; i++) s.apply(normalize('/ticket/get/' + (i + 2), {json: row({id: i + 2})}, null, now + 300 + i));
    assert.equal(s.apply(normalize('/ticket/chats/history', [{msg: 'old', unixtime: now / 1000}], b, now)), false);
    assert.equal(s.apply(normalize('/ticket/list', [row()], null, now)), false);
    assert.equal(s.history(id, 'chats').items[0].text, 'new'); assert.equal(s.queueTickets().length, 0);
});

test('A later explicit punishment status overrides old records, including same-millisecond requests', () => {
    const s = new NativeDataStore(), b = {data: {steamid64: id}}, created = Date.now() / 1000 - 10;
    const e = normalize('/ticket/bans/history', [{created, length: 3600, ends: created + 3600}], b);
    s.apply(e); assert(s.active(id, 'bans'));
    s.mergePlayer(id, {isBanned: false}, {...e, sequence: e.sequence + 1});
    assert.equal(s.active(id, 'bans'), null);
    s.mergePlayer(id, {isBanned: true}, {...e, sequence: e.sequence + 2});
    assert.equal(s.active(id, 'bans'), null); // boolean-only success must not invent old punishment details
});

test('A failed resource is distinct from unknown and empty; errors retain the last known facts', () => {
    const s = new NativeDataStore(), d = describeRequest(config('/ticket/bans/history', {data: {steamid64: id}}), origin);
    assert.equal(s.resourceState(d.key), 'unknown');
    s.apply(normalizeResponse(d, [], {startedAt: now, sequence: 1}));
    assert.equal(s.resourceState(d.key), 'ready'); assert.equal(s.player(id).isBanned, false);
    s.apply(normalizeFailure(d, {startedAt: now + 100, status: 429, sequence: 2}));
    assert.equal(s.resourceState(d.key), 'error'); assert.equal(s.player(id).isBanned, false);
    assert.deepEqual(s.history(id, 'bans').items, []);
});

test('Early isolated client respects master-off despite a stale storage read, validates nonce, and replays after BFCache', () => {
    const win = new EventTarget(), sent = [], callbacks = new Set(); let initial;
    win.crypto = {randomUUID: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
    win.location = {origin}; win.postMessage = m => sent.push(m);
    const chrome = {storage: {local: {get: (_keys, callback) => {initial = callback;}}, onChanged: {addListener: l => callbacks.add(l), removeListener: l => callbacks.delete(l)}}};
    const client = startNativeDataClient({window: win, chrome});
    [...callbacks][0]({scriptEnabled: {newValue: false}}, 'local'); initial({scriptEnabled: true});
    assert.deepEqual(sent.map(x => x.type), ['stop']);
    [...callbacks][0]({scriptEnabled: {newValue: true}}, 'local');
    const dispatch = data => {const e = new Event('message');Object.assign(e, {source: win, origin, data: {channel: CHANNEL, ...data}});win.dispatchEvent(e);};
    const event = normalize('/ticket/list', [row()]);
    dispatch({type: 'data', nonce: 'other', event}); assert.equal(client.store.tickets.size, 0);
    dispatch({type: 'data', nonce: win.crypto.randomUUID(), event}); assert.equal(client.store.tickets.size, 1);
    const show = new Event('pageshow'); show.persisted = true; win.dispatchEvent(show); assert.equal(sent.at(-1).type, 'start');
    client.stop(); assert.equal(callbacks.size, 0); assert.equal(client.store.tickets.size, 0);
});

test('Punishments: removal, expiry, permanence and provider-specific history type', () => {
    const b = {data: {steamid64: id}}, created = now / 1000 - 10;
    const p = extra => ({created, length: 3600, ends: created + 3600, reason: 'Reason_Mute_Toxic', ...extra});
    const e = normalize('/ticket/mutes/history', [p({bid: 1, type: 1}), p({bid: 2, RemoveType: 'U'}), p({bid: 3, length: 0, ends: 0})], b);
    assert.equal(e.payload.items[0].type, 1); assert.equal(e.payload.items[0].reason, 'Токсичность');
    assert.equal(punishmentActive(e.payload.items[0], now), true);
    assert.equal(punishmentActive(e.payload.items[1], now), false);
    assert.equal(punishmentActive(e.payload.items[2], now + 1e12), true);
});

test('Account/bypass sanitization excludes authentication and unrelated personal fields', () => {
    const a = normalize('/admin/data/login', {'admin-data': {steamid64: id, access_group: ['web.users.bans.set'], access_abc: 'b1', token: 'secret', email: 'private'}});
    assert.deepEqual(Object.keys(a.payload).sort(), ['flags', 'groups', 'steamId']);
    const b = normalize(`/user/${id}/bans/bypasses/status`, {result: 'success', data: {checked: true, has_bypass: true, banned_accounts: 2, is_public_ip: true, private: 'secret'}});
    assert.equal(b.payload.bannedAccounts, 2); assert.equal('private' in b.payload, false);
});

test('MAIN observer observes both native clients, leaves responses/errors intact and stops cleanly', async t => {
    const time = clock(t), win = new EventTarget(), sent = [], events = new Map();
    win.location = {origin}; win.postMessage = m => sent.push(m);
    win.MutationObserver = class {observe() {} disconnect() {}};
    const manager = () => ({use(...f) {const key = events.size + 1; events.set(key, f); return key;}, eject(key) {events.delete(key);}});
    const admin = {post() {throw new Error('No requests allowed');}, defaults: {baseURL: origin + '/api'}, interceptors: {request: manager(), response: manager()}};
    const pub = {...admin, defaults: {baseURL: 'https://cybershoke.net/api'}, interceptors: {request: manager(), response: manager()}};
    const entry = origin + '/entry.js', shared = origin + '/client.js';
    const stop = installNativeObserver({window: win, document: {querySelectorAll: () => [{src: entry}]},
        fetchText: async url => url === entry ? 'import{a}from"./client.js"' : 'a.interceptors.request.use(()=>{});export{a}',
        importModule: async url => {assert.equal(url, shared); return {a: admin, b: pub};}});
    const dispatch = data => {const e = new Event('message');Object.assign(e, {source: win, origin, data: {channel: CHANNEL, ...data}});win.dispatchEvent(e);};
    dispatch({type: 'start', nonce: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}); await time.flush();
    assert.equal(events.size, 4);
    const responseHook = [...events.values()].filter(x => x.length === 2)[0];
    const requestHook = [...events.values()].find(x => x.length === 1)[0];
    const cfg = config('/ticket/list'), response = {status: 200, config: cfg, data: [row()]};
    assert.equal(requestHook(cfg), cfg);
    assert.equal(responseHook[0](response), response); assert.equal(sent.filter(m => m.type === 'data').length, 1);
    const error = {response: {status: 403, config: cfg}, config: {headers: {Authorization: 'secret'}}};
    await assert.rejects(responseHook[1](error), e => e === error);
    const oldCfg = config('/ticket/list'); requestHook(oldCfg);
    dispatch({type: 'stop', nonce: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
    dispatch({type: 'start', nonce: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}); await time.flush();
    const newHook = [...events.values()].find(x => x.length === 2);
    const before = sent.length;
    newHook[0]({...response, config: oldCfg}); assert.equal(sent.length, before);
    assert(!JSON.stringify(sent).includes('Authorization')); stop(); assert.equal(events.size, 0);
});

test('Native bootstrap observes only the existing cached login, with no query/refetch or React hook calls', () => {
    const seen = []; let listener, released = false;
    const state = {status: 'success', dataUpdatedAt: now, data: {'admin-data': {steamid64: id, access_group: [], access_abc: 'b1'}}};
    const client = {getQueryCache: () => ({subscribe(fn) {listener = fn; return () => {released = true;};}}),
        getQueryState: key => {assert.deepEqual(key, ['auth', 'me']); return state;},
        refetchQueries() {assert.fail('No requests permitted');}, fetchQuery() {assert.fail('No requests permitted');}};
    const root = {__reactContainer$fixture: {child: {memoizedProps: {client}}}};
    const stop = observeNativeBootstrap({querySelectorAll: () => [root]}, (...x) => seen.push(x));
    assert.equal(seen.length, 1);
    listener({query: {queryKey: ['auth', 'me']}}); assert.equal(seen.length, 1);
    state.dataUpdatedAt++; listener({query: {queryKey: ['auth', 'me']}}); assert.equal(seen.length, 2);
    stop(); assert.equal(released, true);
});

test('Resource retention is bounded; malformed replies cannot clear known state', () => {
    const s = new NativeDataStore();
    for (let i = 0; i < 600; i++) s.apply(normalize('/ticket/get/' + (i + 1), {json: row({id: i + 1})}, null, now + i));
    assert(s.tickets.size <= 500); assert(s.resources.size <= 160);
    assert.equal(s.apply(null), false); assert.equal(s.tickets.size, 500);
});
