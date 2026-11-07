import {isIohNode} from '../shared/dom.js';

const LABELS = {
    punished: 'Нарушитель был наказан',
    noCheats: 'Читов не найдено',
    insufficient: 'Недостаточно доказательств',
    left: 'Игрок вышел с сервера',
    noViolations: 'Нет нарушений'
};
const CATEGORIES = new Map([
    ['читерство', 'ban'], ['багоюз', 'ban'],
    ['мониторинг', 'mute'], ['спам', 'mute'], ['попрошайничество', 'mute'], ['нарушение правил', 'confirmed-any']
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
    if (type === 'confirmed-any') return data.isBanned === true || data.isMuted === true ? LABELS.punished : null;
    if ((type === 'ban' && data.isBanned) || (type === 'mute' && data.isMuted)) return LABELS.punished;
    if (Object.hasOwn(data, 'serverIp') && data.serverIp === null) return LABELS.left;
    if (normalized !== 'читерство') return LABELS.noViolations;
    return elapsedSeconds !== null && elapsedSeconds >= closeReasonEvidenceMinutes(minutes) * 60
        ? LABELS.insufficient : LABELS.noCheats;
}

export function mergeCloseReasonData(previous, incoming) {
    const next = {...previous, fetchedAt: incoming.fetchedAt ?? Date.now()};
    for (const key of ['isBanned', 'isMuted']) {
        if (typeof incoming[key] === 'boolean') next[key] = incoming[key];
    }
    if (Object.hasOwn(incoming, 'serverIp') && (incoming.serverIp === null
        || typeof incoming.serverIp === 'string' && incoming.serverIp.trim())) {
        next.serverIp = incoming.serverIp === null ? null : incoming.serverIp.trim().toLowerCase();
    }
    return next;
}

function containsNode(root, node) {
    if (root?.contains) return root.contains(node);
    for (let current = node; current; current = current.parentElement) if (current === root) return true;
    return false;
}

export const CloseReasonMethods = {
    getCloseReasonContext(textarea) {
        if (!textarea || !this.document.contains(textarea)) return null;
        this._closeReasonScopes ||= new WeakMap();
        const savedScope = this._closeReasonScopes.get(textarea);
        const scope = savedScope && this.document.contains(savedScope) && containsNode(savedScope, textarea)
            ? savedScope : this.getTicketScopeRoot(textarea);
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
        const ticket = this.nativeData && this.getNativeTicket(scope);
        const ticketId = this.nativeData ? ticket && String(ticket.id) : title.textContent.match(/#(\d+)/)?.[1];
        const steamId = this.nativeData ? ticket?.suspectId : this.extractSteamIdFromField(this.findInfoFieldScoped('Нарушитель', scope));
        const category = this.getTicketComplaintCategory(scope);
        if (!ticketId || !steamId || !CATEGORIES.has(normalize(category))) return null;
        this._closeReasonScopes.set(textarea, scope);
        const buttons = Array.from(card.querySelectorAll('button')).filter(button =>
            Object.values(LABELS).includes(button.textContent.trim()) && !isIohNode(button));
        return {textarea, scope, card, title, ticketId, steamId, category, buttons};
    },

    isCloseReasonContextEditable(context) {
        return Boolean(context && !context.textarea.readOnly && !context.textarea.disabled
            && this.isCloseReasonContextInProgress(context)
            && context.buttons.some(button => !button.disabled));
    },

    isCloseReasonContextInProgress(context) {
        if (this.nativeData) return Boolean(context && this.scopeHasInProgressStatus(context.scope, {includeActivePanel: false}));
        const header = context?.title?.parentElement;
        if (header?.querySelectorAll) {
            return Array.from(header.querySelectorAll('span')).some(span => span.textContent.trim() === 'В работе');
        }
        return Boolean(context && this.scopeHasInProgressStatus(context.scope, {includeActivePanel: false}));
    },

    isCloseReasonTextareaVisible(textarea, scope = null) {
        if (!textarea || !this.document.contains(textarea)) return false;
        const modal = this.document.querySelector?.('[role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"]');
        if (!modal) return this.isVisibleTicketTextarea(textarea);
        const view = this.document.defaultView || (typeof window !== 'undefined' ? window : null);
        for (let node = textarea; node; node = node.parentElement) {
            const style = view?.getComputedStyle?.(node);
            if (node.hidden || style?.display === 'none' || style?.visibility === 'hidden'
                || style?.visibility === 'collapse') return false;
            const ariaHidden = node.getAttribute?.('aria-hidden') === 'true';
            const inert = node.inert || node.hasAttribute?.('inert');
            if (ariaHidden || inert) {
                // Radix masks rendered background ancestors for accessibility. An
                // inactive SPA panel must still never become an automation target.
                if (ariaHidden && (node.getAttribute?.('role') === 'tabpanel'
                    || node.getAttribute?.('data-state') === 'inactive')) return false;
                if (node === scope && node.getAttribute?.('aria-selected') === 'false') return false;
                const blanketMask = node.hasAttribute?.('data-aria-hidden')
                    || node.getAttribute?.('data-aria-hidden') != null
                    || scope && node !== scope && containsNode(node, scope);
                if (!blanketMask) return false;
            }
        }
        return typeof textarea.getClientRects === 'function' ? textarea.getClientRects().length > 0
            : this.isVisibleTicketTextarea(textarea);
    },

    getCloseReasonComplaintState(context) {
        this._closeReasonStateByScope ||= new WeakMap();
        let state = this._closeReasonStateByScope.get(context.scope);
        if (!state || state.ticketId !== context.ticketId || state.steamId !== context.steamId
            || state.category !== normalize(context.category)) {
            state = {ticketId: context.ticketId, steamId: context.steamId, category: normalize(context.category),
                manual: false, punishmentData: null, intents: new Map()};
            this._closeReasonStateByScope.set(context.scope, state);
        }
        return state;
    },

    transferCloseReasonComplaintScope(oldScope, newContext) {
        // The bridge validates the original route and a unique remounted complaint.
        // Locally require the old DOM to be gone and all complaint identity fields
        // to match; two still-mounted SPA complaints never share manual/intent state.
        if (!oldScope || !newContext || oldScope === newContext.scope
            || this.document.contains(oldScope) || !this.document.contains(newContext.scope)
            || !containsNode(newContext.scope, newContext.textarea)
            || !this.isCloseReasonContextEditable(newContext)) return false;
        const state = this._closeReasonStateByScope?.get(oldScope);
        if (!state || state.ticketId !== newContext.ticketId || state.steamId !== newContext.steamId
            || state.category !== normalize(newContext.category)) return false;
        const mountedState = this._closeReasonStateByScope.get(newContext.scope);
        if (mountedState && mountedState !== state && mountedState.ticketId === state.ticketId
            && mountedState.steamId === state.steamId && mountedState.category === state.category) {
            state.manual ||= mountedState.manual;
            for (const [token, type] of mountedState.intents) {
                state.intents.set(token, type);
                this._closeReasonIntentStates?.set(token, state);
            }
            if (mountedState.punishmentData && (!state.punishmentData
                || mountedState.punishmentData.fetchedAt > state.punishmentData.fetchedAt)) {
                state.punishmentData = mergeCloseReasonData(state.punishmentData, mountedState.punishmentData);
            }
        }
        const oldSession = this._closeReasonSessions?.get(oldScope);
        if (oldSession) this.releaseCloseReasonSession(oldSession);
        this._closeReasonStateByScope.delete(oldScope);
        this._closeReasonStateByScope.set(newContext.scope, state);
        this._closeReasonScopes ||= new WeakMap();
        this._closeReasonScopes.set(newContext.textarea, newContext.scope);
        const newSession = this._closeReasonSessions?.get(newContext.scope);
        if (newSession) {
            newSession.complaintState = state;
            this.refreshCloseReasonSession(newSession);
        }
        return true;
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
                || !this.isCloseReasonContextInProgress(current)
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
            const context = this.getCloseReasonContext(textarea);
            if (!context || !this.isCloseReasonTextareaVisible(textarea, context.scope)) continue;
            if (!this.isCloseReasonContextEditable(context)) {
                // A ticket can become editable on acceptance through attributes alone.
                // This observer carries no selection/manual state until it is our form.
                if (context && this.isCloseReasonContextInProgress(context)
                    && !this._closeReasonSessions.has(context.scope)
                    && !this._closeReasonPendingCards.has(context.card)) {
                    const pending = {...context};
                    pending.observer = new MutationObserver(mutations => {
                        if (mutations.every(mutation => isIohNode(mutation.target))) return;
                        this.syncCloseReasonSelection();
                    });
                    pending.observer.observe(context.card, {childList: true, subtree: true, characterData: !this.nativeData,
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
                session.observer.observe(session.card, {childList: true, subtree: true, characterData: !this.nativeData,
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
            || !this.isCloseReasonContextInProgress(context)) {
            if (!context || context.ticketId !== session.ticketId || context.steamId !== session.steamId
                || !this.isCloseReasonContextInProgress(context)) this.clearCloseReasonIntents(session.complaintState);
            this.releaseCloseReasonSession(session);
            return;
        }
        session.buttons = context.buttons;
        // Disabled controls can be a temporary React transition. Keep this scoped
        // observer so an attribute-only return to editable state can resume selection.
        if (!this.isCloseReasonContextEditable(context)) return;
        const cached = this.getCachedUserData?.(session.steamId);
        const state = session.complaintState;
        if (cached && (!state.punishmentData || cached.fetchedAt > state.punishmentData.fetchedAt)) {
            state.punishmentData = mergeCloseReasonData(state.punishmentData, cached);
        }
        if (state.manual || !this.isCloseReasonTextareaVisible(session.textarea, session.scope)) return;
        const ticket = this.nativeData && this.getNativeTicket(session.scope);
        const elapsed = this.nativeData ? ticket?.startedAt ? Math.max(0, (Date.now() - ticket.startedAt) / 1000) : null
            : parseCloseReasonTimer(context.title.parentElement?.querySelector('use[href="#lc-clock"]')?.closest('svg')?.parentElement?.textContent);
        if (this.nativeData) {
            clearTimeout(session.thresholdTimer);
            const remaining = ticket?.startedAt + closeReasonEvidenceMinutes(this.settings.closeReasonEvidenceMinutes) * 60000 - Date.now();
            if (ticket?.startedAt && remaining > 0) session.thresholdTimer = setTimeout(() => this.refreshCloseReasonSession(session), remaining + 10);
        }
        const data = state.punishmentData || {};
        const matchingType = CATEGORIES.get(normalize(session.category));
        const desired = matchingType !== 'confirmed-any' && Array.from(state.intents.values()).includes(matchingType) ? LABELS.punished
            : chooseCloseReason(session.category, elapsed, this.settings.closeReasonEvidenceMinutes, data);
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
            state.punishmentData = mergeCloseReasonData(state.punishmentData, data);
            for (const [token, type] of state.intents) {
                if (type === 'ban' ? data.isBanned === true : data.isMuted === true) {
                    state.intents.delete(token);
                    this._closeReasonIntentStates?.delete(token);
                }
            }
            this.refreshCloseReasonSession(session);
        }
    },

    onCloseReasonPunishmentIntent({type, scope, steamId, ticketId, attemptToken} = {}) {
        if (!this.settings?.features?.autoSelectCloseReason || !attemptToken || typeof attemptToken !== 'object'
            || !scope || !steamId || !ticketId) return false;
        this.syncCloseReasonSelection();
        const session = this._closeReasonSessions?.get(scope);
        if (!session || session.steamId !== steamId || session.ticketId !== String(ticketId)
            || !['ban', 'mute'].includes(type)) return false;
        const matchingType = CATEGORIES.get(normalize(session.category));
        if (matchingType !== type && matchingType !== 'confirmed-any') return false;
        const context = this.getCloseReasonContext(session.textarea);
        if (!context || context.scope !== scope || context.steamId !== steamId || context.ticketId !== String(ticketId)
            || !this.isCloseReasonContextEditable(context)) return false;
        session.complaintState.intents.set(attemptToken, type);
        this.rememberNativePunishmentIntent?.({type, scope, steamId, ticketId, attemptToken});
        this._closeReasonIntentStates ||= new WeakMap();
        this._closeReasonIntentStates.set(attemptToken, session.complaintState);
        this.refreshCloseReasonSession(session);
        return true;
    },

    cancelCloseReasonPunishmentIntent(attemptToken) {
        this._nativePunishmentAttempts?.delete(attemptToken);
        const state = this._closeReasonIntentStates?.get(attemptToken);
        if (!state) return;
        state.intents.delete(attemptToken);
        this._closeReasonIntentStates.delete(attemptToken);
        for (const session of this._closeReasonSessions?.values() || []) {
            if (session.complaintState === state) this.refreshCloseReasonSession(session);
        }
    },

    clearCloseReasonIntents(state) {
        for (const token of state.intents.keys()) this._closeReasonIntentStates?.delete(token);
        state.intents.clear();
    },

    releaseCloseReasonSession(session) {
        clearTimeout(session.thresholdTimer);
        session.observer?.disconnect();
        session.card.removeEventListener('click', session.onClick, true);
        if (this._closeReasonSessions?.get(session.scope) === session) this._closeReasonSessions.delete(session.scope);
    },

    stopCloseReasonSelection() {
        for (const session of this._closeReasonSessions?.values() || []) {
            this.clearCloseReasonIntents(session.complaintState);
            this.releaseCloseReasonSession(session);
        }
        this._closeReasonIntentStates = new WeakMap();
        this._closeReasonSessions?.clear();
        for (const pending of this._closeReasonPendingCards?.values() || []) pending.observer.disconnect();
        this._closeReasonPendingCards?.clear();
    }
};
