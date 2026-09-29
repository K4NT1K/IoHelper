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

    handleTriggerClick(e) {
        const more = e.target.closest('.ioh-more-triggers');
        if (more) {
            this.revealMoreTriggers(more);
            return;
        }

        const trigger = e.target.closest(".ioh-trigger-link");
        if (!trigger) return;

        const target = this.triggerRows.get(trigger.dataset.triggerId);
        if (!target) return;

        const rows = Array.isArray(target) ? target : [target];

        rows[0].scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

        rows.forEach(row => row.classList.add("ioh-chat-highlight"));

        setTimeout(() => {
            rows.forEach(row => row.classList.remove("ioh-chat-highlight"));
        }, 1000);
    },

    clearTicketRuleBadge() {
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
