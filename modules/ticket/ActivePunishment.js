import {isIohNode} from '../shared/dom.js';

export const ActivePunishmentMethods = {
    getPunishmentPreviewBlock(record, scope) {
        if (!(record?.nativePunishment || record?.nativeStatus) || !scope) return null;
        const label = record.kind === 'bans' ? 'История Банов' : record.kind === 'warnings' ? 'История предупреждений' : 'История Мутов';
        return this.getBlockByHeaderScoped(label, scope)
            || record.kind === 'warnings' && this.getBlockByHeaderScoped('История Предупреждений', scope)
            || this.getBlockByHeaderScoped(label.toLowerCase().replace('история', 'История'), scope);
    },

    findPunishmentPreviewRow(record, scope) {
        const block = this.getPunishmentPreviewBlock(record, scope);
        if (!block) return null;
        const rows = [...block.querySelectorAll('tbody tr')].filter(r => !isIohNode(r));
        const byId = rows.filter(r => [r.dataset?.bid, r.dataset?.id, r.getAttribute?.('data-punishment-id')].some(id => id && String(id) === record.id));
        if (byId.length === 1) return byId[0];
        const candidates = rows.filter(row => {
            const cells = row.querySelectorAll('td');
            const date = this.parseDateCell(cells[this.getColumnIndex(row, ['дата'], 1)]);
            if (!date || !Number.isFinite(record.created) || Math.abs(date.getTime() - record.created) >= 60000) return false;
            const text = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
            const reasonCell = cells[this.getColumnIndex(row, ['причина', 'информация'], 2)];
            const reason = reasonCell?.firstElementChild?.firstElementChild?.textContent || reasonCell?.textContent;
            return record.kind === 'warnings' ? text.includes(record.reason.replace(/\s+/g, ' ').trim()) : this.normalizeReason(reason) === this.normalizeReason(record.reason);
        });
        if (candidates.length === 1) return candidates[0];
        // The native active flag can arrive without the full history record, or
        // with a differently formatted reason/date. DOM is only the preview here.
        if (record.kind === 'warnings') return null;
        const active = rows.filter(row => this.findActivePunishmentRow({querySelectorAll: () => [row]}) === row);
        return active.length === 1 ? active[0] : null;
    },

    syncActivePunishmentPreview(textarea, record, icon, message) {
        if (!this.nativeData || !(record?.nativePunishment || record?.nativeStatus)) return;
        const scope = this.getTicketScopeRoot(textarea), ticket = this.getNativeTicket(scope);
        if (!ticket) return;
        this._activePreviewSessions ||= new Map();
        const identity = `${ticket.key}:${ticket.suspectId}:${record.kind}:${record.id}:${record.created}`;
        const previous = this._activePreviewSessions.get(textarea);
        if (previous?.identity === identity) { previous.refresh(); return; }
        this.releaseActivePunishmentPreview(textarea);
        const session = {identity, textarea, scope, record, observer: null, html: null};
        const refresh = () => {
            const current = this.getNativeTicket(scope);
            if (!this.document.contains(textarea) || this.getTicketScopeRoot(textarea) !== scope
                || current?.key !== ticket.key || current?.suspectId !== ticket.suspectId) return this.releaseActivePunishmentPreview(textarea);
            if (!this.isVisibleTicketTextarea(textarea)) return;
            const badge = this.document.getElementById('helper-suggest-badge');
            if (!badge || badge.parentNode !== textarea.parentNode || !badge.textContent.includes(message.trim())) return;
            const html = this.buildActivePunishmentBadge(icon, message, record, textarea);
            const table = this.getPunishmentPreviewBlock(record, scope)?.querySelector('table');
            if (table && table !== session.table) {
                session.table = table;
                session.observer.observe(table, {childList: true, subtree: true, characterData: true,
                    attributes: true, attributeFilter: ['class', 'style', 'data-punishment-id', 'data-id', 'data-bid']});
            }
            if (session.html === html) return;
            session.html = html;
            this.badgeService.updateInfoBadge('helper-suggest-badge', record.kind === 'bans' ? 'accent' : 'warning', html, textarea);
        };
        session.refresh = refresh;
        session.observer = new MutationObserver(mutations => {
            if (!mutations.every(m => isIohNode(m.target))) refresh();
        });
        session.observer.observe(scope, {childList: true, subtree: true});
        this._activePreviewSessions.set(textarea, session);
        refresh();
    },

    releaseActivePunishmentPreview(textarea) {
        this._activePreviewSessions?.get(textarea)?.observer.disconnect();
        this._activePreviewSessions?.delete(textarea);
    },

    stopActivePunishmentPreviews() {
        for (const textarea of this._activePreviewSessions?.keys() || []) this.releaseActivePunishmentPreview(textarea);
    },
    LIFTED_STATUS_RGB: '21, 141, 183',
    ACTIVE_STATUS_RGBS: ['234, 179, 8', '250, 204, 21', '255, 193, 7'],
    DURATION_TEXT_RE: /(\d+)\s*(день|дня|дней|д\.|час|часа|часов|ч\.|мин|минут|м\.)/i,

    findActivePunishmentRow(historyBlock) {
        if (historyBlock?.nativeHistory) return historyBlock.active;
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
            const dateText = spans[0]?.textContent?.trim() || spans[0]?.innerText?.trim();
            const timeText = spans[1]?.textContent?.trim() || spans[1]?.innerText?.trim();
            const durationText = cells[durationIndex]?.textContent?.trim() || cells[durationIndex]?.innerText?.trim();

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

    buildPunishmentPreviewPanel(activeRow, scope = null) {
        if (activeRow?.nativePunishment || activeRow?.nativeStatus) {
            activeRow = this.findPunishmentPreviewRow(activeRow, scope);
        }
        if (!activeRow) {
            return '';
        }

        return `<span class="ioh-punishment-preview-tooltip__panel"><span class="ioh-punishment-preview-tooltip__panel-inner"><table><tbody>${activeRow.outerHTML}</tbody></table></span></span>`;
    },

    getPunishmentRowFingerprint(row) {
        if (row?.nativeStatus) return JSON.stringify(row);
        if (row?.nativePunishment) return JSON.stringify(row);
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

    buildActivePunishmentBadge(icon, message, activeRow, textarea = null) {
        if (!activeRow) {
            return `<div class="ioh-badge-row"><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span></div>`;
        }
        const preview = this.buildPunishmentPreviewPanel(activeRow, textarea && this.getTicketScopeRoot?.(textarea));
        if (!preview && activeRow.kind === 'warnings') return `<div class="ioh-badge-row ioh-warning-text-tooltip" data-full-msg="${this.utils.escapeHtml(activeRow.reason)}" title=""><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span></div>`;
        if (!preview) return `<div class="ioh-badge-row"><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span></div>`;
        return `<div class="ioh-badge-row ioh-punishment-preview-tooltip" tabindex="0"><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span>${preview}</div>`;
    },
};
