import { markIoh } from './shared/dom.js';

export class BadgeService {
    constructor({ document }) {
        this.document = document;
        this.translateCache = new Map();
        this.translateInflight = new Map();
        this.builtInTranslators = new Map();
        this.languageDetectorPromise = null;
    }

    updateInfoBadge(elementId, variant, innerHTML, targetTextarea) {
        let badge = this.document.getElementById(elementId);
        if (!badge) {
            badge = this.document.createElement('div');
            badge.id = elementId;
            markIoh(badge);
        }

        if (targetTextarea?.parentNode && badge.parentNode !== targetTextarea.parentNode) {
            targetTextarea.parentNode.insertBefore(badge, targetTextarea);
        } else if (!badge.parentNode && targetTextarea?.parentNode) {
            targetTextarea.parentNode.insertBefore(badge, targetTextarea);
        }

        const nextClass = `ioh-info-badge ioh-info-badge--${variant}`;
        if (badge.className === nextClass && badge.innerHTML === innerHTML) {
            this.wireOverflowTooltips(badge);
            return;
        }

        this.hideTriggerTooltip();

        this.document.querySelectorAll('body > .ioh-punishment-preview-tooltip__panel').forEach(panel => {
            panel.remove();
        });

        badge.className = nextClass;
        badge.innerHTML = innerHTML;
        this.wireOverflowTooltips(badge);
    }

    wireOverflowTooltips(root) {
        if (!root) {
            return;
        }

        this.wireTriggerTooltips(root);

        root.querySelectorAll('.ioh-punishment-preview-tooltip').forEach(host => {
            const panel = host.querySelector(':scope > .ioh-punishment-preview-tooltip__panel');
            if (!panel || host.dataset.iohTipBound === '1') {
                return;
            }

            host.dataset.iohTipBound = '1';

            const placePanel = () => {
                const rect = host.getBoundingClientRect();
                const gap = 10;
                const maxWidth = Math.min(720, window.innerWidth - 16);
                panel.style.position = 'fixed';
                panel.style.zIndex = '2147483646';
                panel.style.width = 'max-content';
                panel.style.maxWidth = `${maxWidth}px`;
                panel.style.transform = 'none';
                panel.style.pointerEvents = 'none';

                // Prefer growing right from the host; clamp into the viewport.
                let left = Math.max(8, rect.left);
                panel.style.left = `${left}px`;
                panel.style.right = 'auto';
                panel.style.top = 'auto';
                panel.style.bottom = `${Math.max(8, window.innerHeight - rect.top + gap)}px`;

                if (panel.parentElement !== this.document.body) {
                    this.document.body.appendChild(panel);
                }

                const panelRect = panel.getBoundingClientRect();
                if (panelRect.right > window.innerWidth - 8) {
                    left = Math.max(8, window.innerWidth - 8 - panelRect.width);
                    panel.style.left = `${left}px`;
                }
                if (panelRect.top < 8) {
                    panel.style.bottom = 'auto';
                    panel.style.top = `${Math.min(window.innerHeight - panelRect.height - 8, rect.bottom + gap)}px`;
                }

                panel.classList.add('ioh-punishment-preview-tooltip__panel--open');
            };

            const hidePanel = () => {
                panel.classList.remove('ioh-punishment-preview-tooltip__panel--open');
                panel.style.pointerEvents = 'none';
                if (panel.parentElement === this.document.body) {
                    host.appendChild(panel);
                }
            };

            host.addEventListener('mouseenter', placePanel);
            host.addEventListener('focus', placePanel);
            host.addEventListener('mouseleave', hidePanel);
            host.addEventListener('blur', hidePanel);
        });
    }

    hideTriggerTooltip() {
        this._triggerTooltipCleanup?.();
        this._triggerTooltipCleanup = null;
    }

    wireTriggerTooltips(root) {
        if (!root.addEventListener) return;
        this._triggerTooltipRoots ||= new WeakSet();
        if (this._triggerTooltipRoots.has(root)) return;
        this._triggerTooltipRoots.add(root);
        const selector = '.ioh-trigger-tooltip[data-full-msg]:not(.ioh-more-triggers)';
        const show = event => {
            const host = event.target.closest?.(selector);
            if (!host || !root.contains(host) || host.contains(event.relatedTarget)) return;
            this.hideTriggerTooltip();
            const panel = this.document.createElement('div');
            markIoh(panel);
            panel.className = 'ioh-trigger-tooltip__panel';
            panel.setAttribute('role', 'tooltip');
            panel.textContent = host.dataset.fullMsg;
            const view = this.document.defaultView;
            const margin = 8, gap = 10;
            panel.style.maxWidth = `${Math.max(1, Math.min(280, view.innerWidth - margin * 2))}px`;
            panel.style.maxHeight = `${Math.max(1, view.innerHeight - margin * 2)}px`;
            this.document.body.appendChild(panel);
            const rect = host.getBoundingClientRect(), size = panel.getBoundingClientRect();
            panel.style.left = `${Math.max(margin, Math.min(rect.left + rect.width / 2 - size.width / 2,
                view.innerWidth - size.width - margin))}px`;
            const above = rect.top - size.height - gap;
            panel.style.top = `${Math.max(margin, above >= margin ? above
                : Math.min(rect.bottom + gap, view.innerHeight - size.height - margin))}px`;
            const hide = () => this.hideTriggerTooltip();
            view.addEventListener('scroll', hide, true);
            view.addEventListener('resize', hide);
            this._triggerTooltipCleanup = () => {
                panel.remove();
                view.removeEventListener('scroll', hide, true);
                view.removeEventListener('resize', hide);
            };
        };
        const hide = event => {
            const host = event.target.closest?.(selector);
            if (host && !host.contains(event.relatedTarget)) this.hideTriggerTooltip();
        };
        root.addEventListener('mouseover', show);
        root.addEventListener('focusin', show);
        root.addEventListener('mouseout', hide);
        root.addEventListener('focusout', hide);
    }

    async detectSourceLanguage(text) {
        if (!('LanguageDetector' in self)) {
            return 'en';
        }

        try {
            if (!this.languageDetectorPromise) {
                this.languageDetectorPromise = LanguageDetector.create();
            }
            const detector = await this.languageDetectorPromise;
            const detections = await detector.detect(text);
            const best = detections?.[0]?.detectedLanguage;
            if (best && best !== 'und') {
                return best;
            }
        } catch {
            this.languageDetectorPromise = null;
        }

        return 'en';
    }

    async translateWithBuiltIn(text, targetLang) {
        if (!('Translator' in self)) {
            return null;
        }

        try {
            const sourceLanguage = await this.detectSourceLanguage(text);
            if (sourceLanguage === targetLang) {
                return text;
            }

            const pairKey = `${sourceLanguage}->${targetLang}`;
            let translator = this.builtInTranslators.get(pairKey);

            if (!translator) {
                const options = { sourceLanguage, targetLanguage: targetLang };
                const availability = await Translator.availability(options);
                if (availability === 'unavailable') {
                    return null;
                }

                translator = await Translator.create({
                    ...options,
                    monitor(m) {
                        m.addEventListener('downloadprogress', () => {});
                    }
                });
                this.builtInTranslators.set(pairKey, translator);
            }

            const translated = await translator.translate(text);
            return translated || null;
        } catch (err) {
            console.log('Built-in translator unavailable: ', err?.message || err);
            return null;
        }
    }

    async translateViaBackground(text, targetLang) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(
                    {
                        action: 'translateText',
                        text,
                        targetLang
                    },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            console.log('Translate api error: ', chrome.runtime.lastError);
                            resolve(null);
                            return;
                        }

                        if (!(response && response.success && response.translated)) {
                            console.log('Translate api error: ', response?.error || 'empty translate response');
                            resolve(null);
                            return;
                        }

                        resolve(response.translated);
                    }
                );
            } catch (err) {
                console.log('Translate api error: ', err);
                resolve(null);
            }
        });
    }

    async translateText(text, targetLang = 'RU') {
        const normalizedText = String(text || '').trim();
        if (!normalizedText) {
            return null;
        }

        const lang = String(targetLang || 'RU').toLowerCase();
        const cacheKey = `${lang}::${normalizedText}`;

        if (this.translateCache.has(cacheKey)) {
            return { translated: this.translateCache.get(cacheKey) };
        }

        if (this.translateInflight.has(cacheKey)) {
            return this.translateInflight.get(cacheKey);
        }

        const requestPromise = (async () => {
            let translated = await this.translateWithBuiltIn(normalizedText, lang);

            if (!translated) {
                translated = await this.translateViaBackground(normalizedText, lang);
            }

            if (!translated) {
                return null;
            }

            this.translateCache.set(cacheKey, translated);
            return { translated };
        })().finally(() => {
            this.translateInflight.delete(cacheKey);
        });

        this.translateInflight.set(cacheKey, requestPromise);
        return requestPromise;
    }
}
