import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateProfile, dayKey, dayStart, dateRange, parseSteamId, rankDays, validateRange,profileRatios} from '../modules/analytics/model.js';
import {requestDescriptor, sanitizeResponse,safeAvatarUrl} from '../modules/analytics/schema.js';
const range = {start: '2026-10-01', end: '2026-10-03'};
const source = {steamId: '76561199163023778', tickets: [{date: '2026-10-01', count: 2}], reports: [{date: '2026-10-02', count: 2}],
    coverage: Object.fromEntries(['tickets', 'reports', 'bans', 'mutes'].map(k => [k, {available: true}])),
    bans: [{id: '1', created: dayStart(range.start), reason: '<x>', removed: true}, {id: '1', created: dayStart(range.start)}],
    shifts: [{start: dayStart('2026-10-02') - 3600, end: dayStart('2026-10-02') + 3600}]};
test('Analytics: Steam IDs and exact profile URLs only', () => {
    assert.equal(parseSteamId(source.steamId), source.steamId);
    assert.equal(parseSteamId('https://io.cybershoke.net/moderator/profile/' + source.steamId), source.steamId);
    assert.equal(parseSteamId('https://evil.example/' + source.steamId), null);
});
test('Analytics: Moscow midnight and inclusive fixed calendar period', () => {
    assert.equal(dayKey(Date.parse('2026-10-01T21:00Z') / 1000), '2026-10-02');
    assert.deepEqual(dateRange(7, Date.parse('2026-10-03T12:00Z')), {start: '2026-09-27', end: '2026-10-03'});
    assert.equal(validateRange({start: '2026-02-30', end: '2026-03-01'}), false);
    assert.equal(validateRange(range), true);
    assert.equal(validateRange({start:'2018-12-31',end:range.end}),false);
    assert.equal(validateRange({start:'2019-01-01',end:range.end}),true);
});
test('Analytics: deduplicate actions, removed filter, ties, and no per-hour when coverage is missing', () => {
    const data = aggregateProfile(source, range);
    assert.equal(data.totals.complaints, 4); assert.equal(data.totals.bans, 1);
    assert.equal(data.removed.bans, 1); assert.equal(data.perHour, null);
    assert.deepEqual(rankDays(data.days, 'complaints').map(d => d.rank), [1, 1]);
    assert.equal(aggregateProfile(source, range, false).totals.bans, 0);
    assert.equal(aggregateProfile({...source, coverage: {}}, range).totals.bans, null);
});
test('Analytics: shift crossing midnight split without double-counting', () => {
    const data = aggregateProfile({...source, coverage: {...source.coverage, shifts: {available: true, start: range.start, end: range.end}}}, range);
    assert.equal(data.totals.seconds, 7200); assert.equal(data.days[0].seconds, 3600); assert.equal(data.days[1].seconds, 3600);
    assert.equal(data.perHour, 2);
    assert.equal(aggregateProfile({...source,coverage:{...source.coverage,shifts:{available:true,start:range.start,end:range.end,partial:true}}},range).perHour,null);
});
test('Analytics: bridge allowlist and personal data minimization', () => {
    assert.equal(requestDescriptor('/api/moderation/ban/add', '{}'), null);
    assert.equal(requestDescriptor('/api/moderation/postprofile', JSON.stringify({profiledata: {steamid64: source.steamId, format_date: 'day'}})).kind, 'profile');
    const clean = sanitizeResponse('bans', [{bid: 10, created: 123, reason: 'x', name: 'private', ip: 'private', token: 'secret', RemovedOn: 456}]);
    assert.deepEqual(clean.items, [{id: '10', created: 123, reason: 'x', removed: true}]);
    assert.equal(sanitizeResponse('mutes', {error: 'Forbidden'}), null);
});
test('Analytics: ratios describe volumes, can exceed100, and do not turn missing bases into zero',()=>{
    const coverage=Object.fromEntries(['tickets','reports','bans','mutes'].map(key=>[key,{available:true}]));
    const totals={tickets:10,reports:10,complaints:20,bans:12,mutes:3};
    const r=profileRatios(totals,coverage);
    assert.equal(r.bansPer100Tickets,120);assert.equal(r.punishmentsPer100Complaints,75);
    assert.equal(r.bansShare,80);assert.equal(r.mutesShare,20);
    assert.equal(profileRatios({...totals,tickets:0},coverage).bansPer100Tickets,null);
    assert.equal(profileRatios(totals,{...coverage,bans:{available:true,partial:true}}).bansPer100Tickets,null);
    assert.equal(profileRatios({...totals,mutes:0},coverage).mutesPer100Tickets,0);
});
test('Analytics: avatar comes from profile response; only HTTPS Steam/CYBERSHOKE images or Steam hash are accepted',()=>{
    const url='https://avatars.steamstatic.com/'+'a'.repeat(40)+'_full.jpg';
    assert.equal(safeAvatarUrl('a'.repeat(40)),url);
    assert.equal(safeAvatarUrl(url),url);
    for(const bad of ['javascript:alert(1)','https://steamstatic.com.evil.example/a.jpg','http://avatars.steamstatic.com/a.jpg'])assert.equal(safeAvatarUrl(bad),'');
    const clean=sanitizeResponse('profile',{data:{name:'Mod',avatar:url},history_tickets:[],history_reports:[]});
    assert.equal(clean.avatar,url);
    assert.equal(aggregateProfile({...source,avatar:url},range).avatar,url);
});
