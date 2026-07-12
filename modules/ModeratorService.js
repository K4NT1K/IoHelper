class ModeratorService {
    constructor({ document, chrome }) {
        this.document = document;
        this.chrome = chrome;
    }

    scanSchedulePage() {
        if (!window.location.href.includes('/worktime')) {
            return;
        }

        console.log("[IO HELPER] Метод ScanPage ЗАПУЩЕН.");

        const dayInfoEl = this.document.querySelector('.day-info');
        const currentDayKey = dayInfoEl ? dayInfoEl.textContent.replace(/\s+/g, ' ').trim() : 'default';

        const rows = this.document.querySelectorAll('tr');
        let currentDayModerators = {};

        rows.forEach((row) => {
            const profileLinks = row.querySelectorAll('a[href*="/moderator/profile/"]');
            profileLinks.forEach(link => {
                const match = link.href.match(/\/moderator\/profile\/(\d+)/);
                if (match) {
                    const steamId = match[1];
                    const name = link.innerText.trim();

                    if (name && name.length > 1 && !name.includes('ID:') && isNaN(name)) {
                        currentDayModerators[steamId] = name;
                    }
                }
            });
        });

        const parsedCount = Object.keys(currentDayModerators).length;
        if (parsedCount === 0) {
            console.log("[IO HELPER] Модераторы на странице не найдены. Остановка.");
            return;
        }

        this.chrome.storage.local.get(['helperConfig'], ({ helperConfig }) => {
            if (!helperConfig) return;

            if (!helperConfig.weeklySchedule) {
                helperConfig.weeklySchedule = {};
            }

            helperConfig.weeklySchedule[currentDayKey] = currentDayModerators;

            let allActualModerators = {};
            for (const day in helperConfig.weeklySchedule) {
                allActualModerators = {
                    ...allActualModerators,
                    ...helperConfig.weeklySchedule[day]
                };
            }

            helperConfig.moderators = allActualModerators;

            this.chrome.storage.local.set({ helperConfig }, () => {
                console.log("[IO HELPER] Успешно сохранено модераторов:", parsedCount);
            });
        });
    }

    resolveModeratorType(steamId, moderators) {
        if (moderators?.verification?.[steamId]) {
            return 'verification';
        }

        const entry = moderators?.[steamId];
        if (typeof entry === 'string' && entry) {
            return 'admin';
        }

        return null;
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

    highlightSavedModerators() {
        this.chrome.storage.local.get(['helperConfig'], ({ helperConfig }) => {
            const moderators = helperConfig?.moderators || {};
            if (Object.keys(moderators).length === 0) return;

            const links = this.document.querySelectorAll('a[href*="cybershoke.net/"]');

            links.forEach(link => {
                const match = link.href.match(/cybershoke\.net\/(\d+)/);
                if (!match) return;

                const steamId = match[1];
                const badgeType = this.resolveModeratorType(steamId, moderators);
                if (!badgeType) return;

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

window.ModeratorService = ModeratorService;

