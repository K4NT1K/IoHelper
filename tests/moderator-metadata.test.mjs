import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ConfigService} from '../modules/ConfigService.js';
import {flattenModeratorGroup, moderatorEntries, groupModeratorsByRole, validModeratorGroup} from '../modules/shared/moderators.js';
import {buildDirectory} from '../modules/analytics/directory.js';
import {aggregateProfile, dayStart} from '../modules/analytics/model.js';
import {metricValue, rankProfiles} from '../modules/analytics/cohort.js';
const a = '76561199163023778', b = '76561199435476985', c = '76561198000000000';
const coverage = () => Object.fromEntries(['tickets', 'reports', 'bans', 'mutes'].map(k => [k, {available: true, start: '2019-01-01'}]));
test('moderator roles: nested and legacy groups flatten identically, role keys are validated', () => {
    const nested = groupModeratorsByRole([{steamId: a, name: 'A', className: 'Moderator Tier1'}, {steamId: b, name: 'B', className: 'Moderator New'}]);
    assert.deepEqual(Object.keys(nested), ['Tier 1', 'New moderator']);
    assert.deepEqual(flattenModeratorGroup(nested), {[a]: 'A', [b]: 'B'});
    assert.equal(moderatorEntries(nested)[0].className, 'Tier 1');
    assert.deepEqual(flattenModeratorGroup({[a]: 'A'}), {[a]: 'A'});
    assert.equal(validModeratorGroup({'Tier 1': {[a]: 1}}), false);
    assert.equal(validModeratorGroup({'Tier 1': {'invalid': 'Name'}}), false);
    const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
    assert.equal(ConfigService.isValid(config), true);
});
test('directory: specialist groups excluded, worktime role replaces fallback config role', () => {
    const config = {moderators: {Tier: {'Tier 1': {[a]: 'Old'}}, Jail: {[b]: 'Jailer'}, Hns: {[c]: 'HNS'}, Movement: {[b]: 'Mover'}}};
    const directory = buildDirectory(config, {Tier: {'Advanced': {[a]: 'New'}}, members: [{steamId: a, name: 'New', className: 'Advanced'}, {steamId: b, name: 'Jailer', className: 'Jail Moderator'}]});
    assert.equal(directory.length, 1); assert.equal(directory[0].className, 'Advanced');
    assert.deepEqual(directory[0].aliases, ['Old', 'New']);
});
test('career date: earliest full-history punishment, independent of period and removed filter', () => {
    const source = {steamId: a, className: 'Moderator Tier 1', coverage: coverage(),
        bans: [{id: 'old', created: dayStart('2019-05-01'), removed: true}, {id: 'invalid', created: 0}],
        mutes: [{id: 'new', created: dayStart('2020-05-01')}], tickets: [], reports: []};
    const profile = aggregateProfile(source, {start: '2026-10-01', end: '2026-10-27'}, false);
    assert.equal(profile.firstPunishmentAt, dayStart('2019-05-01')); assert.equal(profile.firstPunishmentComplete, true);
    assert.equal(profile.className, 'Moderator Tier 1'); assert.equal(profile.totals.bans, 0);
    source.coverage.mutes.partial = true;
    assert.equal(aggregateProfile(source, profile.range).firstPunishmentComplete, false);
});
test('impact: volume ratio may exceed 100, zero denominator and partial data are excluded', () => {
    const p = {steamId: a, coverage: coverage(), totals: {tickets: 2, reports: 2, complaints: 4, bans: 3, mutes: 5}};
    assert.equal(metricValue(p, 'punishmentsPer100Complaints'), 200);
    p.totals.complaints = 0; assert.equal(metricValue(p, 'punishmentsPer100Complaints'), null);
    p.totals.complaints = 4; p.coverage.bans.partial = true;
    assert.equal(rankProfiles([p], 'punishmentsPer100Complaints').length, 0);
});
