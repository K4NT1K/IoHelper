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
        const node = this.extractMainTextNode(messageCell);
        return node ? node.nodeValue.trim() : messageCell.innerText.trim();
    }

    formatDuration(minutes) {
        if (minutes >= 4320) return "3 дня";
        if (minutes >= 1440) return "1 день";
        if (minutes >= 720) return "12 часов";
        if (minutes >= 360) return "6 часов";
        return `${minutes} мин.`;
    }

    parseDurationToMinutes(durationStr) {
        if (!durationStr) return 0;
        const text = durationStr.toLowerCase().trim();
        const num = parseInt(text.match(/\d+/)?.[0] || 0, 10);
        if (text.includes('день') || text.includes('дня') || text.includes('д.')) return num * 24 * 60;
        if (text.includes('час') || text.includes('ч.')) return num * 60;
        if (text.includes('мин')) return num;
        return num;
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
}

window.Utils = Utils;
window.ModerHLPRUtils = Utils;

