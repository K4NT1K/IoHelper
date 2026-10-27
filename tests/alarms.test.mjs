import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundScheduler, CONFIG_ALARM, SCHEDULE_ALARM, SCHEDULE_TIMEOUT, SCHEDULE_ALGORITHM, DAY_MS, scheduleSnapshot} from '../modules/BackgroundScheduler.js';
import {flattenModeratorGroup} from '../modules/shared/moderators.js';
import {deferred} from './clock.mjs';

const ID = '76561199163023778', OLD_ID = '76561199435476985';
const member = (steamId = ID, name = 'Moderator', className = 'Moderator Tier 1') => ({steamId, name, className});
const week = () => ({days: Array.from({length: 7}, (_, day) => ({day, members: day === 3 ? [] : [member()]}))});
const ui = {url: 'chrome-extension://test/analytics.html'};
const admin = {url: 'https://io.cybershoke.net/support/tickets', tab: {id: 7}};
const flush = async () => {for (let i = 0; i < 80; i++) await Promise.resolve();};
function setup(data = {helperSettings: {features: {scanSchedulePage: true}}}) {
    const alarms = new Map(), messages = [], writes = [], tabMutations = [];
    let native = async () => ({success: true, result: week()});
    let ping = async () => ({success: true, version: 2, scheduleNative: 1, busy: false});
    let tabs = [{id: 7, url: admin.url, active: true}];
    const storage = {get: async () => structuredClone(data), set: async values => {writes.push(structuredClone(values)); Object.assign(data, structuredClone(values));}};
    const api = {runtime: {getURL: path => 'chrome-extension://test/' + path}, storage: {local: storage, session: storage},
        alarms: {get: async key => alarms.get(key), create: async (key, info) => alarms.set(key, {...info, scheduledTime: info.when}), clear: async key => alarms.delete(key)},
        tabs: {query: async () => tabs,
            sendMessage: async (tabId, request) => {
                messages.push({tabId, ...request});
                if (request.action === 'analyticsPing') return ping();
                if (request.action === 'scheduleCollectNative') return native(request);
                if (request.action === 'scheduleCancelNative') return {success: true};
                throw new Error('Unexpected message');
            },
            create: async () => {tabMutations.push('create'); throw new Error('Do not create tabs');},
            update: async () => {tabMutations.push('update'); throw new Error('Do not navigate');},
            remove: async () => {tabMutations.push('remove'); throw new Error('Do not close user tabs');}}};
    return {scheduler: new BackgroundScheduler(api), api, data, alarms, messages, writes, tabMutations,
        set native(fn) {native = fn;}, set ping(fn) {ping = fn;}, set tabs(value) {tabs = value;}};
}

test('hourly configuration and daily schedule alarms survive worker reconstruction', async () => {
    const s = setup(); await s.scheduler.ensureAlarms();
    assert.equal(s.alarms.get(CONFIG_ALARM).periodInMinutes, 60);
    assert.equal(s.alarms.get(SCHEDULE_ALARM).periodInMinutes, 1440);
    const first = s.alarms.get(SCHEDULE_ALARM).scheduledTime;
    await new BackgroundScheduler(s.api).ensureAlarms();
    assert.equal(s.alarms.get(SCHEDULE_ALARM).scheduledTime, first);
});

test('API schedule: simultaneous wakeups and worker reload cannot run twice in 24 hours', async () => {
    const s = setup();
    const results = await Promise.all([s.scheduler.runDaily(), s.scheduler.runDaily(), s.scheduler.runDaily()]);
    assert.ok(results.every(result => result.status === 'complete'));
    assert.equal(s.messages.filter(m => m.action === 'scheduleCollectNative').length, 1);
    assert.equal(s.data.iohScheduleState.algorithm, SCHEDULE_ALGORITHM);
    await new BackgroundScheduler(s.api).runDaily();
    assert.equal(s.messages.filter(m => m.action === 'scheduleCollectNative').length, 1);
    s.data.iohScheduleState.lastStartedAt -= DAY_MS + 1;
    await s.scheduler.runDaily();
    assert.equal(s.messages.filter(m => m.action === 'scheduleCollectNative').length, 2);
    assert.deepEqual(s.tabMutations, []);
});

test('API schedule: old DOM run migrates once; successful snapshot is grouped and atomic', async () => {
    const s = setup({helperSettings: {features: {scanSchedulePage: true}},
        iohScheduleState: {status: 'complete', lastStartedAt: Date.now(), count: 56},
        helperScheduleModerators: {Tier: {[OLD_ID]: 'Former'}, source: 'schedule'}});
    assert.equal((await s.scheduler.runDaily()).status, 'complete');
    const committed = s.writes.filter(write => write.helperScheduleModerators);
    assert.equal(committed.length, 1);
    assert.equal(committed[0].iohScheduleState.status, 'complete');
    assert.deepEqual(flattenModeratorGroup(s.data.helperScheduleModerators.Tier), {[ID]: 'Moderator'});
    assert.ok(s.data.helperScheduleModerators.Tier['Tier 1']);
    assert.equal(s.data.helperScheduleModerators.members.length, 1);
    await new BackgroundScheduler(s.api).runDaily();
    assert.equal(s.messages.filter(m => m.action === 'scheduleCollectNative').length, 1);
});

test('API schedule: no existing admin stays pending without using the daily guard', async () => {
    const s = setup(); s.tabs = [];
    assert.equal((await s.scheduler.runDaily()).status, 'pending');
    assert.equal(s.data.iohScheduleState.lastStartedAt, undefined);
    assert.deepEqual(s.tabMutations, []);
    s.tabs = [{id: 7, url: admin.url}];
    assert.equal((await s.scheduler.runDaily()).status, 'complete');
});

test('API schedule: busy analytics stays pending and never consumes a daily run', async () => {
    const s = setup(); s.ping = async () => ({success: true, version: 2, scheduleNative: 1, busy: true});
    assert.equal((await s.scheduler.runDaily()).status, 'pending');
    assert.equal(s.messages.some(m => m.action === 'scheduleCollectNative'), false);
    s.ping = async () => ({success: true, scheduleNative: 1});
    s.native = async () => ({success: false, code: 'BUSY'});
    assert.equal((await s.scheduler.runDaily()).status, 'pending');
    assert.equal(s.data.iohScheduleState.lastStartedAt, 0);
    s.native = async () => ({success: true, result: week()});
    assert.equal((await new BackgroundScheduler(s.api).runDaily()).status, 'complete');
});

test('API schedule: incomplete or failed day preserves the last good snapshot and failure guard', async () => {
    const good = scheduleSnapshot(week());
    const s = setup({helperSettings: {features: {scanSchedulePage: true}}, helperScheduleModerators: good});
    s.native = async () => ({success: true, result: {days: week().days.slice(0, 6)}});
    assert.equal((await s.scheduler.runDaily()).status, 'failed');
    assert.deepEqual(s.data.helperScheduleModerators, good);
    assert.equal(s.writes.filter(write => write.helperScheduleModerators).length, 0);
    await new BackgroundScheduler(s.api).runDaily();
    assert.equal(s.messages.filter(m => m.action === 'scheduleCollectNative').length, 1);
});

test('API schedule: late response after disabling cannot replace last good data', async () => {
    const good = scheduleSnapshot(week());
    const s = setup({helperSettings: {features: {scanSchedulePage: true}}, helperScheduleModerators: good});
    const pending = deferred(); s.native = () => pending.promise;
    const running = s.scheduler.runDaily(); await flush();
    assert.equal(s.data.iohScheduleState.status, 'running');
    s.data.helperSettings.features.scanSchedulePage = false;
    await s.scheduler.cancelCurrent('disabled');
    pending.resolve({success: true, result: week()}); await running;
    assert.equal(s.data.iohScheduleState.status, 'cancelled');
    assert.deepEqual(s.data.helperScheduleModerators, good);
    assert.ok(s.messages.some(m => m.action === 'scheduleCancelNative'));
});

test('API schedule: timeout aborts native read and never closes or navigates a user tab', async () => {
    const s = setup({helperSettings: {features: {scanSchedulePage: true}}, iohScheduleState: {
        status: 'running', algorithm: SCHEDULE_ALGORITHM, runId: 'old', nonce: 'old', sourceTabId: 7,
        lastStartedAt: Date.now() - 130000, leaseUntil: Date.now() - 1}});
    await s.scheduler.expireScan();
    assert.equal(s.data.iohScheduleState.status, 'failed');
    assert.ok(s.messages.some(m => m.action === 'scheduleCancelNative'));
    assert.deepEqual(s.tabMutations, []);
});

test('manual analytics roster read works with scan disabled, without changing the flag', async () => {
    const s = setup({helperSettings: {features: {scanSchedulePage: false}}});
    await s.scheduler.ensureAlarms(); assert.equal(s.alarms.has(SCHEDULE_ALARM), false);
    assert.equal((await s.scheduler.runDaily()).status, 'disabled');
    const response = await s.scheduler.requestDaily(ui, {clientRequestId: crypto.randomUUID()});
    assert.equal(response.status, 'complete'); assert.equal(response.snapshot.count, 1);
    assert.equal(s.data.helperSettings.features.scanSchedulePage, false);
    assert.equal(s.alarms.has(SCHEDULE_ALARM), false);
    assert.equal((await s.scheduler.requestDaily({url: 'https://other.invalid/', tab: {id: 99}})).success, false);
});

test('manual cancellation before native dispatch cancels only its own clientRequestId', async () => {
    const s = setup({helperSettings: {features: {scanSchedulePage: false}}});
    const pong = deferred(), id = crypto.randomUUID(); s.ping = () => pong.promise;
    const running = s.scheduler.requestDaily(ui, {clientRequestId: id}); await flush();
    assert.equal((await s.scheduler.cancelRequest({clientRequestId: crypto.randomUUID()}, ui)).success, false);
    assert.equal((await s.scheduler.cancelRequest({clientRequestId: id}, ui)).success, true);
    pong.resolve({success: true, scheduleNative: 1}); await running;
    assert.equal(s.messages.some(m => m.action === 'scheduleCollectNative'), false);
});

test('manual cancellation during native read ignores late results and leaves preferences unchanged', async () => {
    const s = setup({helperSettings: {features: {scanSchedulePage: false}}});
    const pending = deferred(), id = crypto.randomUUID(); s.native = () => pending.promise;
    const running = s.scheduler.requestDaily(ui, {clientRequestId: id}); await flush();
    assert.equal(s.data.iohScheduleState.clientRequestId, id);
    await s.scheduler.cancelRequest({clientRequestId: id}, ui);
    pending.resolve({success: true, result: week()}); await running;
    assert.equal(s.data.iohScheduleState.status, 'cancelled');
    assert.equal(s.data.helperScheduleModerators, undefined);
    assert.equal(s.data.helperSettings.features.scanSchedulePage, false);
});

test('readonly role export replaces former Tier but preserves all other moderator groups', async () => {
    const snapshot = scheduleSnapshot(week());
    const s = setup({helperScheduleModerators: snapshot, helperConfig: {moderators: {Tier: {[OLD_ID]: 'Former'}, Jail: {[OLD_ID]: 'Jail Moderator'}, verification: {}}}});
    const before = structuredClone(s.data);
    const response = await s.scheduler.getModeratorConfig(admin);
    assert.equal(response.success, true);
    assert.deepEqual(flattenModeratorGroup(response.moderators.Tier), {[ID]: 'Moderator'});
    assert.deepEqual(response.moderators.Jail, {[OLD_ID]: 'Jail Moderator'});
    assert.deepEqual(s.data, before);
    assert.equal((await s.scheduler.getModeratorConfig({url: 'chrome-extension://foreign/analytics.html'})).success, false);
});

test('snapshot rejects empty weeks and role conflicts; empty individual days are valid', () => {
    assert.equal(scheduleSnapshot(week()).members.length, 1);
    assert.throws(() => scheduleSnapshot({days: week().days.map(day => ({...day, members: []}))}), /не найдены/);
    const conflicting = week(); conflicting.days[0].members = [member(ID, 'Moderator', 'Advanced')];
    assert.throws(() => scheduleSnapshot(conflicting), /разные должности/);
    const filtered = week(); filtered.days[0].members.push(member(OLD_ID, 'Special', 'Jail Moderator'));
    assert.equal(scheduleSnapshot(filtered).members.length, 1);
    assert.equal(SCHEDULE_TIMEOUT, 'ioh-schedule-timeout');
});
