export const ActivePunishmentMethods = {
    LIFTED_STATUS_RGB: '21, 141, 183',
    ACTIVE_STATUS_RGBS: ['234, 179, 8', '250, 204, 21', '255, 193, 7'],
    DURATION_TEXT_RE: /(\d+)\s*(день|дня|дней|д\.|час|часа|часов|ч\.|мин|минут|м\.)/i,

    findActivePunishmentRow(historyBlock) {
        if (!historyBlock) {
            return null;
        }

        const punishmentRows = historyBlock.querySelectorAll('tbody tr');

        for (const punishmentRow of punishmentRows) {
            const cells = punishmentRow.querySelectorAll('td');
            if (cells.length < 5) {
                continue;
            }

            if (this.isLiftedPunishmentRow(punishmentRow, cells[0])) {
                continue;
            }

            if (this.hasActivePunishmentIndicator(punishmentRow, cells[0])) {
                return punishmentRow;
            }

            const dateIndex = this.getColumnIndex(punishmentRow, ['дата'], 1);
            const durationIndex = this.getColumnIndex(punishmentRow, ['длительность'], cells.length - 1);
            const dateCell = cells[dateIndex];
            const spans = dateCell?.querySelectorAll('span') || [];
            const dateText = spans[0]?.innerText?.trim();
            const timeText = spans[1]?.innerText?.trim();
            const durationText = cells[durationIndex]?.innerText?.trim();

            if (!this.isRealDurationText(durationText) || !dateText || !timeText) {
                continue;
            }

            const [d, m, y] = dateText.split('.').map(Number);
            const [hh, mm] = timeText.split(':').map(Number);

            if (!isNaN(d) && !isNaN(m) && !isNaN(y) && !isNaN(hh) && !isNaN(mm)) {
                const punishmentStart = new Date(y, m - 1, d, hh, mm, 0);
                const durationMins = this.utils.parseDurationToMinutes(durationText);

                if (durationMins > 0) {
                    const punishmentEnd = new Date(punishmentStart.getTime() + durationMins * 60 * 1000);
                    if (new Date() < punishmentEnd) {
                        return punishmentRow;
                    }
                }
            }
        }

        return null;
    },

    getPunishmentStatusIndicator(row, firstCell) {
        return firstCell?.querySelector('span') || firstCell || null;
    },

    getPunishmentStatusMarkup(row, firstCell) {
        const indicator = this.getPunishmentStatusIndicator(row, firstCell);
        return `${row?.innerHTML || ''} ${indicator?.outerHTML || ''}`;
    },

    matchesRgb(value, rgb) {
        return (value || '').replace(/\s+/g, '').includes(rgb.replace(/\s+/g, ''));
    },

    isLiftedPunishmentRow(row, firstCell) {
        const markup = this.getPunishmentStatusMarkup(row, firstCell);
        if (/status-lifted|--color-status-lifted|color-status-lifted|#158db7/i.test(markup)) {
            return true;
        }

        const indicator = this.getPunishmentStatusIndicator(row, firstCell);
        if (!indicator || typeof window.getComputedStyle !== 'function') {
            return false;
        }

        const style = window.getComputedStyle(indicator);
        const colorSources = [style.backgroundColor, style.color, style.borderColor];
        return colorSources.some(value => this.matchesRgb(value, this.LIFTED_STATUS_RGB));
    },

    hasActivePunishmentIndicator(row, firstCell) {
        const markup = this.getPunishmentStatusMarkup(row, firstCell);
        if (/status-lifted|--color-status-lifted|color-status-lifted/i.test(markup)) {
            return false;
        }

        const hasActiveVar = markup.includes('--color-status-active')
            || /status-active/i.test(markup);
        const indicator = this.getPunishmentStatusIndicator(row, firstCell);
        if (!indicator || typeof window.getComputedStyle !== 'function') {
            return hasActiveVar;
        }

        const computedBg = window.getComputedStyle(indicator).backgroundColor || '';
        const isYellowBg = this.ACTIVE_STATUS_RGBS.some(rgb => this.matchesRgb(computedBg, rgb));
        return hasActiveVar || isYellowBg;
    },

    isRealDurationText(durationText) {
        return this.DURATION_TEXT_RE.test(String(durationText || ''));
    },

    hasActiveMute(muteHistoryBlock) {
        return Boolean(this.findActivePunishmentRow(muteHistoryBlock));
    },

    hasActiveBan(banHistoryBlock) {
        return Boolean(this.findActivePunishmentRow(banHistoryBlock));
    },

    buildPunishmentPreviewPanel(activeRow) {
        if (!activeRow) {
            return '';
        }

        return `<span class="ioh-punishment-preview-tooltip__panel"><span class="ioh-punishment-preview-tooltip__panel-inner"><table><tbody>${activeRow.outerHTML}</tbody></table></span></span>`;
    },

    getPunishmentRowFingerprint(row) {
        return (row?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    },

    shouldSkipActivePunishmentBadge(type, row, textarea) {
        const key = this.getChatCacheKey(textarea);
        const fingerprint = this.getPunishmentRowFingerprint(row);
        const prev = this.activePunishmentBadgeByKey.get(key);
        if (prev?.type === type && prev?.fingerprint === fingerprint) {
            return true;
        }
        this.activePunishmentBadgeByKey.set(key, {type, fingerprint});
        return false;
    },

    buildActivePunishmentBadge(icon, message, activeRow) {
        const preview = this.buildPunishmentPreviewPanel(activeRow);
        return `<div class="ioh-badge-row ioh-punishment-preview-tooltip" tabindex="0"><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span>${preview}</div>`;
    },
};
