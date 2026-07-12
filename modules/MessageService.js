class MessageService {
    constructor({ document, utils, badgeService, settings }) {
        this.document = document;
        this.utils = utils;
        this.badgeService = badgeService;
        this.settings = settings;
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

    processChatMessages() {
        const chatHistoryBlock = Array.from(this.document.querySelectorAll('div, .card, .block')).find(el => el.innerText && el.innerText.includes('История Чата') && !el.innerText.includes('История Тикетов'));
        if (!chatHistoryBlock) return;
        const rows = Array.from(chatHistoryBlock.querySelectorAll('tbody tr, tr')).filter(row => row.querySelector('td'));
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) this.decorateMessageCell(cells[cells.length - 1]);
        });
    }

    highlightComplaintTriggers(targetRow) {
        const rows = targetRow ? [targetRow] : this.document.querySelectorAll('tr');

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

    highlightNewAccounts(row) {
        if (row.querySelector('.ioh-new-account-hours')) {
            return;
        }

        const match = row.innerText.match(/CYBERSHOKE:\s*(\d+)ч/i);
        if (match) {
            const hours = parseInt(match[1], 10);

            if (hours < this.settings.newAccountHours) {
                const allDivs = row.querySelectorAll('div');
                allDivs.forEach(div => {
                    if (div.innerText.includes('CYBERSHOKE:') && !div.querySelector('.cs-hours-span')) {
                        div.innerHTML = div.innerHTML.replace(/(CYBERSHOKE:\s*)(\d+ч)/i, (match, p1, p2) => {
                            return `${p1}<span class="cs-hours-span ioh-new-account-hours">${p2}</span>`;
                        });
                    }
                });
            }
        }
    }

    clearNewAccountHighlights() {
        this.document.querySelectorAll('.cs-hours-span.ioh-new-account-hours').forEach(span => {
            span.replaceWith(this.document.createTextNode(span.textContent || ''));
        });
    }

    reapplyNewAccountHighlights() {
        this.clearNewAccountHighlights();
        this.document.querySelectorAll('table tbody tr').forEach(row => {
            this.highlightNewAccounts(row);
        });
    }

    highlightDuplicateServerIps(targetRow) {
        const rows = targetRow
            ? [targetRow]
            : Array.from(this.document.querySelectorAll('tr'));

        const serverMap = new Map();

        this.document.querySelectorAll('tr').forEach(row => {
            const serverLink = row.querySelector('a[href^="steam://connect/"]');
            if (!serverLink) return;

            const serverIp = serverLink.textContent.trim();

            if (!serverMap.has(serverIp)) {
                serverMap.set(serverIp, []);
            }

            serverMap.get(serverIp).push(row);
        });

        rows.forEach(row => {
            if (row.querySelector('th') || row.dataset.duplicateServerChecked) {
                return;
            }

            const serverLink = row.querySelector('a[href^="steam://connect/"]');

            if (serverLink) {
                const serverIp = serverLink.textContent.trim();
                const duplicates = serverMap.get(serverIp);

                if (duplicates && duplicates.length > 1) {
                    duplicates.forEach(duplicateRow => {
                        duplicateRow.classList.add(
                            'ioh-duplicate-server'
                        );

                        duplicateRow.dataset.duplicateServerChecked = 'true';
                    });
                } else {
                    row.dataset.duplicateServerChecked = 'true';
                }
            }
        });
    }

    clearDuplicateServerHighlights() {
        this.document
            .querySelectorAll('.ioh-duplicate-server')
            .forEach(row => {
                row.classList.remove('ioh-duplicate-server');
            });

        this.document
            .querySelectorAll('tr[data-duplicate-server-checked]')
            .forEach(row => {
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

