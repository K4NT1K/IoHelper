import {isIohNode} from '../shared/dom.js';

const LABELS = {
    punished: 'Нарушитель был наказан',
    noCheats: 'Читов не найдено',
    insufficient: 'Недостаточно доказательств',
    noViolations: 'Нет нарушений'
};
const CATEGORIES = new Map([
    ['читерство', 'ban'], ['багоюз', 'ban'],
    ['мониторинг', 'mute'], ['спам', 'mute'], ['попрошайничество', 'mute']
]);
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

export function closeReasonEvidenceMinutes(value) {
    if (value === '' || value === null || value === undefined) return 3;
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(120, Math.max(0, number)) : 3;
}

export function parseCloseReasonTimer(value) {
    const match = String(value || '').trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

export function chooseCloseReason(category, elapsedSeconds, minutes = 3, data = {}) {
    const normalized = normalize(category);
    const type = CATEGORIES.get(normalized);
    if (!type) return null;
    if ((type === 'ban' && data.isBanned) || (type === 'mute' && data.isMuted)) return LABELS.punished;
    if (normalized !== 'читерство') return LABELS.noViolations;
    return elapsedSeconds !== null && elapsedSeconds >= closeReasonEvidenceMinutes(minutes) * 60
        ? LABELS.insufficient : LABELS.noCheats;
}

export const CloseReasonMethods = {
    getCloseReasonContext(textarea) {
        if (!textarea || !this.document.contains(textarea)) return null;
        const scope = this.getTicketScopeRoot(textarea);
        let card = textarea.parentElement;
        let title = null;
        while (card && card !== scope?.parentElement && card !== this.document.body) {
            title = Array.from(card.querySelectorAll('h3')).find(header =>
                /^Результат рассмотрения (?:тикета|репорта) #\d+\b/i.test(header.textContent.trim()));
            if (title) break;
            if (card === scope) return null;
            card = card.parentElement;
        }
        if (!title || !card || card === this.document.body) return null;
        const ticketId = title.textContent.match(/#(\d+)/)?.[1];
        const steamId = this.extractSteamIdFromField(this.findInfoFieldScoped('Нарушитель', scope));
        const category = this.getTicketComplaintCategory(scope);
        if (!ticketId || !steamId || !CATEGORIES.has(normalize(category))) return null;
        const buttons = Array.from(card.querySelectorAll('button')).filter(button =>
            Object.values(LABELS).includes(button.textContent.trim()) && !isIohNode(button));
        return {textarea, scope, card, title, ticketId, steamId, category, buttons};
    },

    isCloseReasonContextEditable(context) {
        return Boolean(context && !context.textarea.readOnly && !context.textarea.disabled
            && this.scopeHasInProgressStatus(context.scope, {includeActivePanel: false})
            && context.buttons.some(button => !button.disabled));
    },

    getCloseReasonComplaintState(context) {
        this._closeReasonStateByScope ||= new WeakMap();
        let state = this._closeReasonStateByScope.get(context.scope);
        if (!state || state.ticketId !== context.ticketId || state.steamId !== context.steamId
            || state.category !== normalize(context.category)) {
            state = {ticketId: context.ticketId, steamId: context.steamId, category: normalize(context.category),
                manual: false, punishmentData: null};
            this._closeReasonStateByScope.set(context.scope, state);
        }
        return state;
    },

    syncCloseReasonSelection() {
        if (!this.settings?.features?.autoSelectCloseReason) {
            this.stopCloseReasonSelection();
            return;
        }
        this._closeReasonSessions ||= new Map();
        this._closeReasonPendingCards ||= new Map();
        for (const pending of this._closeReasonPendingCards.values()) {
            const current = this.getCloseReasonContext(pending.textarea);
            if (!current || current.card !== pending.card || current.ticketId !== pending.ticketId
                || current.steamId !== pending.steamId
                || !this.scopeHasInProgressStatus(current.scope, {includeActivePanel: false})
                || this.isCloseReasonContextEditable(current)) {
                pending.observer.disconnect();
                this._closeReasonPendingCards.delete(pending.card);
            }
        }
        // Keep a hidden SPA session and its manual choice, but never write into it.
        for (const session of this._closeReasonSessions.values()) {
            this.refreshCloseReasonSession(session);
        }
        for (const textarea of this.document.querySelectorAll('textarea[placeholder*="Опишите детали закрытия"]')) {
            if (!this.isVisibleTicketTextarea(textarea)) continue;
            const context = this.getCloseReasonContext(textarea);
            if (!this.isCloseReasonContextEditable(context)) {
                // A ticket can become editable on acceptance through attributes alone.
                // This observer carries no selection/manual state until it is our form.
                if (context && this.scopeHasInProgressStatus(context.scope, {includeActivePanel: false})
                    && !this._closeReasonSessions.has(context.scope)
                    && !this._closeReasonPendingCards.has(context.card)) {
                    const pending = {...context};
                    pending.observer = new MutationObserver(mutations => {
                        if (mutations.every(mutation => isIohNode(mutation.target))) return;
                        this.syncCloseReasonSelection();
                    });
                    pending.observer.observe(context.card, {childList: true, subtree: true, characterData: true,
                        attributes: true, attributeFilter: ['disabled', 'readonly']});
                    this._closeReasonPendingCards.set(context.card, pending);
                }
                continue;
            }
            let session = this._closeReasonSessions.get(context.scope);
            if (!session) {
                const complaintState = this.getCloseReasonComplaintState(context);
                session = {...context, complaintState, applying: false, lastApplied: null, lastAppliedButton: null};
                this._closeReasonSessions.set(context.scope, session);
                session.onClick = event => {
                    if (session.applying) return;
                    const button = event.target?.closest?.('button');
                    // All native resolution reasons (including ones outside our four labels)
                    // transfer control to the moderator for the rest of this complaint.
                    if (button && this.isCloseReasonButton(session, button)) session.complaintState.manual = true;
                };
                session.card.addEventListener('click', session.onClick, true);
                session.observer = new MutationObserver(mutations => {
                    if (mutations.every(mutation => isIohNode(mutation.target))) return;
                    this.refreshCloseReasonSession(session);
                });
                session.observer.observe(session.card, {childList: true, subtree: true, characterData: true,
                    attributes: true, attributeFilter: ['disabled', 'readonly']});
            }
            this.refreshCloseReasonSession(session);
        }
    },

    isCloseReasonButton(session, button) {
        if (isIohNode(button) || button.disabled || button.type !== 'button') return false;
        const first = session.buttons[0];
        return Boolean(first && button.parentElement === first.parentElement);
    },

    refreshCloseReasonSession(session) {
        if (this._closeReasonSessions?.get(session.scope) !== session) return;
        if (!this.settings?.features?.autoSelectCloseReason) {
            this.stopCloseReasonSelection();
            return;
        }
        const context = this.getCloseReasonContext(session.textarea);
        if (!context || context.scope !== session.scope || context.card !== session.card
            || context.ticketId !== session.ticketId || context.steamId !== session.steamId
            || normalize(context.category) !== normalize(session.category)
            || !this.scopeHasInProgressStatus(context.scope, {includeActivePanel: false})) {
            this.releaseCloseReasonSession(session);
            return;
        }
        session.buttons = context.buttons;
        // Disabled controls can be a temporary React transition. Keep this scoped
        // observer so an attribute-only return to editable state can resume selection.
        if (!this.isCloseReasonContextEditable(context)) return;
        const interval = Number(this.settings.trackOffenderIntervalWhileReviewing);
        const cacheTtl = Math.max(5000, (Number.isFinite(interval) ? interval : 30) * 1000 + 5000);
        const cached = this.getCachedUserData?.(session.steamId, cacheTtl);
        const state = session.complaintState;
        if (cached && (!state.punishmentData || cached.fetchedAt > state.punishmentData.fetchedAt)) {
            state.punishmentData = {...cached};
        }
        if (state.manual || !this.isVisibleTicketTextarea(session.textarea)) return;
        const clock = context.title.parentElement?.querySelector('use[href="#lc-clock"]');
        const elapsed = parseCloseReasonTimer(clock?.closest('svg')?.parentElement?.textContent);
        const data = state.punishmentData || {};
        const desired = chooseCloseReason(session.category, elapsed,
            this.settings.closeReasonEvidenceMinutes, data);
        if (!desired) return;
        const button = context.buttons.find(candidate => candidate.textContent.trim() === desired && !candidate.disabled);
        if (!button) return;
        if (desired === session.lastApplied && button === session.lastAppliedButton) return;
        // Record before dispatch: React may synchronously rerender or notify observers.
        session.lastApplied = desired;
        session.lastAppliedButton = button;
        session.applying = true;
        try {
            button.click();
        } finally {
            session.applying = false;
        }
    },

    onCloseReasonPunishmentData(steamId, data) {
        if (!this.settings?.features?.autoSelectCloseReason || !steamId || !data) return;
        for (const session of this._closeReasonSessions?.values() || []) {
            if (session.steamId !== steamId) continue;
            if (data.scope !== undefined && data.scope !== session.scope) continue;
            if (data.ticketId !== undefined && String(data.ticketId) !== session.ticketId) continue;
            const state = session.complaintState;
            state.punishmentData = {...data, fetchedAt: data.fetchedAt ?? Date.now()};
            this.refreshCloseReasonSession(session);
        }
    },

    releaseCloseReasonSession(session) {
        session.observer?.disconnect();
        session.card.removeEventListener('click', session.onClick, true);
        if (this._closeReasonSessions?.get(session.scope) === session) this._closeReasonSessions.delete(session.scope);
    },

    stopCloseReasonSelection() {
        for (const session of this._closeReasonSessions?.values() || []) this.releaseCloseReasonSession(session);
        this._closeReasonSessions?.clear();
        for (const pending of this._closeReasonPendingCards?.values() || []) pending.observer.disconnect();
        this._closeReasonPendingCards?.clear();
    }
};
