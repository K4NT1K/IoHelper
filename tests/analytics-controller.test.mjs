import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {validateRange} from '../modules/analytics/model.js';
import {filterDirectory} from '../modules/analytics/directory.js';

const source = await readFile(new URL('../analytics.js', import.meta.url), 'utf8');
// Execute the real controller bodies. Fail explicitly if a refactor moves either boundary.
function controllerScript(begin, end) {
    const start = source.indexOf(begin);
    assert.notEqual(start, -1, `Controller start boundary exists: ${begin}`);
    assert.equal(source.indexOf(begin, start + begin.length), -1, `Controller start boundary is unique: ${begin}`);
    const stop = source.indexOf(end, start + begin.length);
    assert.ok(stop > start + begin.length, `Controller end boundary follows a nonempty body: ${end}`);
    const body = source.slice(start, stop);
    assert.ok(body.length > 100, 'Extracted controller body is nonempty');
    return new vm.Script(body, {filename: 'analytics.js', lineOffset: source.slice(0, start).split('\n').length - 1});
}
const startCohortScript = controllerScript('async function startCohort(resume = false) {', "$('compareAll').addEventListener");
const clearCacheScript = controllerScript("$('clearCache').addEventListener('click', async () => {", "for (const id of ['metric', 'unit'])");
const steamId = '76561198000000001';

function cohortFixture({chosenSource = 'all', snapshotAt = 0, previous = null, preflightStatus = 'failed'} = {}) {
    const calls = [], statuses = [];
    const nodes = new Map([
        ['cohortSource', {value: chosenSource}], ['removed', {checked: true}], ['cohort', {scrollIntoView() {}}]
    ]);
    const context = vm.createContext({
        busy: false, cohort: previous, generation: 0, scheduleAt: 0, rosterRequest: null,
        directory: [{steamId, name: 'Config member', sources: ['config']}],
        $: id => {assert.ok(nodes.has(id), `Expected controller node: ${id}`); return nodes.get(id);},
        range: () => ({start: '2019-01-01', end: '2019-01-02'}), validateRange, filterDirectory,
        crypto: {randomUUID}, matchMedia: () => ({matches: true}),
        setBusy: value => {context.busy = value;}, status: (text, type) => statuses.push({text, type}),
        message: async request => {
            assert.equal(request.action, 'requestScheduleScan'); calls.push(request.action);
            return {success: true, status: preflightStatus, state: {error: 'Worktime API unavailable'}};
        },
        loadDirectory: async () => {calls.push('loadDirectory'); context.scheduleAt = snapshotAt;},
        cohortWrite: async () => {calls.push('cohortWrite');},
        runCohort: async state => {calls.push('runCohort'); state.status = 'complete';},
        paintCohort() {}, releaseJob: async () => {calls.push('releaseJob');}
    });
    startCohortScript.runInContext(context);
    assert.equal(typeof context.startCohort, 'function', 'Actual startCohort function was installed');
    return {context, calls, statuses};
}

test('Controller: config + API without a valid schedule snapshot never starts or replaces a cohort', async () => {
    for (const preflightStatus of ['failed', 'pending']) {
        const previous = {runId: 'existing', status: 'complete', profiles: [], failed: []};
        const fixture = cohortFixture({previous, preflightStatus});
        await fixture.context.startCohort();
        assert.equal(fixture.context.cohort, previous, 'Previously displayed results remain unchanged');
        assert.equal(previous.status, 'complete');
        assert.equal(fixture.calls.includes('cohortWrite'), false, 'No checkpoint replacement before roster validation');
        assert.equal(fixture.calls.includes('runCohort'), false, 'No misleading config-only collection labeled as all sources');
        assert.deepEqual(fixture.calls, ['requestScheduleScan', 'loadDirectory', 'releaseJob']);
        assert.equal(fixture.statuses.at(-1).type, 'error');
        assert.match(fixture.statuses.at(-1).text, /Worktime API unavailable/);
        assert.equal(fixture.context.busy, false);
        assert.equal(fixture.context.rosterRequest, null);
    }
});

test('Controller: config-only can start without a schedule; all sources can start after valid snapshot preflight', async () => {
    const config = cohortFixture({chosenSource: 'config'});
    await config.context.startCohort();
    assert.equal(config.calls.includes('requestScheduleScan'), false);
    assert.equal(config.calls.includes('runCohort'), true);
    assert.equal(config.context.cohort.source, 'config');
    const all = cohortFixture({snapshotAt: 1793100000000, preflightStatus: 'complete'});
    await all.context.startCohort();
    assert.equal(all.context.cohort.source, 'all');
    assert.equal(all.context.cohort.rosterAt, 1793100000000);
    assert.equal(all.context.cohort.total, 1);
    assert.equal(all.calls.includes('runCohort'), true);
});

function clearFixture({refuse = false} = {}) {
    const calls = [], statuses = [], previous = {runId: 'saved', status: 'complete'}, profiles = [{steamId}];
    let handler, paints = 0;
    const nodes = new Map([
        ['clearCache', {addEventListener(type, callback) {assert.equal(type, 'click'); assert.equal(handler, undefined); handler = callback;}}],
        ['results', {hidden: false}], ['empty', {hidden: true}]
    ]);
    const context = vm.createContext({
        busy: false, cohort: previous, profiles,
        $: id => {assert.ok(nodes.has(id), `Expected controller node: ${id}`); return nodes.get(id);},
        message: async request => {
            assert.equal(request.action, 'analyticsClear'); calls.push(request.action);
            if (refuse) throw new Error('Сначала завершите или отмените сбор');
            return {success: true};
        },
        cacheClear: async () => {calls.push('cacheClear');},
        paintCohort: () => {paints++;}, status: (text, type) => statuses.push({text, type})
    });
    clearCacheScript.runInContext(context);
    assert.equal(typeof handler, 'function', 'Actual clear-cache click handler was registered');
    return {context, calls, statuses, previous, profiles, nodes, handler, paints: () => paints};
}

test('Controller: an active-job RPC refusal preserves IndexedDB and the second dashboard results', async () => {
    const fixture = clearFixture({refuse: true});
    await fixture.handler();
    assert.deepEqual(fixture.calls, ['analyticsClear'], 'A refused clear never reaches IndexedDB');
    assert.equal(fixture.context.cohort, fixture.previous);
    assert.equal(fixture.context.profiles, fixture.profiles);
    assert.equal(fixture.nodes.get('results').hidden, false);
    assert.equal(fixture.nodes.get('empty').hidden, true);
    assert.equal(fixture.paints(), 0);
    assert.equal(fixture.statuses.at(-1).type, 'error');
    assert.match(fixture.statuses.at(-1).text, /Сначала завершите/);
});

test('Controller: successful clear checks the background job before IndexedDB and resets the visible results', async () => {
    const fixture = clearFixture();
    await fixture.handler();
    assert.deepEqual(fixture.calls, ['analyticsClear', 'cacheClear']);
    assert.equal(fixture.context.cohort, null);
    assert.equal(fixture.context.profiles.length, 0);
    assert.equal(fixture.nodes.get('results').hidden, true);
    assert.equal(fixture.nodes.get('empty').hidden, false);
    assert.equal(fixture.paints(), 1);
    assert.equal(fixture.statuses.at(-1).text, 'Локальный кэш очищен.');
});
