class MessageService {
    static CYBERSHOKE_HOURS_RE = /CYBERSHOKE:\s*(\d+)ч/i;
    static DUPLICATE_SERVER_COLOR_COUNT = 7;

    constructor({ document, utils, badgeService, settings }) {
        this.document = document;
        this.utils = utils;
        this.badgeService = badgeService;
        this.settings = settings;
        this.ticketService = null;
        this.hoursWatchObservers = new WeakMap();
        this.HOURS_WATCH_TTL_MS = 30000;
    }

    decorateMessageCell(messageCell) {
        if (messageCell.dataset.mhlprHoverReady === 'true') return;

        const textNode = this.utils.extractMainTextNode(messageCell);
        if (!textNode) return;

        const originalText = textNode.nodeValue;
        const isRussian = this.utils.detectLanguage(originalText);
        messageCell.dataset.mhlprOriginalText = originalText;

        if (isRussian) {
            messageCell.dataset.mhlprHoverReady = 'true';
            return;
        }

        messageCell.dataset.mhlprHoverReady = 'true';
        messageCell.classList.add('ioh-chat-message');

        const translateOnHover = async () => {
            if (messageCell.dataset.isTranslating === 'true') return;

            if (!messageCell.dataset.translatedText) {
                messageCell.dataset.isTranslating = 'true';
                messageCell.classList.add('ioh-loading');

                const result = await this.badgeService.translateText(originalText, 'RU');

                messageCell.classList.remove('ioh-loading');
                messageCell.dataset.isTranslating = 'false';

                if (result && result.translated) {
                    messageCell.dataset.translatedText = result.translated;
                }
            }

            if (messageCell.matches(':hover') && messageCell.dataset.translatedText) {
                textNode.nodeValue = messageCell.dataset.translatedText;
                messageCell.classList.add('ioh-translated');
            }
        };

        const restore = () => {
            textNode.nodeValue = originalText;
            messageCell.classList.remove('ioh-translated');
        };

        messageCell.addEventListener('mouseenter', translateOnHover);
        messageCell.addEventListener('mouseleave', restore);
    }

    _findChatHistoryBlock() {
        for (const header of this.document.querySelectorAll('h3, h2')) {
            const text = header.textContent || '';
            if (text.includes('История Чата') && !text.includes('История Тикетов')) {
                const block = header.closest('section, article, [role="tabpanel"], .card') || header.parentElement;
                if (block) {
                    return block;
                }
            }
        }

        return null;
    }

    _isComplaintQueuePage() {
        const href = window.location.href;
        return href.includes('/support/tickets') || href.includes('/support/reports');
    }

    _getComplaintQueueRows() {
        if (!this._isComplaintQueuePage()) {
            return [];
        }

        return this.document.querySelectorAll('table tbody tr');
    }

    processChatMessages() {
        const scope = this.document.body;
        const chatHistoryBlock = this.ticketService?.getBlockByHeaderScoped('История Чата', scope)
            || this.ticketService?.getHistorySectionCard('История Чата', scope)
            || this._findChatHistoryBlock();
        if (!chatHistoryBlock) return;
        const rows = Array.from(chatHistoryBlock.querySelectorAll('tbody tr, tr')).filter(row => row.querySelector('td'));
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) this.decorateMessageCell(cells[cells.length - 1]);
        });
    }

    highlightComplaintTriggers(targetRow) {
        const rows = targetRow ? [targetRow] : this._getComplaintQueueRows();

        rows.forEach(row => {
            if (row.querySelector('th') || row.dataset.triggersChecked) return;

            const cells = row.querySelectorAll('td');
            const reportCell = cells[5];

            if (!reportCell) return;

            const {playerText} = this.utils.parseComplaintCell(reportCell);
            const playerEl = reportCell.querySelector(':scope > div > span') ||
                reportCell.querySelector('span');

            if (!playerEl || !playerText) {
                return;
            }

            let html = playerEl.innerHTML;
            let changed = false;

            this.settings.reasonTriggers.forEach(trigger => {
                if (!trigger) return;
                const escapedTrigger = trigger.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const regex = new RegExp(`(${escapedTrigger})`, 'gi');

                if (regex.test(html)) {
                    html = html.replace(regex, '<span class="ioh-complaint-trigger">$1</span>');
                    changed = true;
                }
            });

            if (changed) {
                playerEl.innerHTML = html;
            }

            row.dataset.triggersChecked = 'true';
        });
    }

    clearComplaintTriggerHighlights() {
        this.document.querySelectorAll('.ioh-complaint-trigger').forEach(span => {
            span.replaceWith(this.document.createTextNode(span.textContent || ''));
        });

        this.document.querySelectorAll('tr[data-triggers-checked]').forEach(row => {
            delete row.dataset.triggersChecked;
        });
    }

    releaseHoursWatch(row) {
        const entry = this.hoursWatchObservers.get(row);
        if (!entry) {
            return;
        }

        entry.observer.disconnect();
        clearTimeout(entry.timeoutId);
        this.hoursWatchObservers.delete(row);
    }

    releaseAllHoursWatches() {
        if (this.hoursWatchObservers.size) {
            console.log(`[Helper] MessageService: hoursWatch observers teardown (${this.hoursWatchObservers.size})`);
        }
        this.document.querySelectorAll('table tbody tr').forEach(row => this.releaseHoursWatch(row));
    }

    ensureHoursWatch(row) {
        if (!row?.closest?.('tbody') || this.hoursWatchObservers.has(row)) {
            return;
        }

        const observer = new MutationObserver(() => {
            if (!MessageService.CYBERSHOKE_HOURS_RE.test(row.innerText || '')) {
                return;
            }

            this.releaseHoursWatch(row);
            this.highlightNewAccounts(row);
        });

        const timeoutId = setTimeout(() => this.releaseHoursWatch(row), this.HOURS_WATCH_TTL_MS);

        this.hoursWatchObservers.set(row, { observer, timeoutId });
        observer.observe(row, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    _clearRowHoursState(row) {
        delete row.dataset.iohNewAccountHours;
    }

    _setRowHoursState(row, hours) {
        row.dataset.iohNewAccountHours = String(hours);
    }

    _clearRowHoursHighlight(row) {
        row.querySelectorAll('.ioh-new-account-hours').forEach(span => {
            span.classList.remove('ioh-new-account-hours');
        });
        this._clearRowHoursState(row);
    }

    _markHoursHighlight(span) {
        if (span.classList.contains('ioh-new-account-hours')) {
            return;
        }

        span.classList.add('ioh-new-account-hours');
    }

    _applyRowHoursHighlight(row) {
        row.querySelectorAll('div').forEach(div => {
            if (!div.innerText.includes('CYBERSHOKE:')) {
                return;
            }

            const existingSpan = div.querySelector('.cs-hours-span');
            if (existingSpan) {
                this._markHoursHighlight(existingSpan);
                return;
            }

            const html = div.innerHTML;
            const newHtml = html.replace(/(CYBERSHOKE:\s*)(\d+ч)/i, (fullMatch, prefix, hoursText) => {
                if (fullMatch.includes('ioh-new-account-hours')) {
                    return fullMatch;
                }

                return `${prefix}<span class="cs-hours-span ioh-new-account-hours">${hoursText}</span>`;
            });

            if (newHtml !== html) {
                div.innerHTML = newHtml;
            }
        });
    }

    highlightNewAccounts(row) {
        if (!row?.querySelector) {
            return;
        }

        const match = (row.innerText || '').match(MessageService.CYBERSHOKE_HOURS_RE);

        if (!match) {
            this.ensureHoursWatch(row);
            return;
        }

        this.releaseHoursWatch(row);

        const hours = parseInt(match[1], 10);

        if (hours >= this.settings.newAccountHours) {
            this._clearRowHoursHighlight(row);
            return;
        }

        this._setRowHoursState(row, hours);
        this._applyRowHoursHighlight(row);
    }

    syncNewAccountHighlights() {
        const apply = () => {
            this._getComplaintQueueRows().forEach(row => this.highlightNewAccounts(row));
        };

        apply();
        requestAnimationFrame(apply);
        setTimeout(apply, 150);
    }

    clearNewAccountHighlights() {
        this.document.querySelectorAll('.ioh-new-account-hours').forEach(span => {
            span.classList.remove('ioh-new-account-hours');
        });
        this.document.querySelectorAll('tr[data-ioh-new-account-hours]').forEach(row => {
            delete row.dataset.iohNewAccountHours;
        });
        this.releaseAllHoursWatches();
    }

    reapplyNewAccountHighlights() {
        this.clearNewAccountHighlights();
        if (this._isComplaintQueuePage()) {
            this.syncNewAccountHighlights();
            return;
        }

        this.document.querySelectorAll('table tbody tr').forEach(row => {
            this.highlightNewAccounts(row);
        });
    }

    highlightDuplicateServerIps() {
        this.clearDuplicateServerHighlights();

        const serverMap = new Map();

        this.document.querySelectorAll('table tbody tr').forEach(row => {
            if (row.querySelector('th')) {
                return;
            }

            const serverLink = row.querySelector('a[href^="steam://connect/"]');
            if (!serverLink) {
                return;
            }

            const serverIp = serverLink.textContent.trim();
            if (!serverIp) {
                return;
            }

            if (!serverMap.has(serverIp)) {
                serverMap.set(serverIp, []);
            }

            serverMap.get(serverIp).push(row);
        });

        let colorIndex = 0;

        for (const rows of serverMap.values()) {
            if (rows.length < 2) {
                continue;
            }

            const dupColor = String(colorIndex % MessageService.DUPLICATE_SERVER_COLOR_COUNT);
            colorIndex += 1;

            rows.forEach(row => {
                row.classList.add('ioh-duplicate-server');
                row.dataset.iohDupColor = dupColor;
                row.dataset.duplicateServerChecked = 'true';
            });
        }
    }

    clearDuplicateServerHighlights() {
        this.document
            .querySelectorAll('.ioh-duplicate-server, tr[data-duplicate-server-checked], tr[data-ioh-dup-color]')
            .forEach(row => {
                row.classList.remove('ioh-duplicate-server');
                delete row.dataset.iohDupColor;
                delete row.dataset.duplicateServerChecked;
            });
    }

    clearTranslationDecorations() {
        this.document.querySelectorAll('.ioh-chat-message').forEach(messageCell => {
            const textNode = this.utils.extractMainTextNode(messageCell);
            if (textNode && messageCell.dataset.mhlprOriginalText) {
                textNode.nodeValue = messageCell.dataset.mhlprOriginalText;
            }

            messageCell.classList.remove('ioh-chat-message', 'ioh-loading', 'ioh-translated');
            delete messageCell.dataset.mhlprHoverReady;
            delete messageCell.dataset.isTranslating;
            delete messageCell.dataset.translatedText;
            delete messageCell.dataset.mhlprOriginalText;

            const clone = messageCell.cloneNode(true);
            messageCell.replaceWith(clone);
        });
    }
}

window.MessageService = MessageService;

