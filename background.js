// background.js

async function fetchOffenderProfileJson(steamId) {
    const response = await fetch('https://mobile.fastmm.win/api/page/v1/faceit-service/player/find', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            target: steamId,
            game: 'cs2'
        }),
        redirect: 'follow'
    });

    if (!response.ok) {
        throw new Error(`Ошибка сети: статус ${response.status}`);
    }

    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw new Error('Некорректный JSON-ответ сервера');
    }

    if (!data || data.status !== 'success') {
        throw new Error(data?.status ? `Статус ответа: ${data.status}` : 'Профиль не найден');
    }

    return data;
}

const TRANSLATE_CACHE_KEY = 'iohTranslateCache';
const TRANSLATE_CACHE_LIMIT = 800;
const GOOGLE_COOLDOWN_MS = 5 * 60 * 1000;
const GOOGLE_MIN_GAP_MS = 1200;

let googleCooldownUntil = 0;
let googleNextAllowedAt = 0;
let translatePersistTimer = null;
let translateCacheHydrated = false;
const translateInflight = new Map();
const translateMemoryCache = new Map();

function translateCacheKey(text, targetLang) {
    return `${String(targetLang || 'ru').toLowerCase()}::${String(text || '').trim()}`;
}

async function hydrateTranslateCache() {
    if (translateCacheHydrated) {
        return;
    }

    translateCacheHydrated = true;

    try {
        const stored = await chrome.storage.session.get(TRANSLATE_CACHE_KEY);
        const cache = stored?.[TRANSLATE_CACHE_KEY];
        if (!cache || typeof cache !== 'object') {
            return;
        }

        Object.entries(cache).forEach(([key, entry]) => {
            if (entry?.translated && !translateMemoryCache.has(key)) {
                translateMemoryCache.set(key, entry.translated);
            }
        });

        if (translateMemoryCache.size > TRANSLATE_CACHE_LIMIT) {
            const overflow = translateMemoryCache.size - TRANSLATE_CACHE_LIMIT;
            const keys = Array.from(translateMemoryCache.keys()).slice(0, overflow);
            keys.forEach(key => translateMemoryCache.delete(key));
        }
    } catch {
        // ignore storage errors
    }
}

async function writeTranslateCacheEntry(cacheKey, translated) {
    translateMemoryCache.set(cacheKey, translated);

    if (translateMemoryCache.size > TRANSLATE_CACHE_LIMIT) {
        const firstKey = translateMemoryCache.keys().next().value;
        translateMemoryCache.delete(firstKey);
    }

    // Persist infrequently to avoid storage churn while popup/settings are open.
    clearTimeout(translatePersistTimer);
    translatePersistTimer = setTimeout(async () => {
        try {
            const cache = Object.fromEntries(
                Array.from(translateMemoryCache.entries()).map(([key, value]) => [
                    key,
                    {translated: value, ts: Date.now()}
                ])
            );
            await chrome.storage.session.set({[TRANSLATE_CACHE_KEY]: cache});
        } catch {
            // ignore storage errors
        }
    }, 1500);
}

async function waitForGoogleSlot() {
    const now = Date.now();
    const waitMs = Math.max(0, googleNextAllowedAt - now);
    if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    googleNextAllowedAt = Date.now() + GOOGLE_MIN_GAP_MS;
}

async function translateTextViaGoogle(text, targetLang = 'ru') {
    if (Date.now() < googleCooldownUntil) {
        throw new Error('Google cooldown');
    }

    await waitForGoogleSlot();

    const lang = String(targetLang || 'ru').toLowerCase();
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);

    if (response.status === 429) {
        googleCooldownUntil = Date.now() + GOOGLE_COOLDOWN_MS;
        throw new Error('Translate HTTP 429');
    }

    if (!response.ok) {
        throw new Error(`Translate HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data?.[0]) {
        throw new Error('Пустой ответ переводчика');
    }

    return data[0].map(item => item[0]).join('');
}

async function translateTextViaMyMemory(text, targetLang = 'ru') {
    const lang = String(targetLang || 'ru').toLowerCase();
    const pairs = [`Autodetect|${lang}`, `en|${lang}`];
    let lastError = null;

    for (const pair of pairs) {
        try {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`MyMemory HTTP ${response.status}`);
            }

            const data = await response.json();
            const status = Number(data?.responseStatus);
            const translated = data?.responseData?.translatedText;

            if (!translated || (status && status !== 200)) {
                throw new Error(data?.responseDetails || 'MyMemory empty response');
            }

            return translated;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('MyMemory empty response');
}

async function translateText(text, targetLang = 'ru') {
    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
        throw new Error('Пустой текст');
    }

    const lang = String(targetLang || 'ru').toLowerCase();
    const cacheKey = translateCacheKey(normalizedText, lang);

    await hydrateTranslateCache();

    if (translateMemoryCache.has(cacheKey)) {
        return translateMemoryCache.get(cacheKey);
    }

    if (translateInflight.has(cacheKey)) {
        return translateInflight.get(cacheKey);
    }

    const requestPromise = (async () => {
        let translated = null;
        let lastError = null;

        if (Date.now() >= googleCooldownUntil) {
            try {
                translated = await translateTextViaGoogle(normalizedText, lang);
            } catch (error) {
                lastError = error;
            }
        }

        if (!translated) {
            try {
                translated = await translateTextViaMyMemory(normalizedText, lang);
            } catch (error) {
                lastError = error;
            }
        }

        if (!translated) {
            throw lastError || new Error('Не удалось перевести текст');
        }

        await writeTranslateCacheEntry(cacheKey, translated);
        return translated;
    })().finally(() => {
        translateInflight.delete(cacheKey);
    });

    translateInflight.set(cacheKey, requestPromise);
    return requestPromise;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchOffenderProfile') {
        const steamId = request.steamId;

        (async () => {
            try {
                const data = await fetchOffenderProfileJson(steamId);
                sendResponse({
                    success: true,
                    data,
                    source: 'fastmm'
                });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message || 'Не удалось загрузить профиль'
                });
            }
        })();

        return true;
    }

    if (request.action === 'translateText') {
        (async () => {
            try {
                const translated = await translateText(request.text, request.targetLang || 'ru');
                sendResponse({
                    success: true,
                    translated
                });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message || 'Не удалось перевести текст'
                });
            }
        })();

        return true;
    }
});
