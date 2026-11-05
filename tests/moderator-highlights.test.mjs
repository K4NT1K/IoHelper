import test from 'node:test';
import assert from 'node:assert/strict';
import {ModeratorService} from '../modules/ModeratorService.js';
import {steamIdFromPlayerProfileUrl} from '../modules/shared/playerProfile.js';

const id = '76561198425004455', former = '76561198000000001', specialist = '76561198000000002';
const nested = {Tier: {Advanced: {[id]: 'Moderator'}}};
const snapshot = () => ({formatVersion: 2, source: 'worktime-api', scannedAt: 1, days: [0, 1, 2, 3, 4, 5, 6],
    Tier: {Advanced: {[id]: 'Moderator'}}, members: [{steamId: id, name: 'Moderator', className: 'Advanced'}]});

test('player profiles: current /id/ and historical URLs identify only actual CYBERSHOKE profiles', () => {
    for (const host of ['cybershoke.net', 'cybershoke.ru', 'www.cybershoke.net']) {
        for (const path of [`/${id}`, `/id/${id}`, `/id/${id}/?from=io#profile`]) {
            assert.equal(steamIdFromPlayerProfileUrl(`https://${host}${path}`), id);
        }
    }
    for (const value of [null, '', `https://cybershoke.net.evil/id/${id}`, `https://evil/cybershoke.net/id/${id}`,
        `https://cybershoke.net/?id=${id}`, `https://cybershoke.net/id/${id}/extra`,
        `https://cybershoke.net/api/${id}`, `steam://connect/${id}`, 'https://cybershoke.net/id/123']) {
        assert.equal(steamIdFromPlayerProfileUrl(value), null, String(value));
    }
});

function rowFixture(href = `https://cybershoke.net/id/${id}`) {
    const classes = new Set();
    const row = {dataset: {}, classList: {add: value => classes.add(value), remove: value => classes.delete(value)}, querySelector: () => null};
    const cell = {querySelectorAll: () => []};
    const link = {href, dataset: {}, closest: selector => selector === 'tr' ? row : cell};
    return {row, cell, link, classes, section: {querySelectorAll: () => [link]}};
}

test('moderator highlights: nested config matches /id/ links in a server table', async () => {
    const f = rowFixture();
    const service = new ModeratorService({document: {}, chrome: {storage: {local: {get: async () => ({helperConfig: {moderators: nested}})}}}});
    service._findCurrentServerSections = () => [f.section];
    const badges = [];
    service.insertModeratorBadge = (link, type) => {badges.push([link, type]);};
    await service.highlightSavedModerators();
    assert.equal(f.classes.has('ioh-highlighted-moderator'), true);
    assert.deepEqual(badges, [[f.link, 'admin']]);
});

test('moderator highlights: full valid roster replaces config Tier, retaining verification and specialists', async () => {
    const stored = {helperConfig: {moderators: {Tier: {'Tier 1': {[former]: 'Former'}}, verification: {[id]: 'Verified'}, Jail: {[specialist]: 'Jail'}}},
        helperScheduleModerators: snapshot()};
    const service = new ModeratorService({document: {}, chrome: {storage: {local: {get: async () => stored}}}});
    const current = await service.loadBaselineModerators();
    assert.equal(service.resolveModeratorType(id, current), 'admin');
    assert.equal(service.resolveModeratorType(former, current), null);
    assert.equal(service.resolveModeratorType(specialist, current), 'admin');
    stored.helperScheduleModerators.days.pop();
    const fallback = await service.loadBaselineModerators();
    assert.equal(service.resolveModeratorType(former, fallback), 'admin', 'invalid roster cannot replace config');
});

test('moderator highlights: a late empty roster read cannot clear a newer successful pass', async () => {
    const f = rowFixture();
    let finishFirst;
    let calls = 0;
    const service = new ModeratorService({document: {}, chrome: {storage: {local: {get: () => ++calls === 1
        ? new Promise(resolve => {finishFirst = resolve;}) : Promise.resolve({helperConfig: {moderators: nested}})}}}});
    service._findCurrentServerSections = () => [f.section];
    service.insertModeratorBadge = () => {};
    const first = service.highlightSavedModerators();
    await service.highlightSavedModerators();
    finishFirst({helperConfig: {moderators: {}}});
    await first;
    assert.equal(f.classes.has('ioh-highlighted-moderator'), true);
});

test('moderator highlights: resolve the visible server after storage, and clear removed moderators', async () => {
    const previous = rowFixture(), active = rowFixture();
    let finish;
    let visible = previous.section;
    const service = new ModeratorService({document: {}, chrome: {storage: {local: {get: () => new Promise(resolve => {finish = resolve;})}}}});
    service._findCurrentServerSections = () => [visible];
    service.insertModeratorBadge = () => {};
    const pass = service.highlightSavedModerators();
    visible = active.section;
    finish({helperConfig: {moderators: nested}});
    await pass;
    assert.equal(previous.classes.size, 0);
    assert.equal(active.classes.has('ioh-highlighted-moderator'), true);
    const removal = service.highlightSavedModerators();
    finish({helperConfig: {moderators: {}}});
    await removal;
    assert.equal(active.classes.size, 0);
    assert.equal(active.row.dataset.iohSavedModerator, undefined);
});
