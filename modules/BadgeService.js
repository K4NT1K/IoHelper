class BadgeService {
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
        }

        if (targetTextarea?.parentNode && badge.parentNode !== targetTextarea.parentNode) {
            targetTextarea.parentNode.insertBefore(badge, targetTextarea);
        } else if (!badge.parentNode && targetTextarea?.parentNode) {
            targetTextarea.parentNode.insertBefore(badge, targetTextarea);
        }

        const nextClass = `ioh-info-badge ioh-info-badge--${variant}`;
        if (badge.className === nextClass && badge.innerHTML === innerHTML) {
            return;
        }

        badge.className = nextClass;
        badge.innerHTML = innerHTML;
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

window.BadgeService = BadgeService;
