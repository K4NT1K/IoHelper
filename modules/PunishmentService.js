import {isIohNode} from './shared/dom.js';

export class PunishmentService {
    constructor({ document, ticketService = null }) {
        this.document = document;
        this.ticketService = ticketService;
        this.enabled = true;
        this.debounceId = null;
        this.formBindings = new Map();
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
            node.matches?.('[role="dialog"], #mute-reason, #mute-steamid64')
            || node.querySelector?.('#mute-reason, #mute-steamid64')
        ));
    }

    scanDialogs() {
        if (!this.enabled) return;
        for (const [reasonSelect, cleanup] of this.formBindings) {
            if (!reasonSelect.isConnected) {
                cleanup();
                this.formBindings.delete(reasonSelect);
            }
        }
        this.document.querySelectorAll('[role="dialog"]').forEach(dialog => {
            const reasonSelect = dialog.querySelector('#mute-reason');
            if (reasonSelect) this.bindMuteForm(reasonSelect, dialog);
        });
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
        reasonSelect.addEventListener('change', onReasonChange);
        steamInput?.addEventListener('input', onSteamIdChange);
        steamInput?.addEventListener('change', onSteamIdChange);
        this.formBindings.set(reasonSelect, () => {
            observer.disconnect();
            reasonSelect.removeEventListener('change', onReasonChange);
            steamInput?.removeEventListener('input', onSteamIdChange);
            steamInput?.removeEventListener('change', onSteamIdChange);
        });
        applyReason();
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
