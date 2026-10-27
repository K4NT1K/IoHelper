import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeSettings, editedOverrides} from '../modules/shared/settings.js';
import {ConfigService} from '../modules/ConfigService.js';
import {App} from '../modules/App.js';

const fixture = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const chromeMock = data => ({runtime: {getURL: path => 'bundled:' + path, getManifest: () => manifest}, storage: {local: {
    get: async () => structuredClone(data), set: async values => Object.assign(data, structuredClone(values))
}}});
test('new popup edits store only changed values and preserve legacy explicit values',()=>{
    const base=mergeSettings({}),previous=mergeSettings(base,{features:{translateText:false}}),next=mergeSettings(previous,{headshotPercentage:90});
    assert.deepEqual(editedOverrides(base,previous,next,{features:{translateText:false}}),{features:{translateText:false},headshotPercentage:90});
    assert.deepEqual(editedOverrides(base,next,base,{}),{});
});
test('config minimum extension version compares numeric components',()=>{
    assert.equal(ConfigService.supports({minimumExtensionVersion:'2.10.0'},'2.9.9'),false);
    assert.equal(ConfigService.supports({minimumExtensionVersion:'2.9.0'},'2.10.0'),true);
});

test('old partial overrides retain new defaults and intentional false/zero', () => {
    const s = mergeSettings({newAccountHours: 7, features: {translateText: true}}, {newAccountHours: 0, features: {translateText: false}});
    assert.equal(s.newAccountHours, 0);
    assert.equal(s.features.translateText, false);
    assert.equal(s.features.highlightHighHs, true);
});

test('reset recomputes App from current configuration instead of previous overrides', () => {
    const app = {baseSettings: {newAccountHours: 7, features: {translateText: true}},
        settings: mergeSettings({}, {newAccountHours: 0, features: {translateText: false}}),
        messageService: {reapplyNewAccountHighlights() {}}, ticketService: {},
        cleanupChangedSettings() {}, runDOMUpdates() {}, initPunishmentFormObserver() {},
        domCoordinator: {init() {}}, handleTrackOffenderLoop() {}};
    App.prototype.updateSettings.call(app, {});
    assert.equal(app.settings.newAccountHours, 7);
    assert.equal(app.settings.features.translateText, true);
});

test('configuration schema accepts bundled config and rejects invalid rule/default types', () => {
    assert.equal(ConfigService.isValid(fixture), true);
    for (const config of [{}, {...fixture, settings: []}, {...fixture, muteRules: [{name: 'x', keywords: 'wrong'}]},
        {...fixture, settings: {features: {translateText: 'true'}}}, {...fixture, schemaVersion: 999}]) {
        assert.equal(ConfigService.isValid(config), false);
    }
});

test('invalid remote JSON cannot replace last known good cache', async t => {
    const data = {helperConfig: fixture, helperConfigFetchedAt: 1};
    t.mock.method(globalThis, 'fetch', async () => ({ok: true, json: async () => ({wrong: true})}));
    const result = await ConfigService.load(chromeMock(data), {force: true});
    assert.deepEqual(result.muteRules, fixture.muteRules);
    assert.deepEqual(data.helperConfig, fixture);
    assert.match(data.helperConfigMeta.error, /структура/);
});

test('a hanging network request times out and preserves good cache', async t => {
    const timeout = ConfigService.TIMEOUT_MS;
    ConfigService.TIMEOUT_MS = 5;
    t.after(() => {ConfigService.TIMEOUT_MS = timeout;});
    t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
    const data = {helperConfig: fixture};
    const result = await ConfigService.load(chromeMock(data), {force: true});
    assert.deepEqual(result.muteRules, fixture.muteRules);
    assert.match(data.helperConfigMeta.error, /Таймаут/);
});

test('concurrent refreshes share one request and hourly fresh cache avoids network', async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {calls++; return {ok: true, json: async () => structuredClone(fixture)};});
    const data = {};
    const api = chromeMock(data);
    await Promise.all([ConfigService.load(api), ConfigService.load(api)]);
    assert.equal(calls, 1);
    await ConfigService.load(api);
    assert.equal(calls, 1);
    assert.equal(ConfigService.FETCH_TTL_MS, 3600000);
    assert.equal(data.helperConfigMeta.source, 'github');
});
