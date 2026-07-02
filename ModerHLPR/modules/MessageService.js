class MessageService {
    constructor({ document, utils, badgeService, complaintTriggers }) {
        this.document = document;
        this.utils = utils;
        this.badgeService = badgeService;
        this.complaintTriggers = complaintTriggers;
    }

    decorateMessageCell(messageCell) {
        if (messageCell.dataset.mhlprHoverReady === 'true') return;

        const textNode = this.utils.extractMainTextNode(messageCell);
        if (!textNode) return;

        const originalText = textNode.nodeValue;
        const isRussian = this.utils.detectLanguage(originalText);

        if (isRussian) {
            messageCell.dataset.mhlprHoverReady = 'true';
            return;
        }

        messageCell.dataset.mhlprHoverReady = 'true';
        messageCell.classList.add('moderhlpr-chat-message');

        const translateOnHover = async () => {
            if (messageCell.dataset.isTranslating === 'true') return;

            if (!messageCell.dataset.translatedText) {
                messageCell.dataset.isTranslating = 'true';
                messageCell.classList.add('moderhlpr-loading');

                const result = await this.badgeService.translateText(originalText, 'RU');

                messageCell.classList.remove('moderhlpr-loading');
                messageCell.dataset.isTranslating = 'false';

                if (result && result.translated) {
                    messageCell.dataset.translatedText = result.translated;
                }
            }

            if (messageCell.matches(':hover') && messageCell.dataset.translatedText) {
                textNode.nodeValue = messageCell.dataset.translatedText;
                messageCell.classList.add('moderhlpr-translated');
            }
        };

        const restore = () => {
            textNode.nodeValue = originalText;
            messageCell.classList.remove('moderhlpr-translated');
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
            if (cells.length >= 4) this.decorateMessageCell(cells[3]);
        });
    }

    highlightComplaintTriggers() {
        const rows = this.document.querySelectorAll('tr');

        rows.forEach(row => {
            if (row.querySelector('th') || row.dataset.triggersChecked) return;

            const cells = row.querySelectorAll('td');
            const reportCell = cells[5];

            if (reportCell) {
                let html = reportCell.innerHTML;
                let changed = false;

                this.complaintTriggers.forEach(trigger => {
                    const escapedTrigger = trigger.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    const regex = new RegExp(`(${escapedTrigger})`, 'gi');

                    if (regex.test(html)) {
                        html = html.replace(regex, '<span class="moderhlpr-complaint-trigger">$1</span>');
                        changed = true;
                    }
                });

                if (changed) {
                    reportCell.innerHTML = html;
                }

                row.dataset.triggersChecked = 'true';
            }
        });
    }

    highlightNewAccounts(row) {
        const match = row.innerText.match(/CYBERSHOKE:\s*(\d+)ч/i);
        if (match) {
            const hours = parseInt(match[1], 10);

            if (hours < 7) {
                const allDivs = row.querySelectorAll('div');
                allDivs.forEach(div => {
                    if (div.innerText.includes('CYBERSHOKE:') && !div.querySelector('.cs-hours-span')) {
                        div.innerHTML = div.innerHTML.replace(/(CYBERSHOKE:\s*)(\d+ч)/i, (match, p1, p2) => {
                            return `${p1}<span class="cs-hours-span moderhlpr-new-account-hours">${p2}</span>`;
                        });
                    }
                });
            }
        }
    }
}

window.MessageService = MessageService;
window.ModerHLPRMessageService = MessageService;

