export const ChatAnalyzerMethods = {
    resetChatAnalysisCache(textarea) {
        if (textarea) {
            const key = this.getChatCacheKey(textarea);
            this.chatSignatureByKey.delete(key);
            this.activePunishmentBadgeByKey.delete(key);
            this.invalidateHistoryCache(this.getTicketScopeRoot(textarea));
            return;
        }
        this.chatSignatureByKey.clear();
        this.activePunishmentBadgeByKey.clear();
        this.invalidateHistoryCache();
        this.clearSuggestedMuteReason();
    },

    getRuleSeverity(rule) {
        return rule?.severity ?? rule?.duration ?? 0;
    },

    normalizeReason(reason) {
        return String(reason || '')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    },

    getColumnIndex(row, names, fallbackIndex) {
        const table = row.closest('table');
        const headers = Array.from(table?.querySelectorAll('thead th') || [])
            .map(th => th.innerText.trim().toLowerCase());
        const index = headers.findIndex(header => names.some(name => header.includes(name)));
        return index >= 0 ? index : fallbackIndex;
    },

    getChatRowData(row) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) return null;

        const timeIndex = this.getColumnIndex(row, ['дата', 'время'], 0);
        const messageIndex = this.getColumnIndex(row, ['сообщение', 'текст'], cells.length - 1);
        const authorIndex = this.getColumnIndex(row, ['игрок', 'ник', 'пользователь', 'автор'], -1);
        const chatTypeIndex = this.getColumnIndex(row, ['чат', 'тип'], Math.min(2, cells.length - 1));
        const messageCell = cells[messageIndex] || cells[cells.length - 1];

        return {
            timeText: cells[timeIndex]?.innerText?.trim() || '',
            authorText: authorIndex >= 0
                ? cells[authorIndex]?.innerText?.trim()
                : cells[chatTypeIndex]?.innerText?.trim() || 'Player',
            messageText: this.utils.extractMessageText(messageCell)
        };
    },

    parseDateCell(dateCell) {
        const spans = dateCell?.querySelectorAll('span');
        const dateText = spans && spans[0] ? spans[0].innerText?.trim() : null;
        const timeText = spans && spans[1] ? spans[1].innerText?.trim() : '00:00';
        if (!dateText) return null;

        const [d, m, y] = dateText.split('.').map(Number);
        const [hh = 0, mm = 0, ss = 0] = timeText.split(':').map(Number);
        if ([d, m, y, hh, mm, ss].some(Number.isNaN)) return null;

        return new Date(y, m - 1, d, hh, mm, ss);
    },

    getKeywordExceptions(keyword) {
        return this._ruleMatcher?.getExceptions(keyword) || [];
    },
};
