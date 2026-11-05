import { markIoh } from './shared/dom.js';

export class MessageService {
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
        this.translationBindings = new Map();
    }

    decorateMessageCell(messageCell, originalText = null, nativeContext = null) {
        if (this.ticketService?.nativeData && originalText == null) return;
        const previous = this.translationBindings.get(messageCell);
        const sourceMatches = !nativeContext || previous?.nativeId === nativeContext.id
            && previous.source === originalText && previous.scope === nativeContext.scope && previous.ticketKey === nativeContext.ticketKey && previous.steamId === nativeContext.steamId;
        const reuseTranslated = sourceMatches && previous?.applied && previous.node?.nodeValue === previous.translated && messageCell.contains(previous.node);
        let textNode = reuseTranslated ? previous.node : this.utils.extractMainTextNode(messageCell);
        if (nativeContext && !reuseTranslated && textNode?.nodeValue.trim() !== originalText.trim()) textNode = null;
        if (nativeContext && !textNode) {
            const walker = this.document.createTreeWalker?.(messageCell, 4);
            while (walker) {
                const candidate = walker.nextNode(); if (!candidate) break;
                if (candidate.nodeValue.trim() === originalText.trim()) {textNode = candidate; break;}
            }
        }
        if (!textNode) {if (previous) this.releaseTranslation(messageCell, previous); return;}
        if (sourceMatches && previous?.node === textNode && (
            textNode.nodeValue === previous.original || (previous.applied && textNode.nodeValue === previous.translated)
        )) return;
        if (previous) this.releaseTranslation(messageCell, previous);
        const source = originalText ?? textNode.nodeValue;
        if (this.utils.detectLanguage(source) || !/\p{L}/u.test(source)) return;
        const binding = {node: textNode, original: textNode.nodeValue, source, translated: null, applied: false, pending: false,
            nativeId: nativeContext?.id, scope: nativeContext?.scope, ticketKey: nativeContext?.ticketKey, steamId: nativeContext?.steamId};
        this.translationBindings.set(messageCell, binding);
        messageCell.dataset.mhlprHoverReady = 'true';
        messageCell.dataset.mhlprOriginalText = binding.original;
        messageCell.classList.add('ioh-chat-message');
        const identityCurrent = () => !nativeContext || this.ticketService.getNativeTicket(nativeContext.scope)?.key === nativeContext.ticketKey
            && this.ticketService.getNativeTicket(nativeContext.scope)?.suspectId === nativeContext.steamId
            && this.ticketService.nativeData.history(nativeContext.steamId, 'chats')?.items.some(m => m.id === nativeContext.id && m.text === source);
        const current = () => this.translationBindings.get(messageCell) === binding
            && messageCell.isConnected && messageCell.contains(textNode)
            && this.settings.features?.translateText !== false && identityCurrent();
        binding.enter = async () => {
            if (textNode.nodeValue !== binding.original && !(binding.applied && textNode.nodeValue === binding.translated)) {
                if (nativeContext) {this.releaseTranslation(messageCell, binding); return;}
                this.decorateMessageCell(messageCell);
                return this.translationBindings.get(messageCell)?.enter();
            }
            if (binding.pending || !current()) return;
            try {
                if (!binding.translated) {
                    binding.pending = true;
                    messageCell.classList.add('ioh-loading');
                    const result = await this.badgeService.translateText(binding.source, 'RU');
                    if (!current() || textNode.nodeValue !== binding.original) return;
                    binding.translated = result?.translated || null;
                }
                if (!current() || !messageCell.matches(':hover') || !binding.translated) return;
                textNode.nodeValue = binding.translated;
                messageCell.dataset.translatedText = binding.translated;
                binding.applied = true;
                messageCell.classList.add('ioh-translated');
            } catch {
                // A failed translator must not change the message or leave a loading state.
            } finally {
                binding.pending = false;
                if (this.translationBindings.get(messageCell) === binding) messageCell.classList.remove('ioh-loading');
            }
        };
        binding.leave = () => {
            if (binding.applied && textNode.nodeValue === binding.translated && identityCurrent()) textNode.nodeValue = binding.original;
            binding.applied = false;
            messageCell.classList.remove('ioh-translated');
        };
        messageCell.addEventListener('mouseenter', binding.enter);
        messageCell.addEventListener('mouseleave', binding.leave);
    }

    releaseTranslation(cell, binding) {
        binding.leave();
        cell.removeEventListener('mouseenter', binding.enter);
        cell.removeEventListener('mouseleave', binding.leave);
        cell.classList.remove('ioh-chat-message', 'ioh-loading', 'ioh-translated');
        for (const key of ['mhlprHoverReady', 'mhlprOriginalText', 'translatedText', 'isTranslating']) delete cell.dataset[key];
        this.translationBindings.delete(cell);
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
        for (const [cell, binding] of this.translationBindings) {
            if (!cell.isConnected) this.releaseTranslation(cell, binding);
        }
        if (this.ticketService?.nativeData) {
            for (const textarea of this.document.querySelectorAll('textarea[placeholder*="Опишите детали закрытия"]')) {
                const scope = this.ticketService.getTicketScopeRoot(textarea);
                const t = this.ticketService.getNativeTicket(scope); if (!t) continue;
                const messages = this.ticketService.nativeData.history(t.suspectId, 'chats')?.items || [];
                for (const [id, row] of this.ticketService.bindNativeMessageRows(scope)) {
                    const message = messages.find(m => m.id === id), cell = row.querySelector('td:last-child');
                    if (cell && message) this.decorateNativeMessageCell(cell, message, scope);
                }
            }
            return;
        }
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

    decorateNativeMessageCell(cell, message, scope) {
        const ticket = this.ticketService.getNativeTicket(scope);
        if (!ticket) return;
        this.decorateMessageCell(cell, message.text, {id: message.id, scope, ticketKey: ticket.key, steamId: ticket.suspectId});
    }

    highlightComplaintTriggers(targetRow) {
        if (this.ticketService?.nativeData) {
            for (const row of targetRow ? [targetRow] : this._getComplaintQueueRows()) {
                const t = this.ticketService.getNativeRowTicket(row); if (!t || t.message == null) continue;
                const cell = row.querySelectorAll('td')[5];
                const node = [...(cell?.querySelectorAll('span') || [])].find(n => n.textContent === t.message);
                if (!node || node.dataset.iohNativeMessage === t.message) continue;
                node.dataset.iohNativeMessage = t.message;
                const triggers = (this.settings.reasonTriggers || []).filter(Boolean).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                if (!triggers.length) continue;
                const regex = new RegExp(triggers.join('|'), 'gi');
                const fragment = this.document.createDocumentFragment(); let pos = 0;
                for (const match of t.message.matchAll(regex)) {
                    fragment.append(this.document.createTextNode(t.message.slice(pos, match.index)));
                    const span = this.document.createElement('span'); markIoh(span); span.className = 'ioh-complaint-trigger'; span.textContent = match[0]; fragment.append(span);
                    pos = match.index + match[0].length;
                }
                fragment.append(this.document.createTextNode(t.message.slice(pos))); node.replaceChildren(fragment);
            }
            return;
        }
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
                    html = html.replace(regex, '<span class="ioh-complaint-trigger" data-ioh="1">$1</span>');
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
        this.document.querySelectorAll('[data-ioh-native-message]').forEach(n => delete n.dataset.iohNativeMessage);
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
        markIoh(span);
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

                return `${prefix}<span class="cs-hours-span ioh-new-account-hours" data-ioh="1">${hoursText}</span>`;
            });

            if (newHtml !== html) {
                div.innerHTML = newHtml;
            }
        });
    }

    highlightNewAccounts(row) {
        if (this.ticketService?.nativeData) {
            const t = this.ticketService.getNativeRowTicket(row);
            if (!t || t.playtime == null) return;
            this.releaseHoursWatch(row);
            const hours = Math.round(t.playtime / 3600);
            if (hours > this.settings.newAccountHours) this._clearRowHoursHighlight(row);
            else { this._setRowHoursState(row, hours); this._applyRowHoursHighlight(row); }
            return;
        }
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

        if (hours > this.settings.newAccountHours) {
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

    highlightHighHs(row) {
        if (!row?.querySelectorAll) return;
        if (this.ticketService?.nativeData) {
            const t = this.ticketService.getNativeRowTicket(row);
            const serverCell = row.querySelector('a[href^="steam://connect/"]')?.closest('td') || row.querySelectorAll('td')[1];
            const isHeadshotsOnly = /HSDM/i.test([t?.mode, t?.category, serverCell?.textContent].filter(Boolean).join(' '));
            const hs = t?.kills > 0 && t.headshots != null ? Math.round(t.headshots / t.kills * 100) : NaN;
            const configured = this.settings.headshotPercentage;
            const threshold = configured !== null && configured !== '' && Number.isFinite(Number(configured))
                ? Math.min(100, Math.max(0, Number(configured))) : 95;
            row.querySelectorAll('span').forEach(span => {
                const highlight = /^\s*HS:/.test(span.textContent || '') && !isHeadshotsOnly && hs >= threshold && hs <= 100;
                if (span.classList.contains('ioh-high-hs') !== highlight) span.classList.toggle('ioh-high-hs', highlight);
            });
            return;
        }

        const serverCell = row.querySelector('a[href^="steam://connect/"]')?.closest('td')
            || row.querySelectorAll('td')[1];
        const isHeadshotsOnly = /HSDM/i.test(serverCell?.textContent || '');
        const configured = this.settings.headshotPercentage;
        const threshold = configured !== null && configured !== '' && Number.isFinite(Number(configured))
            ? Math.min(100, Math.max(0, Number(configured)))
            : 95;

        // Reuse the site's HS span so React can keep updating its text.
        // Do not mark site-owned nodes as IOH: their mutations must still be observed.
        row.querySelectorAll('span').forEach(span => {
            const match = (span.textContent || '').match(/^\s*HS:\s*(\d+(?:[.,]\d+)?)\s*%\s*$/i);
            const value = match ? Number(match[1].replace(',', '.')) : NaN;
            const highlight = !isHeadshotsOnly && value >= threshold && value <= 100;
            if (span.classList.contains('ioh-high-hs') !== highlight) {
                span.classList.toggle('ioh-high-hs', highlight);
            }
        });
    }

    clearHighHsHighlights() {
        this.document.querySelectorAll('.ioh-high-hs').forEach(span => {
            span.classList.remove('ioh-high-hs');
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
        for (const [cell, binding] of this.translationBindings) this.releaseTranslation(cell, binding);
    }
}

