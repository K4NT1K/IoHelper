class ModeratorService {
    static WEEKDAY_LABELS = [
        'Понедельник',
        'Вторник',
        'Среда',
        'Четверг',
        'Пятница',
        'Суббота',
        'Воскресенье'
    ];

    static MODERATOR_CATEGORIES = ['Tier', 'Movement', 'Hns', 'Jail'];

    static CATEGORY_KEYS = ['verification', 'Tier', 'Movement', 'Hns', 'Jail'];

    constructor({ document, chrome }) {
        this.document = document;
        this.chrome = chrome;
        this.isScanning = false;
        this.hasCompletedWeeklyScan = false;
    }

    scanSchedulePage() {
        if (!window.location.href.includes('/worktime')) {
            return;
        }

        if (this.isScanning || this.hasCompletedWeeklyScan) {
            return;
        }

        void this.runWeeklyScheduleScan();
    }

    async runWeeklyScheduleScan() {
        this.isScanning = true;
        console.log('[IO HELPER] Недельный скан расписания запущен.');

        try {
            const dayButtons = await this.waitForDayButtons();
            if (!dayButtons) {
                console.log('[IO HELPER] Кнопки дней недели не найдены. Остановка.');
                return;
            }

            const scheduleModerators = {};

            let previousFingerprint = null;

            for (const dayLabel of ModeratorService.WEEKDAY_LABELS) {
                const button = dayButtons[dayLabel];
                if (!button) {
                    console.log(`[IO HELPER] Кнопка «${dayLabel}» не найдена, пропуск.`);
                    continue;
                }

                console.log(`[IO HELPER] Сканирование дня: ${dayLabel}`);
                button.click();

                const ready = await this.waitForScheduleContent(previousFingerprint);
                if (!ready) {
                    console.log(`[IO HELPER] Контент расписания для «${dayLabel}» не загрузился вовремя.`);
                }

                const dayMods = this.collectModeratorsFromPage();
                previousFingerprint = this.getScheduleFingerprint();
                const dayCount = Object.keys(dayMods).length;
                console.log(`[IO HELPER] «${dayLabel}»: найдено ${dayCount} модераторов.`);

                Object.assign(scheduleModerators, dayMods);
            }

            const totalFound = Object.keys(scheduleModerators).length;
            if (totalFound === 0) {
                console.log('[IO HELPER] Модераторы на странице не найдены. Остановка.');
                return;
            }

            await this.applyTierDiffAndReport(scheduleModerators);
        } catch (error) {
            console.error('[IO HELPER] Ошибка недельного скана расписания:', error);
        } finally {
            this.hasCompletedWeeklyScan = true;
            this.isScanning = false;
        }
    }

    waitForDayButtons(timeoutMs = 15000) {
        return new Promise((resolve) => {
            const find = () => this.findDayButtons();

            const existing = find();
            if (existing) {
                resolve(existing);
                return;
            }

            const startedAt = Date.now();
            const observer = new MutationObserver(() => {
                const buttons = find();
                if (buttons) {
                    observer.disconnect();
                    clearInterval(pollId);
                    resolve(buttons);
                } else if (Date.now() - startedAt >= timeoutMs) {
                    observer.disconnect();
                    clearInterval(pollId);
                    resolve(null);
                }
            });

            observer.observe(this.document.body, { childList: true, subtree: true });

            const pollId = setInterval(() => {
                const buttons = find();
                if (buttons) {
                    observer.disconnect();
                    clearInterval(pollId);
                    resolve(buttons);
                } else if (Date.now() - startedAt >= timeoutMs) {
                    observer.disconnect();
                    clearInterval(pollId);
                    resolve(null);
                }
            }, 250);
        });
    }

    findDayButtons() {
        const buttons = {};
        const allButtons = this.document.querySelectorAll('button[type="button"]');

        allButtons.forEach((button) => {
            const label = (button.textContent || '').replace(/\s+/g, ' ').trim();
            if (ModeratorService.WEEKDAY_LABELS.includes(label)) {
                buttons[label] = button;
            }
        });

        const foundCount = Object.keys(buttons).length;
        return foundCount >= 7 ? buttons : null;
    }

    waitForScheduleContent(previousFingerprint, timeoutMs = 10000) {
        return new Promise((resolve) => {
            const isReady = () => {
                const fingerprint = this.getScheduleFingerprint();
                if (!fingerprint) {
                    return false;
                }

                // First day: any content is enough. Later days: wait until content changes.
                if (previousFingerprint == null) {
                    return true;
                }

                return fingerprint !== previousFingerprint;
            };

            const finish = (ok) => {
                // Small settle delay for SPA re-render after day switch.
                setTimeout(() => resolve(ok), 350);
            };

            if (isReady()) {
                finish(true);
                return;
            }

            const startedAt = Date.now();
            const observer = new MutationObserver(() => {
                if (isReady()) {
                    observer.disconnect();
                    clearInterval(pollId);
                    finish(true);
                } else if (Date.now() - startedAt >= timeoutMs) {
                    observer.disconnect();
                    clearInterval(pollId);
                    finish(this.countScheduleMarkers() > 0);
                }
            });

            observer.observe(this.document.body, { childList: true, subtree: true });

            const pollId = setInterval(() => {
                if (isReady()) {
                    observer.disconnect();
                    clearInterval(pollId);
                    finish(true);
                } else if (Date.now() - startedAt >= timeoutMs) {
                    observer.disconnect();
                    clearInterval(pollId);
                    finish(this.countScheduleMarkers() > 0);
                }
            }, 200);
        });
    }

    countScheduleMarkers() {
        return this.document.querySelectorAll(
            'a[href*="/moderator/profile/"], [data-steamid64]'
        ).length;
    }

    getScheduleFingerprint() {
        const ids = new Set();

        this.document.querySelectorAll('[data-steamid64]').forEach((node) => {
            const steamId = (node.getAttribute('data-steamid64') || '').trim();
            if (this.isSteamId64(steamId)) {
                ids.add(steamId);
            }
        });

        this.document.querySelectorAll('a[href*="/moderator/profile/"]').forEach((link) => {
            const match = (link.getAttribute('href') || link.href || '')
                .match(/\/moderator\/profile\/(\d{17,18})/);
            if (match) {
                ids.add(match[1]);
            }
        });

        if (ids.size === 0) {
            return null;
        }

        return Array.from(ids).sort().join(',');
    }

    collectModeratorsFromPage() {
        const result = {};

        this.document.querySelectorAll('[data-steamid64]').forEach((node) => {
            const steamId = (node.getAttribute('data-steamid64') || '').trim();
            if (!this.isSteamId64(steamId)) {
                return;
            }

            const nick = this.extractNickFromSteamidNode(node, steamId);
            if (nick) {
                result[steamId] = nick;
            }
        });

        this.document.querySelectorAll('a[href*="/moderator/profile/"]').forEach((link) => {
            const match = (link.getAttribute('href') || link.href || '')
                .match(/\/moderator\/profile\/(\d{17,18})/);
            if (!match) {
                return;
            }

            const steamId = match[1];
            if (result[steamId]) {
                return;
            }

            const nick = this.extractNickFromProfileLink(link, steamId);
            if (nick) {
                result[steamId] = nick;
            }
        });

        return result;
    }

    extractNickFromSteamidNode(node, steamId) {
        const img = node.querySelector('img[alt]');
        if (img) {
            const alt = (img.getAttribute('alt') || '').trim();
            if (this.isValidNick(alt, steamId)) {
                return alt;
            }
        }

        const title = (node.closest('[title]')?.getAttribute('title') || '').trim();
        if (this.isValidNick(title, steamId)) {
            return title;
        }

        const roleLinks = node.querySelectorAll('[role="link"]');
        for (const el of roleLinks) {
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (this.isValidNick(text, steamId) && !/^\d{1,2}:\d{2}/.test(text)) {
                return text;
            }
        }

        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        const withoutTime = text.replace(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g, '').trim();
        if (this.isValidNick(withoutTime, steamId)) {
            return withoutTime;
        }

        return null;
    }

    extractNickFromProfileLink(link, steamId) {
        const span = link.querySelector('span');
        if (span) {
            const text = (span.textContent || '').replace(/\s+/g, ' ').trim();
            if (this.isValidNick(text, steamId)) {
                return text;
            }
        }

        const img = link.querySelector('img[alt]');
        if (img) {
            const alt = (img.getAttribute('alt') || '').trim();
            if (this.isValidNick(alt, steamId)) {
                return alt;
            }
        }

        const card = link.closest('[data-player-card="true"]');
        if (card) {
            const nickLink = Array.from(card.querySelectorAll('a[href*="/moderator/profile/"]'))
                .find((a) => {
                    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
                    return this.isValidNick(text, steamId);
                });
            if (nickLink) {
                return (nickLink.textContent || '').replace(/\s+/g, ' ').trim();
            }

            const imgAlt = card.querySelector('img[alt]');
            if (imgAlt) {
                const alt = (imgAlt.getAttribute('alt') || '').trim();
                if (this.isValidNick(alt, steamId)) {
                    return alt;
                }
            }
        }

        const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
        if (this.isValidNick(text, steamId)) {
            return text;
        }

        return null;
    }

    isSteamId64(value) {
        return typeof value === 'string' && /^\d{17,18}$/.test(value);
    }

    isValidNick(name, steamId) {
        if (!name || typeof name !== 'string') {
            return false;
        }

        const trimmed = name.trim();
        if (trimmed.length < 1) {
            return false;
        }

        if (trimmed.includes('ID:')) {
            return false;
        }

        if (trimmed === steamId || /^\d{17,18}$/.test(trimmed)) {
            return false;
        }

        return true;
    }

    applyTierDiffAndReport(scheduleModerators) {
        return new Promise((resolve) => {
            this.chrome.storage.local.get(['helperConfig'], ({ helperConfig }) => {
                if (!helperConfig) {
                    console.log('[IO HELPER] helperConfig не найден в storage.');
                    resolve();
                    return;
                }

                const moderators = this.normalizeModerators(helperConfig.moderators);
                const oldTier = { ...(moderators.Tier || {}) };

                const added = {};
                const removed = {};
                const newTier = {};

                for (const [steamId, nick] of Object.entries(scheduleModerators)) {
                    newTier[steamId] = nick;
                    if (!oldTier[steamId]) {
                        added[steamId] = nick;
                    }
                }

                for (const [steamId, nick] of Object.entries(oldTier)) {
                    if (!scheduleModerators[steamId]) {
                        removed[steamId] = nick;
                    }
                }

                moderators.Tier = newTier;
                helperConfig.moderators = moderators;

                if (helperConfig.weeklySchedule) {
                    delete helperConfig.weeklySchedule;
                }

                this.chrome.storage.local.set({ helperConfig }, () => {
                    console.log('[IO HELPER] === Результат недельного скана Tier ===');
                    console.log('[IO HELPER] Добавленные модераторы:', added);
                    console.log('[IO HELPER] Удалённые модераторы:', removed);
                    console.log('[IO HELPER] Полный JSON модераторов (для копипаста):');
                    console.log(JSON.stringify(moderators, null, 2));
                    console.log(
                        `[IO HELPER] Итого в Tier: ${Object.keys(newTier).length}`
                        + ` (добавлено: ${Object.keys(added).length},`
                        + ` удалено: ${Object.keys(removed).length})`
                    );
                    resolve();
                });
            });
        });
    }

    normalizeModerators(raw) {
        const result = {
            verification: {},
            Tier: {},
            Movement: {},
            Hns: {},
            Jail: {}
        };

        if (!raw || typeof raw !== 'object') {
            return result;
        }

        for (const key of ModeratorService.CATEGORY_KEYS) {
            if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
                result[key] = { ...raw[key] };
            }
        }

        // Legacy flat format: steamId → nick at top level.
        for (const [key, value] of Object.entries(raw)) {
            if (ModeratorService.CATEGORY_KEYS.includes(key)) {
                continue;
            }

            if (typeof value === 'string' && this.isSteamId64(key) && value) {
                result.Tier[key] = value;
            }
        }

        return result;
    }

    resolveModeratorType(steamId, moderators) {
        const normalized = this.normalizeModerators(moderators);

        if (normalized.verification?.[steamId]) {
            return 'verification';
        }

        for (const category of ModeratorService.MODERATOR_CATEGORIES) {
            if (normalized[category]?.[steamId]) {
                return 'admin';
            }
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
