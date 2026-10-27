import {markIoh} from './shared/dom.js';
import {flattenModeratorGroup, validScheduleSnapshot} from './shared/moderators.js';

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

        const existingBadge = link.parentElement?.querySelector('.ioh-admin-icon')
            || link.querySelector('.ioh-admin-icon');
        if (existingBadge && link.dataset.moderBadgeType === badgeType) {
            link.dataset.hasModerBadge = 'true';
            return true;
        }

        if (existingBadge) {
            existingBadge.remove();
        }

        const template = document.createElement('template');
        template.innerHTML = iconSvg.trim();

        const badge = template.content.firstElementChild;
        badge.classList.add('ioh-admin-icon');
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

    _findCurrentServerSection() {
        const header = Array.from(this.document.querySelectorAll('h3'))
            .find(h => h.textContent?.includes('Текущий сервер') && !h.closest('[aria-hidden="true"]'));

        if (!header) {
            return null;
        }

        let container = header.parentElement;
        for (let depth = 0; depth < 8 && container; depth++) {
            if (
                container.querySelector('table')
                && container.querySelector('a[href*="cybershoke.net/"]')
            ) {
                return container;
            }
            container = container.parentElement;
        }

        return header.closest('main, [role="main"], section, article, [role="tabpanel"]')
            || header.parentElement;
    }

    highlightSavedModerators() {
        this.chrome.storage.local.get(['helperConfig', 'helperScheduleModerators'], ({helperConfig, helperScheduleModerators}) => {
            const moderators = {...(helperConfig?.moderators || {}),
                ...(validScheduleSnapshot(helperScheduleModerators) ? {Tier: helperScheduleModerators.Tier} : {})};
            if (Object.keys(moderators).length === 0) return;

            const section = this._findCurrentServerSection();
            if (!section) return;

            const links = section.querySelectorAll('a[href*="cybershoke.net/"]');

            links.forEach(link => {
                const match = link.href.match(/cybershoke\.net\/(\d+)/);
                if (!match) return;

                const steamId = match[1];
                const badgeType = this.resolveModeratorType(steamId, moderators);
                if (!badgeType) {
                    if (link.dataset.hasModerBadge) {
                        const badge = link.parentElement?.querySelector('.ioh-admin-icon[data-ioh]') || link.querySelector('.ioh-admin-icon[data-ioh]')
                            || link.closest('tr')?.querySelector('.ioh-admin-icon[data-ioh]');
                        badge?.remove();
                        link.closest('tr')?.classList.remove('ioh-highlighted-moderator');
                        delete link.dataset.hasModerBadge;
                        delete link.dataset.moderBadgeType;
                    }
                    return;
                }

                const row = link.closest('tr');
                if (row && !row.classList.contains('ioh-highlighted-moderator')) {
                    row.classList.add('ioh-highlighted-moderator');
                }

                if (!link.dataset.hasModerBadge || link.dataset.moderBadgeType !== badgeType) {
                    this.insertModeratorBadge(link, badgeType);
                }
            });
        });
    }
}
