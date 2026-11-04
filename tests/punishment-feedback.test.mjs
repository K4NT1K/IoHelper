import test from 'node:test';
import assert from 'node:assert/strict';
import {PunishmentFeedbackMethods} from '../modules/ticket/PunishmentFeedback.js';
import {ActivePunishmentMethods} from '../modules/ticket/ActivePunishment.js';

function fixture(t) {
    const observers = [];
    class Observer {
        constructor(callback) {this.callback = callback; observers.push(this);}
        observe() {}
        disconnect() {this.disconnected = true;}
    }
    const textarea = {parentNode: {}, readOnly: false, disabled: false};
    const scope = {querySelector: () => textarea};
    const context = {scope, textarea, ticketId: '123', steamId: '76561198000000001', category: 'Нарушение правил'};
    const state = {visible: true, active: true, connected: true, rows: {ban: null, mute: null}, badge: null, renders: [], analyses: 0};
    const service = {...ActivePunishmentMethods, ...PunishmentFeedbackMethods,
        settings: {features: {processTicketRules: true, autoSelectCloseReason: false}},
        document: {body: {}, defaultView: {MutationObserver: Observer}, getElementById: () => state.badge},
        getTicketPunishmentFeedbackContext: () => state.connected ? context : null,
        isCloseReasonContextInProgress: () => state.active,
        isCloseReasonTextareaVisible: () => state.visible,
        isVisibleTicketTextarea: () => state.visible,
        getHistoryBlocks: () => ({ban: {type: 'ban'}, mute: {type: 'mute'}}),
        findActivePunishmentRow: block => state.rows[block.type],
        getAnalysisIcons: () => ({}), clearSuggestedMuteReason() {},
        getChatCacheKey: () => 'fixture', chatSignatureByKey: new Map(), activePunishmentBadgeByKey: new Map(),
        processTicketRules() {state.analyses++; state.badge = {html: 'ЧАТ ПУСТ', parentNode: textarea.parentNode};},
        badgeService: {updateInfoBadge(_id, _variant, html) {
            state.renders.push(html); state.badge = {html, parentNode: textarea.parentNode};
        }}
    };
    t.after(() => service.stopTicketPunishmentFeedback());
    const issue = type => {const intent = {type, ...context, attemptToken: {}}; service.onTicketPunishmentFeedbackIntent(intent); return intent;};
    return {service, state, observers, context, issue};
}

for (const [type, label] of [['ban', 'ЗАБАНЕН'], ['mute', 'АКТИВНЫЙ МУТ']]) {
    test(type + ': immediate feedback does not require auto close reason and has no hover without history', t => {
        const f = fixture(t); f.issue(type);
        assert.match(f.state.badge.html, new RegExp(label));
        assert.doesNotMatch(f.state.badge.html, /tooltip|tabindex|<table/);
        assert.equal(f.service.renderTicketPunishmentFeedback(f.context.textarea), true);
        assert.equal(f.state.renders.length, 1, 'Repeated chat analysis must retain the same local status');
        const row = {outerHTML: '<tr><td>Actual ' + type + ' record</td></tr>'};
        f.state.rows[type] = row;
        f.observers[0].callback([{target: {}}]);
        assert.match(f.state.badge.html, /ioh-punishment-preview-tooltip/);
        assert.ok(f.state.badge.html.includes(row.outerHTML), 'Tooltip must contain the actual received row');
    });
}

test('cancel returns to normal chat analysis when the history has not confirmed punishment', t => {
    const f = fixture(t), intent = f.issue('mute');
    f.service.cancelTicketPunishmentFeedbackIntent(intent.attemptToken);
    assert.equal(f.state.analyses, 1);
    assert.equal(f.state.badge.html, 'ЧАТ ПУСТ');
    assert.equal(f.observers[0].disconnected, true);
});

test('a real history record survives later cancellation of the preliminary token', t => {
    const f = fixture(t), intent = f.issue('ban');
    f.state.rows.ban = {outerHTML: '<tr><td>Actual ban</td></tr>'};
    f.service.renderTicketPunishmentFeedback(f.context.textarea);
    f.service.cancelTicketPunishmentFeedbackIntent(intent.attemptToken);
    assert.match(f.state.badge.html, /Actual ban/);
    assert.equal(f.state.analyses, 0);
});

test('ban has priority over simultaneous mute feedback', t => {
    const f = fixture(t); f.issue('ban'); f.issue('mute');
    assert.match(f.state.badge.html, /ЗАБАНЕН/);
    assert.doesNotMatch(f.state.badge.html, /АКТИВНЫЙ МУТ/);
});

for (const mismatch of ['ticketId', 'steamId']) {
    test('a stale ' + mismatch + ' cannot display punishment for a new complaint', t => {
        const f = fixture(t);
        const intent = {type: 'ban', ...f.context, [mismatch]: 'other', attemptToken: {}};
        assert.equal(f.service.onTicketPunishmentFeedbackIntent(intent), false);
        assert.equal(f.state.badge, null);
    });
}

test('hidden SPA feedback is retained without taking over the visible badge', t => {
    const f = fixture(t); f.state.visible = false; f.issue('ban');
    assert.equal(f.state.badge, null);
    f.state.visible = true; f.service.syncTicketPunishmentFeedback();
    assert.match(f.state.badge.html, /ЗАБАНЕН/);
});

test('analysis feature controls feedback independently of auto close reason', t => {
    const f = fixture(t); f.service.settings.features.processTicketRules = false; f.issue('ban');
    assert.equal(f.state.badge, null);
    assert.equal(f.observers.length, 0);
});

test('turning analysis off disconnects scoped observers', t => {
    const f = fixture(t); f.issue('mute'); f.service.settings.features.processTicketRules = false;
    f.service.syncTicketPunishmentFeedback();
    assert.equal(f.observers[0].disconnected, true);
    assert.equal(f.service._punishmentFeedbackSessions.size, 0);
});
