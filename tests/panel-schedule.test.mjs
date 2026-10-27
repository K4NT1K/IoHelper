import test from 'node:test';
import assert from 'node:assert/strict';
import {PunishmentPanelMethods as panel} from '../modules/ticket/PunishmentPanel.js';
import {ModeratorService} from '../modules/ModeratorService.js';

test('standalone management activation succeeds without any SPA tab', async () => {
    let active = false;
    const context = {getManagementSectionTitleForType: () => 'Управление банами',
        isManagementPanelActiveForType: () => active, findSpaTabButton: () => null,
        openManagementTabViaAside: async () => {active = true; return true;}};
    assert.equal(await panel.activateManagementPanel.call(context, 'ban'), true);
});

test('moderator service delegates to daily API without reading or clicking schedule DOM', async () => {
    const calls = [];
    const document = new Proxy({}, {get() {throw new Error('Do not inspect worktime DOM');}});
    const service = new ModeratorService({document, chrome: {runtime: {sendMessage: async request => {
        calls.push(request.action); return {success: true, status: 'complete', nextAt: Date.now() + 86400000};
    }}}});
    const result = await service.runWeeklyScheduleScan();
    assert.equal(result.status, 'complete');
    assert.equal(service.hasCompletedWeeklyScan, true);
    assert.deepEqual(calls, ['requestScheduleScan']);
    await service.scanSchedulePage(); assert.deepEqual(calls, ['requestScheduleScan']);
});

test('moderator service preserves disabled scan preference and understands nested roles', async () => {
    let messages = 0;
    const service = new ModeratorService({document: {}, chrome: {runtime: {sendMessage: async () => {messages++;}}}, isEnabled: () => false});
    await service.scanSchedulePage(); assert.equal(messages, 0);
    const id = '76561199163023778';
    assert.equal(service.resolveModeratorType(id, {Tier: {Tier1: {[id]: 'Moderator'}}}), 'admin');
    assert.equal(service.resolveModeratorType(id, {verification: {[id]: 'Verified'}, Tier: {Tier1: {[id]: 'Moderator'}}}), 'verification');
});
