class Utils {
    constructor({ document }) {
        this.document = document;
    }

    escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, match => {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return map[match];
        });
    }

    detectLanguage(text) {
        const russianRegex = /[а-яёА-ЯЁ]/;
        return russianRegex.test(text);
    }

    isMessageWithin24Hours(messageTimestampText) {
        if (!messageTimestampText) return true;
        try {
            const parts = messageTimestampText.trim().split(/\s+/);
            if (parts.length < 2) return true;
            const dateParts = parts[0].split('.');
            const timeParts = parts[1].split(':');
            if (dateParts.length === 3 && timeParts.length === 3) {
                const messageDate = new Date(
                    parseInt(dateParts[2], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[0], 10),
                    parseInt(timeParts[0], 10), parseInt(timeParts[1], 10), parseInt(timeParts[2], 10)
                );
                return ((new Date() - messageDate) / (1000 * 60 * 60)) <= 24;
            }
            return true;
        } catch (e) { return true; }
    }

    extractMainTextNode(messageCell) {
        for (const node of messageCell.childNodes) {
            if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0) {
                return node;
            }
        }
        return null;
    }

    extractMessageText(messageCell) {
        return messageCell.textContent.trim();
    }

    formatDuration(minutes) {
        if (minutes >= 1440) {
            const days = Math.round(minutes / 1440);
            if (days === 1) return "1 день";
            if (days >= 2 && days <= 4) return `${days} дня`;
            return `${days} дней`;
        }
        if (minutes >= 60) {
            const hours = Math.round(minutes / 60);
            if (hours === 1) return "1 час";
            if (hours >= 2 && hours <= 4) return `${hours} часа`;
            return `${hours} часов`;
        }
        return `${minutes} мин.`;
    }

    parseDurationToMinutes(durationStr) {
        if (!durationStr) return 0;
        const text = durationStr.toLowerCase().trim();
        let total = 0;
        const unitRegex = /(\d+)\s*(день|дня|дней|д\.|час|часа|часов|ч\.|мин|минут|м\.)/gi;
        let match;

        while ((match = unitRegex.exec(text)) !== null) {
            const value = parseInt(match[1], 10);
            const unit = match[2];
            if (unit.startsWith('д')) total += value * 24 * 60;
            else if (unit.startsWith('ч') || unit.startsWith('час')) total += value * 60;
            else total += value;
        }

        if (total > 0) return total;
        return parseInt(text.match(/\d+/)?.[0] || 0, 10);
    }

    parseTimeToMs(timeStr) {
        if (!timeStr) return null;
        const parts = timeStr.trim().split(/\s+/);
        const timePart = parts.length > 1 ? parts[1] : parts[0];
        const t = timePart.split(':');
        if (t.length >= 2) {
            const d = new Date();
            if (parts.length > 1 && parts[0].includes('.')) {
                const dp = parts[0].split('.');
                return new Date(parseInt(dp[2], 10), parseInt(dp[1], 10) - 1, parseInt(dp[0], 10), parseInt(t[0], 10), parseInt(t[1], 10), t[2] ? parseInt(t[2], 10) : 0).getTime();
            }
            return new Date(d.getFullYear(), d.getMonth(), d.getDate(), parseInt(t[0], 10), parseInt(t[1], 10), t[2] ? parseInt(t[2], 10) : 0).getTime();
        }
        return null;
    }

    containsTrigger(text, trigger, exceptions = []) {
        let sanitizedText = text;

        // Сначала удаляем все исключения из проверяемого текста
        exceptions.forEach(ex => {
            const escapedEx = ex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            sanitizedText = sanitizedText.replace(new RegExp(escapedEx, 'giu'), '');
        });

        // Теперь ищем триггер в очищенном тексте
        const escapedTrigger = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(escapedTrigger, "iu").test(sanitizedText);
    }

    parseComplaintCell(container) {
        if (!container) {
            return {category: '', playerText: ''};
        }

        const wrapper = container.querySelector(':scope > div') || container;
        const categoryEl = wrapper.querySelector(':scope > div');
        const playerEl = wrapper.querySelector(':scope > span');

        if (categoryEl) {
            return {
                category: categoryEl.textContent?.trim() || '',
                playerText: playerEl?.textContent?.trim() || ''
            };
        }

        const directSpan = wrapper.querySelector(':scope > span');
        if (directSpan) {
            return {
                category: directSpan.textContent?.trim() || '',
                playerText: ''
            };
        }

        return {category: '', playerText: ''};
    }
}

window.Utils = Utils;

