import {markIoh} from './shared/dom.js';
import {flattenModeratorGroup, validScheduleSnapshot} from './shared/moderators.js';
import {PLAYER_PROFILE_LINK_SELECTOR, steamIdFromPlayerProfileUrl} from './shared/playerProfile.js';

export class ModeratorService {
    static MODERATOR_CATEGORIES = ['Tier', 'Movement', 'Hns', 'Jail'];
    static CATEGORY_KEYS = ['verification', 'Tier', 'Movement', 'Hns', 'Jail'];

    constructor({document, chrome, isEnabled = () => true}) {
        this.document = document;
        this.chrome = chrome;
        this.isEnabled = isEnabled;
        this.hasCompletedWeeklyScan = false;
        this._scanNextAt = 0;
    }

    // Compatibility entry point. Collection is owned by the daily API scheduler;
    // this service never navigates or clicks the native worktime controls.
    scanSchedulePage() {
        if (!this.isEnabled() || this._scanRequest || Date.now() < this._scanNextAt) return this._scanRequest;
        this._scanNextAt = Date.now() + 60000;
        this._scanRequest = this.chrome.runtime.sendMessage({action: 'requestScheduleScan'}).then(response => {
            if (response?.nextAt) this._scanNextAt = response.nextAt;
            this.hasCompletedWeeklyScan = response?.status === 'complete';
            return response;
        }).catch(error => {
            console.warn('[IO HELPER] API расписания:', error.message);
            return {success: false, error: error.message};
        }).finally(() => {this._scanRequest = null;});
        return this._scanRequest;
    }

    runWeeklyScheduleScan() {return this.scanSchedulePage();}

    cancelScan() {
        void this.chrome.runtime.sendMessage({action: 'cancelScheduleScan'}).catch(() => {});
    }

    isSteamId64(value) {return typeof value === 'string' && /^\d{17}$/.test(value);}

    async loadBaselineModerators() {
        const {helperConfig, helperScheduleModerators} = await this.chrome.storage.local.get(['helperConfig', 'helperScheduleModerators']);
        return this.normalizeModerators({...helperConfig?.moderators,
            ...(validScheduleSnapshot(helperScheduleModerators) ? {Tier: helperScheduleModerators.Tier} : {})});
    }

    normalizeModerators(raw) {
        const result = Object.fromEntries(ModeratorService.CATEGORY_KEYS.map(key => [key, flattenModeratorGroup(raw?.[key])]));
        // Legacy top-level SteamID -> name values remain accepted.
        for (const [key, value] of Object.entries(raw || {})) {
            if (this.isSteamId64(key) && typeof value === 'string' && value) result.Tier[key] = value;
        }
        return result;
    }

    resolveModeratorType(steamId, moderators) {
        const normalized = this.normalizeModerators(moderators);
        if (normalized.verification[steamId]) return 'verification';
        return ModeratorService.MODERATOR_CATEGORIES.some(category => normalized[category][steamId]) ? 'admin' : null;
    }

    insertModeratorBadge(link, badgeType) {
        const iconKey = badgeType === 'verification' ? 'verification' : 'admin';
        const iconSvg = window.Icons?.[iconKey];
        if (!iconSvg) {
            return false;
        }

        const scope = link.closest('td') || link.parentElement || link;
        const existingBadge = scope.querySelector('.ioh-saved-moderator-badge[data-ioh]');
        if (existingBadge && existingBadge.dataset.moderBadgeType === badgeType) {
            link.dataset.hasModerBadge = 'true';
            link.dataset.moderBadgeType = badgeType;
            return true;
        }

        if (existingBadge) {
            existingBadge.remove();
        }

        const template = this.document.createElement('template');
        template.innerHTML = iconSvg.trim();

        const badge = template.content.firstElementChild;
        if (!badge) return false;
        badge.classList.add('ioh-admin-icon', 'ioh-saved-moderator-badge');
        badge.dataset.moderBadgeType = badgeType;
        markIoh(badge);

        const idContainer = link.closest('div');
        const parentContainer = idContainer ? idContainer.parentElement : null;
        const nameButton = parentContainer ? parentContainer.querySelector('button') : null;

        if (nameButton) {
            nameButton.parentNode.insertBefore(badge, nameButton.nextSibling);
        } else {
            link.appendChild(badge);
        }

        link.dataset.hasModerBadge = 'true';
        link.dataset.moderBadgeType = badgeType;
        return true;
    }

    _findCurrentServerSections() {
        const sections = new Set();
        const headers = Array.from(this.document.querySelectorAll('h3'))
            .filter(h => h.textContent?.includes('Текущий сервер')
                && h.getClientRects().length && !h.closest('[aria-hidden="true"]'));
        for (const header of headers) {
            const panel = header.closest('[aria-hidden]') || header.closest('main, [role="main"]');
            if (!panel) continue;
            // In the standalone server view, summary and player table are separate
            // siblings. Identify the player table by its columns within this panel.
            for (const table of panel.querySelectorAll('table')) {
                if (!table.getClientRects().length || table.closest('[aria-hidden="true"]')) continue;
                const columns = Array.from(table.querySelectorAll('thead th'))
                    .map(cell => cell.textContent.replace(/\s+/g, ' ').trim().toLowerCase());
                if (columns.includes('игрок') && (columns.includes('команда') || columns.includes('на сервере') || columns.includes('действия'))) {
                    sections.add(table);
                }
            }
        }
        return [...sections];
    }

    _findCurrentServerSection() {return this._findCurrentServerSections()[0] || null;}

    clearSavedModerator(link) {
        const scope = link.closest('td') || link.parentElement || link;
        scope.querySelectorAll('.ioh-saved-moderator-badge[data-ioh]').forEach(badge => badge.remove());
        const row = link.closest('tr');
        if (row?.dataset.iohSavedModerator) {
            delete row.dataset.iohSavedModerator;
            if (!row.querySelector('.ioh-moderator-badge, .ioh-profile-verified, [data-ioh-moderator-source="1"]')) {
                row.classList.remove('ioh-highlighted-moderator');
            }
        }
        delete link.dataset.hasModerBadge;
        delete link.dataset.moderBadgeType;
    }

    async highlightSavedModerators() {
        const generation = this._highlightGeneration = (this._highlightGeneration || 0) + 1;
        let moderators;
        try {
            moderators = await this.loadBaselineModerators();
        } catch (error) {
            console.warn('[IO HELPER] Не удалось прочитать состав модераторов:', error.message);
            return;
        }
        if (generation !== this._highlightGeneration) return;
        // Resolve the current visible scopes after the asynchronous storage read.
        for (const section of this._findCurrentServerSections()) {
            for (const link of section.querySelectorAll(PLAYER_PROFILE_LINK_SELECTOR)) {
                const steamId = steamIdFromPlayerProfileUrl(link.href);
                if (!steamId) continue;
                const badgeType = this.resolveModeratorType(steamId, moderators);
                if (!badgeType) {
                    this.clearSavedModerator(link);
                    continue;
                }

                const row = link.closest('tr');
                if (row) {
                    row.classList.add('ioh-highlighted-moderator');
                    row.dataset.iohSavedModerator = '1';
                }

                // Check the actual badge as well: native rerenders may remove only the SVG.
                this.insertModeratorBadge(link, badgeType);
            }
        }
    }
}
