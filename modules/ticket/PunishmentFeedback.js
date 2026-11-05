import {isIohNode} from '../shared/dom.js';

export const PunishmentFeedbackMethods = {
    getTicketPunishmentFeedbackContext(textarea, preferredScope = null) {
        if (!textarea || !this.document.contains(textarea)) return null;
        const saved = Array.from(this._punishmentFeedbackSessions?.values() || [])
            .find(session => session.textarea === textarea);
        const scope = preferredScope || saved?.scope || this.getTicketScopeRoot(textarea);
        if (!scope || scope === this.document.body || !scope.contains(textarea)) return null;
        let card = textarea.parentElement;
        while (card && card !== scope.parentElement) {
            const title = Array.from(card.querySelectorAll('h3')).find(header =>
                /^Результат рассмотрения (?:тикета|репорта) #\d+\b/i.test(header.textContent.trim()));
            if (title) {
                const ticket = this.nativeData && this.getNativeTicket(scope);
                const ticketId = this.nativeData ? ticket && String(ticket.id) : title.textContent.match(/#(\d+)/)?.[1];
                const steamId = this.getOffenderSteamIdForScope(scope);
                return ticketId && steamId ? {scope, textarea, title, card, ticketId, steamId,
                    category: this.getTicketComplaintCategory(scope),
                    buttons: Array.from(card.querySelectorAll('button')).filter(button => !isIohNode(button))} : null;
            }
            if (card === scope) break;
            card = card.parentElement;
        }
        return null;
    },

    isTicketPunishmentFeedbackContextEditable(context) {
        return Boolean(context && !context.textarea.readOnly && !context.textarea.disabled
            && this.isCloseReasonContextInProgress(context));
    },

    onTicketPunishmentFeedbackIntent(intent) {
        if (this.settings?.features?.processTicketRules !== true || !intent?.attemptToken
            || !['ban', 'mute'].includes(intent.type)) return false;
        const textarea = intent.scope?.querySelector('textarea[placeholder*="Опишите детали закрытия"]');
        const context = this.getTicketPunishmentFeedbackContext(textarea, intent.scope);
        if (!this.isTicketPunishmentFeedbackContextEditable(context)
            || context.ticketId !== String(intent.ticketId) || context.steamId !== intent.steamId) return false;
        this.syncTicketPunishmentFeedback();
        this._punishmentFeedbackSessions ||= new Map();
        let session = this._punishmentFeedbackSessions.get(context.scope);
        if (!session) {
            session = {...context, intents: new Map(), lastHtml: null, histories: new Set()};
            const previous = this.document.getElementById('helper-suggest-badge');
            if (previous?.parentNode === textarea.parentNode) {
                session.previousBadge = {html: previous.innerHTML,
                    variant: previous.className.match(/ioh-info-badge--([\w-]+)/)?.[1] || 'muted'};
            }
            this._punishmentFeedbackSessions.set(context.scope, session);
            const Observer = this.document.defaultView.MutationObserver;
            session.observer = new Observer(mutations => {
                if (mutations.every(mutation => isIohNode(mutation.target))) return;
                this.refreshTicketPunishmentFeedback(session);
            });
            // Find late-mounted history cards without observing all page text.
            session.observer.observe(session.scope, {childList: true, subtree: true});
        }
        session.intents.set(intent.attemptToken, intent.type);
        this.rememberNativePunishmentIntent?.(intent);
        this._punishmentFeedbackTokens ||= new WeakMap();
        this._punishmentFeedbackTokens.set(intent.attemptToken, session);
        this.refreshTicketPunishmentFeedback(session);
        return true;
    },

    cancelTicketPunishmentFeedbackIntent(token) {
        this._nativePunishmentAttempts?.delete(token);
        const session = this._punishmentFeedbackTokens?.get(token);
        if (!session) return;
        session.intents.delete(token);
        this._punishmentFeedbackTokens.delete(token);
        this.refreshTicketPunishmentFeedback(session);
    },

    renderTicketPunishmentFeedback(textarea) {
        const session = Array.from(this._punishmentFeedbackSessions?.values() || [])
            .find(candidate => candidate.textarea === textarea);
        return session ? this.refreshTicketPunishmentFeedback(session, {restoreAnalysis: false}) : false;
    },

    refreshTicketPunishmentFeedback(session, {restoreAnalysis = true} = {}) {
        if (this._punishmentFeedbackSessions?.get(session.scope) !== session) return false;
        const context = this.getTicketPunishmentFeedbackContext(session.textarea, session.scope);
        if (this.settings?.features?.processTicketRules !== true || !context
            || context.ticketId !== session.ticketId || context.steamId !== session.steamId
            || !this.isCloseReasonContextInProgress(context)) {
            this.releaseTicketPunishmentFeedback(session);
            return false;
        }
        const blocks = this.getHistoryBlocks(session.scope, {force: true});
        if (Array.from(session.histories).some(history => history.isConnected === false)) {
            session.observer.disconnect();
            session.histories.clear();
            session.observer.observe(session.scope, {childList: true, subtree: true});
        }
        for (const history of [blocks.ban, blocks.mute]) {
            if (history?.nativeHistory) continue;
            if (!history || history === session.scope || history === this.document.body
                || history === this.document.documentElement || session.histories.has(history)) continue;
            session.histories.add(history);
            session.observer.observe(history, {childList: true, subtree: true, characterData: true,
                attributes: true, attributeFilter: ['class', 'style']});
        }
        const ban = this.findActivePunishmentRow(blocks.ban);
        const mute = this.findActivePunishmentRow(blocks.mute);
        for (const [token, type] of session.intents) {
            if (type === 'ban' ? ban : mute) {
                session.intents.delete(token);
                this._punishmentFeedbackTokens?.delete(token);
            }
        }
        const types = Array.from(session.intents.values());
        if (session.nativeConfirmed) {
            const player = this.nativePlayer(session.steamId), key = session.nativeConfirmed.type === 'ban' ? 'isBanned' : 'isMuted';
            if (player?.[key] === false && (player.stamps[key] > session.nativeConfirmed.startedAt
                || player.stamps[key] === session.nativeConfirmed.startedAt && player.orders[key] > session.nativeConfirmed.sequence)) session.nativeConfirmed = null;
            else types.push(session.nativeConfirmed.type);
        }
        const type = ban || types.includes('ban') ? 'ban' : mute || types.includes('mute') ? 'mute' : null;
        if (!type) {
            const hadBadge = session.lastHtml !== null;
            this.releaseTicketPunishmentFeedback(session);
            if (hadBadge) {
                if (session.previousBadge && this.isCloseReasonTextareaVisible(session.textarea, session.scope)) {
                    this.badgeService.updateInfoBadge('helper-suggest-badge', session.previousBadge.variant,
                        session.previousBadge.html, session.textarea);
                }
                const key = this.getChatCacheKey(session.textarea);
                this.chatSignatureByKey.delete(key);
                this.activePunishmentBadgeByKey.delete(key);
                if (restoreAnalysis && this.isVisibleTicketTextarea(session.textarea)) {
                    void this.processTicketRules(session.textarea);
                }
            }
            return false;
        }
        if (!this.isCloseReasonTextareaVisible(session.textarea, session.scope)) return true;
        const icons = this.getAnalysisIcons();
        this.syncActivePunishmentPreview?.(session.textarea, type === 'ban' ? ban : mute,
            icons[type] || icons.chatError || '', type === 'ban' ? ' ЗАБАНЕН' : ' АКТИВНЫЙ МУТ');
        const html = this.buildActivePunishmentBadge(icons[type] || icons.chatError || '',
            type === 'ban' ? ' ЗАБАНЕН' : ' АКТИВНЫЙ МУТ', type === 'ban' ? ban : mute, session.textarea);
        const badge = this.document.getElementById('helper-suggest-badge');
        if (session.lastHtml !== html || !badge || badge.parentNode !== session.textarea.parentNode) {
            this.clearSuggestedMuteReason();
            this.badgeService.updateInfoBadge('helper-suggest-badge', type === 'ban' ? 'accent' : 'warning', html, session.textarea);
            session.lastHtml = html;
        }
        return true;
    },

    releaseTicketPunishmentFeedback(session) {
        session.observer.disconnect();
        for (const token of session.intents.keys()) this._punishmentFeedbackTokens?.delete(token);
        session.intents.clear();
        this._punishmentFeedbackSessions.delete(session.scope);
    },

    syncTicketPunishmentFeedback() {
        for (const session of this._punishmentFeedbackSessions?.values() || []) {
            this.refreshTicketPunishmentFeedback(session);
        }
    },

    stopTicketPunishmentFeedback() {
        this.stopActivePunishmentPreviews?.();
        for (const session of this._punishmentFeedbackSessions?.values() || []) this.releaseTicketPunishmentFeedback(session);
    }
};
