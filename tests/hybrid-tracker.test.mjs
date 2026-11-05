import test from 'node:test';
import assert from 'node:assert/strict';
import {OffenderTrackingMethods} from '../modules/ticket/OffenderTracking.js';
import {NativeTicketMethods} from '../modules/ticket/NativeData.js';
import {NativeDataStore} from '../modules/native/Store.js';
import {clock, deferred} from './clock.mjs';

const id = '76561198000000001';
test('Tracker deduplicates reads and publishes hours/Faceit/presence to the same native store immediately', async t => {
    const time = clock(t), pending = deferred(); let requests = 0, events = 0;
    const store = new NativeDataStore(); store.subscribe(e => {assert.equal(e.source, 'tracker');events++;});
    const ctx = {...OffenderTrackingMethods, ...NativeTicketMethods, nativeData: store, offenderProjectInflight: new Map(),
        fetchUserData: async () => {requests++;return pending.promise;}};
    const a = ctx.fetchParsedUserData(id), b = ctx.fetchParsedUserData(id); await time.flush();
    assert.equal(requests, 1);
    pending.resolve({ok: true, status: 200, json: async () => ({basic: {steamid64: id, bans_list: [], connect: {faceit: {name: 'x', elo: 1550, skill_level: 0}}},
        server: null, cybershoke: {global: {playtime: 7200}}})});
    await Promise.all([a,b]);
    assert.equal(events, 1); assert.equal(store.player(id).playtime, 7200);
    assert.deepEqual(store.player(id).faceit, {elo: 1550, level: null}); assert.equal(store.player(id).serverIp, null);
    assert.equal(ctx.getCachedUserData(id, 5000).playtime, 7200);
    await time.advance(5000); assert.equal(ctx.getCachedUserData(id, 5000), null);
    assert.equal(ctx.getCachedUserData(id).playtime, 7200); assert.equal(time.timers.size, 0);
});

test('429 and malformed tracker replies preserve last-known facts and release inflight state', async t => {
    clock(t); const store = new NativeDataStore(); store.mergePlayer(id, {serverIp: '127.0.0.1:27015', playtime: 3600}, {startedAt: 1, sequence: 1, receivedAt: 1});
    const ctx = {...OffenderTrackingMethods, ...NativeTicketMethods, nativeData: store, offenderProjectInflight: new Map(),
        fetchUserData: async () => ({status: 429})};
    await assert.rejects(ctx.fetchParsedUserData(id), /429/);
    ctx.fetchUserData = async () => ({ok: true, status: 200, json: async () => ({result: 'error'})});
    await assert.rejects(ctx.fetchParsedUserData(id), /формат/);
    assert.equal(store.player(id).serverIp, '127.0.0.1:27015'); assert.equal(ctx.offenderProjectInflight.size, 0);
});
