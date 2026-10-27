import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDirectory, filterDirectory, searchDirectory, resolveModerator} from '../modules/analytics/directory.js';
import {metricValue, rankProfiles, runCohort} from '../modules/analytics/cohort.js';
const ids = ['76561199163023778', '76561199435476985', '76561198000000000', '76561198000000001'];
test('directory: merge config and schedule, exclude verified players, preserve aliases and categories', () => {
    const directory = buildDirectory({moderators: {Tier: {[ids[0]]: 'OldName'}, Jail: {[ids[0]]: 'OtherName'}, verification: {[ids[1]]: 'Player'}}},
        {Tier: {[ids[0]]: 'NewName', [ids[2]]: 'Third', invalid: 'Bad'}});
    assert.equal(directory.length, 2);
    const mod = directory.find(m => m.steamId === ids[0]);
    assert.equal(mod.name, 'NewName'); assert.deepEqual(mod.categories, ['Tier']);
    assert.deepEqual(mod.sources, ['config', 'schedule']);
    assert.equal(searchDirectory(directory, 'OLD')[0].steamId, ids[0]);
    assert.equal(searchDirectory(directory, ids[2].slice(-8))[0].steamId, ids[2]);
    assert.equal(filterDirectory(directory, 'config').length, 1);
    assert.equal(resolveModerator('newNAME', '', directory), ids[0]);
    assert.equal(resolveModerator('NewName', ids[0], directory), ids[0]);
    assert.equal(resolveModerator('missing', '', directory), null);
    assert.equal(resolveModerator('same', '', [{steamId: ids[0], name: 'same'}, {steamId: ids[1], name: 'same'}]), null);
});
const profile = (id, tickets = 10) => ({steamId: id, totals: {tickets, reports: 2, complaints: tickets + 2, bans: 3, mutes: 4}, perActiveDay: 4,
    coverage: Object.fromEntries(['tickets', 'reports', 'bans', 'mutes'].map(k => [k, {available: true}]))});
test('cohort: ties share places, missing or partial metrics excluded instead of ranked as zero', () => {
    const first = profile(ids[0]), second = profile(ids[1]), third = profile(ids[2], 1), partial = profile(ids[3], 1000);
    partial.coverage.tickets.partial = true;
    assert.deepEqual(rankProfiles([third, second, partial, first], 'tickets').map(r => r.rank), [1, 1, 3]);
    assert.equal(metricValue(partial, 'complaints'), null); assert.equal(metricValue(partial, 'perActiveDay'), null);
    assert.equal(metricValue(first, 'punishments'), 7);
    first.totals.mutes = null; assert.equal(metricValue(first, 'punishments'), null);
    assert.equal(metricValue(first, 'qualityScore'), null);
});
const state = () => ({members: ids.map(steamId => ({steamId, name: steamId})), profiles: [], failed: [], finishedIds: [], total: 4, completed: 0});
test('cohort runner: sequential calls, cancellation preserves checkpoint and resumes remaining members', async () => {
    const data = state(); let current = true, active = 0, max = 0; const seen = [];
    const options = {collect: async member => {active++; max = Math.max(max, active); seen.push(member.steamId); await Promise.resolve(); active--; return profile(member.steamId);},
        save: async () => {}, onProgress: () => {if (data.completed === 2) current = false;}, isCurrent: () => current, pause: async () => {}};
    await runCohort(data, options);
    assert.equal(max, 1); assert.equal(data.status, 'cancelled'); assert.equal(data.profiles.length, 2);
    current = true; options.onProgress = () => {};
    await runCohort(data, options);
    assert.equal(data.status, 'complete'); assert.equal(data.completed, 4);
    assert.deepEqual(seen, ids);
});
test('cohort runner: stop after three consecutive failures; never create fake zero profiles', async () => {
    const data = state(); let calls = 0;
    await runCohort(data, {collect: async () => {calls++; throw new Error('Session expired');}, save: async () => {}, onProgress: () => {}, isCurrent: () => true, pause: async () => {}});
    assert.equal(calls, 3); assert.equal(data.status, 'failed'); assert.equal(data.completed, 3);
    assert.equal(data.profiles.length, 0); assert.equal(data.failed.length, 3);
});
test('cohort runner: ignore a late response after cancellation', async () => {
    const data = state(); let current = true;
    await runCohort(data, {collect: async member => {current = false; return profile(member.steamId);}, save: async () => {}, onProgress: () => {}, isCurrent: () => current});
    assert.equal(data.status, 'cancelled'); assert.equal(data.completed, 0); assert.equal(data.profiles.length, 0);
});
test('cohort runner: partial core data is provisional and eligible for retry, expected partial shifts are allowed', async () => {
    const data = state(); data.members = data.members.slice(0, 1); data.total = 1;
    await runCohort(data, {collect: async member => {const p = profile(member.steamId); p.coverage.bans.partial = true; return p;},
        save: async () => {}, onProgress: () => {}, isCurrent: () => true});
    assert.equal(data.profiles.length, 1); assert.equal(data.failed.length, 1);
    assert.equal(rankProfiles(data.profiles, 'bans').length, 0);
    data.finishedIds = []; data.completed = 0; data.failed = [];
    await runCohort(data, {collect: async member => {const p = profile(member.steamId); p.coverage.shifts = {available: true, partial: true}; return p;},
        save: async () => {}, onProgress: () => {}, isCurrent: () => true});
    assert.equal(data.profiles.length, 1); assert.equal(data.failed.length, 0);
    assert.equal(rankProfiles(data.profiles, 'bans').length, 1);
});
