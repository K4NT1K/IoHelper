import {isIohNode} from './shared/dom.js';

export class PunishmentService {
    constructor({ document, ticketService = null }) {
        this.document = document;
        this.ticketService = ticketService;
        this.enabled = true;
        this.debounceId = null;
        this.formBindings = new Map();
        this.punishmentBindings = new Map();
        this.punishmentIntentListeners = null;
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
        this.stopPunishmentIntentBindings();
        this.syncPunishmentIntentListeners();
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
        this.syncPunishmentIntentListeners();
        if (!this.isPunishmentConfirmationEnabled()) this.stopPunishmentIntentBindings();
        for (const [dialog, binding] of this.punishmentBindings) {
            if (!dialog.isConnected || dialog.getAttribute?.('data-state') === 'closed') {
                binding.cleanup();
                this.punishmentBindings.delete(dialog);
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
        const features = this.ticketService?.settings?.features;
        return this.enabled && (features?.autoSelectCloseReason === true || features?.processTicketRules === true);
    }

    syncPunishmentIntentListeners() {
        if (!this.isPunishmentConfirmationEnabled()) {
            if (this.punishmentIntentListeners) {
                const {click, submit} = this.punishmentIntentListeners;
                this.document.removeEventListener('click', click, true);
                this.document.removeEventListener('submit', submit, true);
                this.punishmentIntentListeners = null;
            }
            return;
        }
        if (this.punishmentIntentListeners || !this.document.addEventListener) return;
        const click = event => this.handlePunishmentIntentEvent(event);
        const submit = event => this.handlePunishmentIntentEvent(event);
        this.document.addEventListener('click', click, true);
        this.document.addEventListener('submit', submit, true);
        this.punishmentIntentListeners = {click, submit};
    }

    handlePunishmentIntentEvent(event) {
        if (!this.isPunishmentConfirmationEnabled()) return;
        const element = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
        const dialog = element?.closest?.('[role="dialog"]');
        if (!dialog || !dialog.isConnected || isIohNode(dialog)) return;
        // The first click may precede the coordinator's debounced scan entirely.
        this.bindPunishmentConfirmation(dialog);
        const binding = this.punishmentBindings.get(dialog);
        if (binding) this.applyPunishmentIntentEvent(binding, event);
    }

    getPunishmentConfirmationOrigin(scope, steamId, {requireEditable = true} = {}) {
        const ticket = this.ticketService;
        if (!scope || !steamId || !this.document.contains(scope)
            || !ticket.isOpenComplaintScope(scope)
            || ticket.getOffenderSteamIdForScope(scope) !== steamId) return null;
        // Identity is captured while opening the dialog, including during a temporary
        // readonly/disabled React transition. Availability is checked at the action.
        const ticketId = ticket.extractTicketIdFromComplaintScope(scope);
        if (!ticketId) return null;
        if (!requireEditable) return {scope, steamId, ticketId};
        const textarea = scope.querySelector?.('textarea[placeholder*="Опишите детали закрытия"]');
        if (!textarea || textarea.readOnly || textarea.disabled) return null;
        if (ticket.getTicketPunishmentFeedbackContext && ticket.isTicketPunishmentFeedbackContextEditable) {
            const context = ticket.getTicketPunishmentFeedbackContext(textarea, scope);
            if (!context || context.ticketId !== ticketId || context.steamId !== steamId
                || !ticket.isTicketPunishmentFeedbackContextEditable(context)) return null;
        } else if (ticket.getCloseReasonContext && ticket.isCloseReasonContextEditable) {
            const context = ticket.getCloseReasonContext(textarea);
            if (!context || context.scope !== scope || context.steamId !== steamId
                || context.ticketId !== ticketId || !ticket.isCloseReasonContextEditable(context)) return null;
        } else if (!ticket.scopeHasInProgressStatus(scope, {includeActivePanel: false})) {
            return null;
        }
        return {scope, steamId, ticketId};
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
            captured?.steamId || (initialScope && ticket.getOffenderSteamIdForScope(initialScope)), {requireEditable: false});
        if (captured && (captured.type !== type || captured.ticketId !== initialOrigin?.ticketId)) initialOrigin = null;
        const binding = {dialog, form, input, type, initialOrigin,
            originIdentity: captured ? {...captured} : initialOrigin ? {...initialOrigin, type} : null,
            attemptToken: null, errorObserver: null, cleanup: null};
        const onSubmit = event => this.applyPunishmentIntentEvent(binding, event);
        const onClick = event => this.applyPunishmentIntentEvent(binding, event);
        const onInvalid = () => this.cancelPunishmentIntent(binding);
        form.addEventListener('submit', onSubmit, true);
        form.addEventListener('invalid', onInvalid, true);
        dialog.addEventListener?.('click', onClick, true);
        binding.cleanup = () => {
            form.removeEventListener('submit', onSubmit, true);
            form.removeEventListener('invalid', onInvalid, true);
            dialog.removeEventListener?.('click', onClick, true);
            binding.errorObserver?.disconnect();
            // The bridge may store the token after an early binding already consumed it.
            ticket._closeReasonPunishmentOrigins?.delete(dialog);
        };
        this.punishmentBindings.set(dialog, binding);
    }

    applyPunishmentIntentEvent(binding, event) {
        if (!this.isPunishmentConfirmationEnabled() || !binding.dialog.isConnected
            || binding.dialog.getAttribute?.('data-state') === 'closed') return;
        if (event.type === 'click') {
            const element = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
            const button = element?.closest?.('button');
            if (!button || button.disabled || isIohNode(button)
                || !binding.form.contains(button)) return;
            const label = String(button.textContent || '').replace(/\s+/g, ' ').trim();
            if (button.type === 'button' && label === 'Отмена') {
                this.cancelPunishmentIntent(binding);
                return;
            }
            const expected = binding.type === 'ban' ? 'Заблокировать' : 'Выдать ограничение';
            if (!['submit', 'button'].includes(button.type) || label !== expected) return;
        } else if (event.type !== 'submit') {
            return;
        } else if (event.submitter) {
            const expected = binding.type === 'ban' ? 'Заблокировать' : 'Выдать ограничение';
            if (event.submitter.disabled || event.submitter.type !== 'submit'
                || !binding.form.contains(event.submitter)
                || String(event.submitter.textContent || '').replace(/\s+/g, ' ').trim() !== expected) return;
        }
        this.recoverPunishmentBindingOrigin(binding);
        if (event.defaultPrevented || !binding.initialOrigin) return;
        const steamId = binding.input.value.trim();
        if (!/^\d{17,18}$/.test(steamId) || binding.input.disabled
            || (binding.form.checkValidity && !binding.form.checkValidity())
            || binding.dialog.querySelector('[aria-invalid="true"]')) {
            this.cancelPunishmentIntent(binding);
            return;
        }
        const origin = this.getPunishmentConfirmationOrigin(binding.initialOrigin.scope, steamId);
        if (!origin || origin.steamId !== binding.initialOrigin.steamId
            || origin.ticketId !== binding.initialOrigin.ticketId) return;
        // Both the click and its default submit reach capture listeners. Keep one
        // token until an explicit native error/cancel allows a new attempt.
        if (binding.attemptToken) return;
        const attemptToken = {};
        binding.attemptToken = attemptToken;
        this.ticketService.onTicketPunishmentFeedbackIntent?.({...origin, type: binding.type, attemptToken});
        this.ticketService.onCloseReasonPunishmentIntent({
            ...origin, type: binding.type, attemptToken
        });
        const Observer = this.document.defaultView?.MutationObserver
            || (typeof MutationObserver === 'function' ? MutationObserver : null);
        if (Observer && !binding.errorObserver) {
            binding.errorObserver = new Observer(mutations => {
                if (!binding.attemptToken || !this.isPunishmentConfirmationEnabled()
                    || mutations.every(mutation => isIohNode(mutation.target))) return;
                const invalid = binding.dialog.querySelector('[aria-invalid="true"]');
                const alerts = binding.dialog.querySelectorAll('[role="alert"]');
                if (invalid || Array.from(alerts).some(alert => !isIohNode(alert)
                    && alert.getAttribute?.('aria-hidden') !== 'true' && alert.textContent.trim())) {
                    this.cancelPunishmentIntent(binding);
                }
            });
            binding.errorObserver.observe(binding.dialog, {childList: true, subtree: true, characterData: true,
                attributes: true, attributeFilter: ['aria-invalid', 'role', 'aria-hidden']});
        }
    }

    recoverPunishmentBindingOrigin(binding) {
        const saved = binding.originIdentity;
        if (!saved || this.document.contains(saved.scope)) return;
        const latest = this.ticketService._closeReasonPunishmentOrigins?.get(binding.dialog);
        // Only the bridge's exact-dialog token can replace a detached opening
        // scope. A later active tab never becomes the owner by itself.
        if (!latest || latest.type !== binding.type || latest.type !== saved.type
            || latest.ticketId !== saved.ticketId || latest.steamId !== saved.steamId) return;
        const origin = this.getPunishmentConfirmationOrigin(latest.scope, latest.steamId);
        if (!origin || origin.ticketId !== saved.ticketId) return;
        binding.initialOrigin = origin;
        binding.originIdentity = {...origin, type: binding.type};
        this.ticketService._closeReasonPunishmentOrigins.delete(binding.dialog);
    }

    cancelPunishmentIntent(binding) {
        if (binding.attemptToken) this.ticketService.cancelTicketPunishmentFeedbackIntent?.(binding.attemptToken);
        if (binding.attemptToken) this.ticketService.cancelCloseReasonPunishmentIntent(binding.attemptToken);
        binding.attemptToken = null;
    }

    stopPunishmentIntentBindings() {
        for (const binding of this.punishmentBindings.values()) {
            this.cancelPunishmentIntent(binding);
            binding.cleanup();
        }
        this.punishmentBindings.clear();
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
