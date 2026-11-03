import {isIohNode} from './shared/dom.js';

export class PunishmentService {
    constructor({ document, ticketService = null }) {
        this.document = document;
        this.ticketService = ticketService;
        this.enabled = true;
        this.debounceId = null;
        this.formBindings = new Map();
        this.punishmentBindings = new Map();
        this.punishmentConfirmations = new Set();
    }

    init() {
        this.enabled = true;
        this.scanDialogs();
    }

    teardown() {
        this.enabled = false;
        clearTimeout(this.debounceId);
        this.debounceId = null;
        for (const cleanup of this.formBindings.values()) cleanup();
        this.formBindings.clear();
        this.stopPunishmentConfirmations();
        for (const binding of this.punishmentBindings.values()) binding.cleanup();
        this.punishmentBindings.clear();
    }

    scheduleScan() {
        clearTimeout(this.debounceId);
        if (!this.enabled) return;
        this.debounceId = setTimeout(() => {
            this.debounceId = null;
            this.scanDialogs();
        }, 150);
    }

    isRelevantNode(node) {
        return Boolean(node?.nodeType === 1 && (
            node.matches?.('[role="dialog"], #mute-reason, #mute-steamid64, #ban-steamid64')
            || node.querySelector?.('#mute-reason, #mute-steamid64, #ban-steamid64')
        ));
    }

    scanDialogs() {
        if (!this.enabled) return;
        if (!this.isPunishmentConfirmationEnabled()) this.stopPunishmentConfirmations();
        for (const [dialog, binding] of this.punishmentBindings) {
            if (!dialog.isConnected || dialog.getAttribute?.('data-state') === 'closed') {
                binding.cleanup();
                this.punishmentBindings.delete(dialog);
                if (binding.submitted) this.startPunishmentConfirmation(binding.submitted);
            }
        }
        for (const [reasonSelect, cleanup] of this.formBindings) {
            if (!reasonSelect.isConnected) {
                cleanup();
                this.formBindings.delete(reasonSelect);
            }
        }
        this.document.querySelectorAll('[role="dialog"]').forEach(dialog => {
            this.bindPunishmentConfirmation(dialog);
            const reasonSelect = dialog.querySelector('#mute-reason');
            if (reasonSelect) this.bindMuteForm(reasonSelect, dialog);
        });
    }

    isPunishmentConfirmationEnabled() {
        return this.enabled && this.ticketService?.settings?.features?.autoSelectCloseReason === true;
    }

    getPunishmentConfirmationOrigin(scope, steamId) {
        const ticket = this.ticketService;
        if (!scope || !steamId || !this.document.contains(scope)
            || !ticket.isOpenComplaintScope(scope)
            || !ticket.scopeHasInProgressStatus(scope, {includeActivePanel: false})
            || ticket.getOffenderSteamIdForScope(scope) !== steamId) return null;
        const textarea = scope.querySelector?.('textarea[placeholder*="Опишите детали закрытия"]');
        if (!textarea || textarea.readOnly || textarea.disabled) return null;
        if (ticket.getCloseReasonContext && ticket.isCloseReasonContextEditable) {
            const context = ticket.getCloseReasonContext(textarea);
            if (!context || !ticket.isCloseReasonContextEditable(context)) return null;
        }
        // A scope can be reused by the SPA for another complaint, even for the same player.
        const ticketId = ticket.extractTicketIdFromComplaintScope(scope);
        if (!ticketId) return null;
        return {scope, steamId, ticketId};
    }

    isPunishmentConfirmationCurrent(context) {
        if (!this.isPunishmentConfirmationEnabled() || context.cancelled) return false;
        const origin = this.getPunishmentConfirmationOrigin(context.scope, context.steamId);
        return Boolean(origin && origin.ticketId === context.ticketId);
    }

    bindPunishmentConfirmation(dialog) {
        if (!this.isPunishmentConfirmationEnabled() || this.punishmentBindings.has(dialog)
            || dialog.getAttribute?.('data-state') === 'closed') return;
        const form = dialog.querySelector('form');
        if (!form) return;
        const banInput = dialog.querySelector('#ban-steamid64');
        const input = banInput || dialog.querySelector('#mute-steamid64');
        if (!input) return;
        const type = banInput ? 'ban' : 'mute';
        const ticket = this.ticketService;
        // Opening management can temporarily replace the active complaint and clear
        // _lastPunishmentScope. The bridge preserves its origin on this exact dialog.
        const captured = ticket._closeReasonPunishmentOrigins?.get(dialog)
            || ticket._closeReasonPunishmentOrigin;
        ticket._closeReasonPunishmentOrigins?.delete(dialog);
        const initialScope = captured?.scope || ticket.getActivePunishmentScope();
        let initialOrigin = this.getPunishmentConfirmationOrigin(initialScope,
            captured?.steamId || (initialScope && ticket.getOffenderSteamIdForScope(initialScope)));
        if (captured && (captured.type !== type || captured.ticketId !== initialOrigin?.ticketId)) initialOrigin = null;
        const binding = {submitted: null, cleanup: null};
        const onSubmit = () => {
            if (!this.isPunishmentConfirmationEnabled() || !initialOrigin) return;
            const steamId = input.value.trim();
            const origin = this.getPunishmentConfirmationOrigin(initialOrigin.scope, steamId);
            // Keep the complaint from opening this form; a later tab cannot take ownership.
            binding.submitted = origin && origin.steamId === initialOrigin.steamId
                && origin.ticketId === initialOrigin.ticketId
                ? {...origin, type, cancelled: false, timer: null} : null;
        };
        form.addEventListener('submit', onSubmit, true);
        binding.cleanup = () => {
            form.removeEventListener('submit', onSubmit, true);
            // The bridge may store the token after an early binding already consumed it.
            ticket._closeReasonPunishmentOrigins?.delete(dialog);
        };
        this.punishmentBindings.set(dialog, binding);
    }

    stopPunishmentConfirmations() {
        for (const context of this.punishmentConfirmations) {
            context.cancelled = true;
            clearTimeout(context.timer);
        }
        this.punishmentConfirmations.clear();
        for (const binding of this.punishmentBindings.values()) binding.submitted = null;
    }

    startPunishmentConfirmation(context) {
        if (!this.isPunishmentConfirmationCurrent(context)) return;
        this.punishmentConfirmations.add(context);
        const delays = [350, 1000, 2000];
        let attempt = 0;
        const finish = () => {
            clearTimeout(context.timer);
            context.timer = null;
            this.punishmentConfirmations.delete(context);
        };
        const schedule = delay => {
            if (!this.isPunishmentConfirmationCurrent(context)) {
                finish();
                return;
            }
            const cooldown = Math.max(0, (this.ticketService.globalServerCooldown || 0) - Date.now());
            context.timer = setTimeout(check, Math.max(delay, cooldown));
        };
        const check = async () => {
            context.timer = null;
            if (!this.isPunishmentConfirmationCurrent(context)) return finish();
            // Another tracker request may have extended cooldown while this timer waited.
            const cooldown = (this.ticketService.globalServerCooldown || 0) - Date.now();
            if (cooldown > 0) return schedule(cooldown);
            attempt += 1;
            try {
                // Bypass the short user-data cache; the shared fetch still deduplicates inflight reads.
                const data = await this.ticketService.fetchParsedUserData(context.steamId);
                if (!this.isPunishmentConfirmationCurrent(context)) return finish();
                if (context.type === 'ban' ? data?.isBanned : data?.isMuted) {
                    this.ticketService.onCloseReasonPunishmentData(context.steamId, {
                        ...data, scope: context.scope, ticketId: context.ticketId
                    });
                    this.ticketService.syncCloseReasonSelection();
                    return finish();
                }
            } catch {
                // A failed read or submission is never evidence of punishment.
            }
            if (attempt >= delays.length || !this.isPunishmentConfirmationCurrent(context)) return finish();
            schedule(delays[attempt]);
        };
        schedule(delays[0]);
    }

    bindMuteForm(reasonSelect, dialog) {
        if (this.formBindings.has(reasonSelect)) return;
        const steamInput = dialog.querySelector('#mute-steamid64');
        let lastSteamId = steamInput?.value?.trim() || '';
        let manualReason = false;
        let applyingReason = false;
        const applyReason = () => {
            if (!this.enabled || manualReason || !reasonSelect.isConnected || !dialog.isConnected) return;
            applyingReason = true;
            try {
                this.applySuggestedMuteReason(reasonSelect, dialog);
            } finally {
                applyingReason = false;
            }
        };
        const onReasonChange = () => {
            if (!applyingReason) manualReason = true;
        };
        const onDialogClick = event => {
            if (this.isSiteRecidivismAction(event.target, dialog)) manualReason = true;
        };
        const onSteamIdChange = () => {
            const steamId = steamInput.value.trim();
            if (steamId === lastSteamId) return;
            lastSteamId = steamId;
            manualReason = false;
            applyReason();
        };
        // History arrives asynchronously and the site may replace its initial reason.
        // Reconcile only the reason, and stop once the moderator chooses it manually.
        const observer = new MutationObserver(mutations => {
            if (mutations.every(m => isIohNode(m.target))) return;
            applyReason();
        });
        observer.observe(dialog, {childList: true, subtree: true});
        // The site's recurrence shortcut updates React state without a select change.
        // Hand over before its click handler runs, so the observer preserves that choice.
        dialog.addEventListener('click', onDialogClick, true);
        reasonSelect.addEventListener('change', onReasonChange);
        steamInput?.addEventListener('input', onSteamIdChange);
        steamInput?.addEventListener('change', onSteamIdChange);
        this.formBindings.set(reasonSelect, () => {
            observer.disconnect();
            dialog.removeEventListener('click', onDialogClick, true);
            reasonSelect.removeEventListener('change', onReasonChange);
            steamInput?.removeEventListener('input', onSteamIdChange);
            steamInput?.removeEventListener('change', onSteamIdChange);
        });
        applyReason();
    }

    isSiteRecidivismAction(target, dialog) {
        const element = target?.nodeType === 1 ? target : target?.parentElement;
        const button = element?.closest?.('button[type="button"]');
        if (!button || !dialog.contains(button) || isIohNode(button)) return false;
        // Native shortcut: notice heading + ul > li > button. Match its semantic
        // structure instead of hashed classes; clicks on history/duration stay local.
        const list = button.closest('li')?.parentElement;
        if (list?.tagName !== 'UL' || !dialog.contains(list.parentElement)) return false;
        const heading = list.parentElement.querySelector(':scope > span');
        return String(heading?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
            === 'рецидив по другой причине';
    }

    applySuggestedMuteReason(reasonSelect, dialog) {
        const steamId = this.resolveMuteFormSteamId(dialog);
        const label = this.ticketService?.getSuggestedMuteReason(steamId);
        if (label && this.setReasonByLabel(reasonSelect, label)) return true;
        return this.setReasonByLabel(reasonSelect, 'Токсичность');
    }

    resolveMuteFormSteamId(dialog) {
        const fromInput = dialog?.querySelector('#mute-steamid64')?.value?.trim();
        if (fromInput) {
            return fromInput;
        }

        const ticketService = this.ticketService;
        if (!ticketService) {
            return '';
        }

        return ticketService.getOffenderSteamIdForScope(ticketService.getActivePunishmentScope()) || '';
    }

    setReasonByLabel(reasonSelect, reasonLabel) {
        if (!reasonSelect || !reasonLabel) {
            return false;
        }

        const normalized = this.normalizePunishmentReason(reasonLabel);
        if (!normalized) {
            return false;
        }

        const options = Array.from(reasonSelect.options);
        let option = options.find(
            opt => this.normalizePunishmentReason(opt.textContent || '') === normalized
        );

        // Form labels may be longer (e.g. "Изменение голоса программами")
        // or differ only by slash spacing after normalize.
        if (!option) {
            option = options.find(opt => {
                const optNorm = this.normalizePunishmentReason(opt.textContent || '');
                return optNorm.startsWith(normalized) || normalized.startsWith(optNorm);
            });
        }

        if (!option) {
            return false;
        }

        if (reasonSelect.value === option.value) {
            return true;
        }

        return this.setSelectValue(reasonSelect, option.value);
    }

    normalizePunishmentReason(text) {
        return String(text || '')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s*\/\s*/g, '/')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    setSelectValue(select, value) {
        if (select?.tagName !== 'SELECT' || value == null || select.value === String(value)) return false;
        const view = this.document.defaultView || window;
        const descriptor = Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, 'value');
        if (descriptor?.set) descriptor.set.call(select, String(value));
        else select.value = String(value);
        select.dispatchEvent(new view.Event('input', {bubbles: true}));
        select.dispatchEvent(new view.Event('change', {bubbles: true}));
        return true;
    }
}
