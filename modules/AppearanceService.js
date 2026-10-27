import {markIoh, isIohNode} from './shared/dom.js';

const INTENSITIES = ['soft', 'balanced', 'clear'];
const SURFACE_ATTR = 'data-ioh-glass-surface';
const HEADER_ATTR = 'data-ioh-glass-header';
const DENSE_ATTR = 'data-ioh-glass-dense';

export function normalizeAppearance(value = {}) {
    return {enabled: value?.enabled === true, intensity: INTENSITIES.includes(value?.intensity) ? value.intensity : 'balanced'};
}

export class AppearanceService {
    constructor({document, chrome}) {
        this.document = document;
        this.chrome = chrome;
        this.preference = normalizeAppearance();
        this.generation = 0;
        this.surfaceByHeading = new WeakMap();
    }

    sync() {
        const root = this.document.querySelector('main');
        if (this.href === location.href && this.root === root) return;
        this.href = location.href;
        this.root = root;
        this.refresh();
    }

    async start() {
        const generation = ++this.generation;
        const {iohAppearance} = await this.chrome.storage.local.get('iohAppearance');
        if (generation !== this.generation) return;
        this.preference = normalizeAppearance(iohAppearance);
        this.apply();
        this.refresh();
        this.listener = (changes, area) => {
            if (area !== 'local' || !changes.iohAppearance) return;
            this.preference = normalizeAppearance(changes.iohAppearance.newValue);
            this.apply();
            this.render();
        };
        this.chrome.storage.onChanged.addListener(this.listener);
    }

    apply() {
        const root = this.document.documentElement;
        root.style.removeProperty('--ioh-glass-base');
        if (this.preference.enabled) root.dataset.iohGlass = this.preference.intensity;
        else {
            delete root.dataset.iohGlass;
            this.clearSurfaces();
        }
    }

    clearSurfaces() {
        this.document.querySelectorAll(`[${SURFACE_ATTR}], [${HEADER_ATTR}], [${DENSE_ATTR}]`).forEach(element => {
            element.removeAttribute(SURFACE_ATTR);
            element.removeAttribute(HEADER_ATTR);
            element.removeAttribute(DENSE_ATTR);
        });
    }

    refresh() {
        this.observer?.disconnect();
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
        const root = this.document.querySelector('main');
        if (!root) return;
        this.observer = new MutationObserver(mutations => {
            if (mutations.every(m => isIohNode(m.target) || [...m.addedNodes, ...m.removedNodes].every(isIohNode))) return;
            if (this.raf) return;
            this.raf = requestAnimationFrame(() => {this.raf = null; this.render();});
        });
        this.observer.observe(root, {childList: true, subtree: true});
        this.render();
    }

    findSurface(header, root) {
        const cached = this.surfaceByHeading.get(header);
        if (cached?.isConnected && root.contains(cached) && cached.contains(header)) return cached;
        const view = this.document.defaultView;
        let candidate = header.parentElement;
        let fallback = null;
        for (let depth = 0; candidate && candidate !== root && depth < 7; depth++, candidate = candidate.parentElement) {
            if (['MAIN', 'TABLE', 'TR', 'TD', 'TH', 'TBODY'].includes(candidate.tagName) || candidate.hasAttribute('aria-hidden')) break;
            if (candidate.closest('[data-ioh]')) break;
            const style = view.getComputedStyle(candidate);
            const painted = style.backgroundColor !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(style.backgroundColor);
            const rounded = parseFloat(style.borderTopLeftRadius || style.borderRadius) > 0;
            if (painted && candidate.children.length > 1) fallback ||= candidate;
            if ((rounded && painted) || ['SECTION', 'ARTICLE'].includes(candidate.tagName)) {
                this.surfaceByHeading.set(header, candidate);
                return candidate;
            }
        }
        if (fallback) this.surfaceByHeading.set(header, fallback);
        return fallback;
    }

    markSurface(header, root) {
        const card = this.findSurface(header, root);
        if (!card) return;
        card.setAttribute(SURFACE_ATTR, '1');
        // Paint the complete native card. Its original opaque header shell must not
        // remain behind a smaller rounded title row (the queue-header clipping bug).
        let branch = header;
        while (branch.parentElement && branch.parentElement !== card) branch = branch.parentElement;
        if (branch !== header && !branch.querySelector('table, textarea')) branch.setAttribute(HEADER_ATTR, '1');
        if (card.querySelector('table') && card.getBoundingClientRect().height > 1400) card.setAttribute(DENSE_ATTR, '1');
        else card.removeAttribute(DENSE_ATTR);
    }

    render() {
        const root = this.document.querySelector('main');
        if (!root) return;
        const visible = element => element.getClientRects().length && !element.closest('[aria-hidden="true"]');
        if (this.preference.enabled) {
            root.querySelectorAll('h3').forEach(header => {
                if (visible(header) && !header.closest('[data-ioh]')) this.markSurface(header, root);
            });
        }
        if (location.pathname !== '/settings/appearance') return;
        const header = [...root.querySelectorAll('h3')].find(element => visible(element) && element.textContent.trim() === 'Тема оформления');
        if (!header) return;
        const themeCard = this.findSurface(header, root);
        if (!themeCard?.parentElement) return;
        let section = themeCard.parentElement.querySelector(':scope > .ioh-appearance');
        if (!section) {
            section = markIoh(this.document.createElement('section'));
            section.className = 'ioh-appearance';
            section.innerHTML = '<div class="ioh-appearance-sample" aria-hidden="true"><span>Liquid</span><b>Glass</b><i>IO HELPER</i></div><div class="ioh-appearance-content"><h3>Liquid Glass</h3><p>Новый характер интерфейса: объёмные панели, прозрачность и плавные переходы.</p><div class="ioh-glass-setting"><span>Эффект интерфейса</span><label class="ioh-glass-switch"><input type="checkbox" class="ioh-glass-enabled" aria-label="Включить Liquid Glass"><span aria-hidden="true"></span></label></div><label class="ioh-glass-select">Прозрачность<select><option value="soft">Мягкая</option><option value="balanced">Сбалансированная</option><option value="clear">Выразительная</option></select></label><small>Настройка сохраняется в этом браузере. Учитывается уменьшение движения.</small></div>';
            section.querySelectorAll('*').forEach(markIoh);
            themeCard.insertAdjacentElement('beforebegin', section);
            const save = () => this.chrome.storage.local.set({iohAppearance: {
                enabled: section.querySelector('input').checked,
                intensity: section.querySelector('select').value
            }});
            section.querySelector('input').addEventListener('change', save);
            section.querySelector('select').addEventListener('change', save);
        }
        section.querySelector('input').checked = this.preference.enabled;
        section.querySelector('select').value = this.preference.intensity;
    }

    stop() {
        this.generation++;
        this.observer?.disconnect();
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
        if (this.listener) this.chrome.storage.onChanged.removeListener(this.listener);
    }
}
