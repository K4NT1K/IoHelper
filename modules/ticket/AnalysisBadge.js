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

    handleTriggerClick(e) {
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
