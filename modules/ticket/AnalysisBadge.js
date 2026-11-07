export const AnalysisBadgeMethods = {
    setSuggestedMuteReason(steamId, label) {
        this.suggestedMuteReason = label ? {steamId: steamId || '', label} : null;
    },

    getSuggestedMuteReason(steamId) {
        const entry = this.suggestedMuteReason;
        if (!entry?.label) {
            return null;
        }

        // Prefer exact SteamID match; if either side is missing, still use
        // the analysis suggestion (form may open before SteamID is prefilled).
        if (!entry.steamId || !steamId || entry.steamId === steamId) {
            return entry.label;
        }

        return null;
    },

    clearSuggestedMuteReason() {
        this.suggestedMuteReason = null;
    },

    buildTriggerHtml(trigger) {
        return `<span
        class="ioh-trigger-tooltip ioh-trigger-link"
        data-trigger-id="${trigger.id}"
        data-full-msg="${this.utils.escapeHtml(trigger.fullMessage)}">
        ${this.utils.escapeHtml(trigger.keyword)}
    </span>`;
    },

    getTriggerSeparatorHtml() {
        return '<span class="ioh-trigger-separator">,</span> ';
    },

    buildVisibleTriggersHtml() {
        const sortedTriggers = this._sortedTriggers || [];
        const visible = sortedTriggers.slice(0, this._visibleTriggerCount);
        const separator = this.getTriggerSeparatorHtml();
        let html = visible.map(trigger => this.buildTriggerHtml(trigger)).join(separator);
        if (sortedTriggers.length > this._visibleTriggerCount) {
            html += `${separator}<span class="ioh-trigger-tooltip ioh-more-triggers">ещё</span>`;
        }
        return html;
    },

    revealMoreTriggers(button) {
        const all = this._sortedTriggers || [];
        const step = Number(this.settings?.moreTriggers) || 10;
        const from = this._visibleTriggerCount;
        const to = Math.min(from + step, all.length);
        const extra = all.slice(from, to);
        if (!extra.length) {
            this.removeMoreTriggersButton(button);
            return;
        }

        const separator = this.getTriggerSeparatorHtml();
        const html = extra.map(trigger => this.buildTriggerHtml(trigger)).join(separator);
        button.insertAdjacentHTML('beforebegin', `${separator}${html}`);
        this._visibleTriggerCount = to;

        if (to >= all.length) {
            this.removeMoreTriggersButton(button);
        }
    },

    removeMoreTriggersButton(button) {
        const prev = button.previousElementSibling;
        if (prev?.classList.contains('ioh-trigger-separator')) {
            prev.remove();
        }
        button.remove();
    },

    cancelTriggerNavigation() {
        this.badgeService?.hideTriggerTooltip?.();
        this._triggerNavigationCancel?.(); this._triggerNavigationCancel = null;
        clearTimeout(this._triggerHighlightTimer);
        this._triggerHighlightedRows?.forEach(row => row.classList.remove('ioh-chat-highlight'));
        this._triggerHighlightedRows = null;
    },

    waitForNativeMessageRows(scope, textarea, messages) {
        const key = this.getNativeTicket(scope)?.key;
        return new Promise(resolve => {
            let observer, timer, finished = false;
            const finish = rows => {
                if (finished) return; finished = true;
                observer?.disconnect(); clearTimeout(timer);
                if (this._triggerNavigationCancel === cancel) this._triggerNavigationCancel = null;
                resolve(rows);
            };
            const cancel = () => finish([]);
            const check = () => {
                if (!this.document.contains(textarea) || !this.isVisibleTicketTextarea(textarea)
                    || this.getTicketScopeRoot(textarea) !== scope || this.getNativeTicket(scope)?.key !== key) return finish([]);
                const bindings = this.bindNativeMessageRows(scope);
                const rows = messages.map(m => bindings.get(m.id)).filter(Boolean);
                if (rows.length) finish(rows);
            };
            this._triggerNavigationCancel = cancel;
            observer = new MutationObserver(check);
            observer.observe(this.getHistorySectionCard('История Чата', scope) || scope, {childList: true, subtree: true});
            timer = setTimeout(() => finish([]), 2000);
            const accordion = this.getHistoryAccordionButton('История Чата', scope);
            if (accordion?.getAttribute('aria-expanded') === 'false') accordion.click();
            check();
        });
    },

    async handleTriggerClick(e) {
        const more = e.target.closest('.ioh-more-triggers');
        if (more) {
            this.revealMoreTriggers(more);
            return;
        }

        const trigger = e.target.closest(".ioh-trigger-link");
        if (!trigger) return;

        const target = this.triggerRows.get(trigger.dataset.triggerId);
        if (!target) return;
        this.cancelTriggerNavigation();

        let rows = Array.isArray(target) ? target : [target];
        if (this.nativeData) {
            const textarea = this.findVisibleTicketResolutionTextarea();
            const scope = textarea && this.getTicketScopeRoot(textarea);
            const binding = scope && this.bindNativeMessageRows(scope);
            const messages = rows;
            rows = messages.map(message => binding?.get(message.id)).filter(Boolean);
            if (!rows.length && scope) rows = await this.waitForNativeMessageRows(scope, textarea, messages);
            if (!rows.length) return;
        }

        rows[0].scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

        rows.forEach(row => row.classList.add("ioh-chat-highlight"));

        this._triggerHighlightedRows = rows;
        this._triggerHighlightTimer = setTimeout(() => {
            rows.forEach(row => row.classList.remove("ioh-chat-highlight"));
            this._triggerHighlightedRows = null;
        }, 1000);
    },

    clearTicketRuleBadge() {
        this.cancelTriggerNavigation();
        this.stopActivePunishmentPreviews?.();
        this.document.getElementById('helper-suggest-badge')?.remove();
        this.activePunishmentBadgeByKey.clear();
        this._sortedTriggers = [];
        this._visibleTriggerCount = 0;
        this.clearSuggestedMuteReason();
    },

    getAnalysisIcons() {
        const icons = window.Icons || {};

        return {
            triggers: icons.loupe || '',
            reason: icons.bell || '',
            info: icons.info || '',
            punishment: icons.clock || '',
            chatError: icons.chat || '',
            done: icons.done || icons.shield || '',
            ban: icons.ban || '',
            mute: icons.mute || '',
            warning: icons.warning || ''
        };
    },
};
