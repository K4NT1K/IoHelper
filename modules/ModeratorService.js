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

    highlightSavedModerators() {
        this.chrome.storage.local.get(['helperConfig'], ({ helperConfig }) => {
            const moderators = helperConfig?.moderators || {};
            if (Object.keys(moderators).length === 0) return;

            const links = this.document.querySelectorAll('a[href*="cybershoke.net/"]');

            links.forEach(link => {
                const match = link.href.match(/cybershoke\.net\/(\d+)/);
                if (match) {
                    const steamId = match[1];

                    if (moderators[steamId]) {

                        const row = link.closest('tr');
                        if (row && !row.classList.contains('moderhlpr-highlighted-moderator')) {
                            row.classList.add('moderhlpr-highlighted-moderator');
                        }

                        if (!link.dataset.hasModerBadge) {
                            const template = document.createElement("template");
                            template.innerHTML = Icons.admin.trim();

                            const badge = template.content.firstElementChild;
                            badge.classList.add("moderhlpr-admin-icon");

                            const idContainer = link.closest('div');
                            const parentContainer = idContainer ? idContainer.parentElement : null;

                            const nameButton = parentContainer ? parentContainer.querySelector('button') : null;

                            if (nameButton) {
                                nameButton.parentNode.insertBefore(badge, nameButton.nextSibling);
                            } else {
                                link.appendChild(badge);
                            }

                            link.dataset.hasModerBadge = 'true';
                        }
                    }
                }
            });
        });
    }
}

window.ModeratorService = ModeratorService;

