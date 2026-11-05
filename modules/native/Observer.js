import {CHANNEL, describeRequest, normalizeResponse, normalizeFailure, requestTime} from './model.js';
import {findNativeClient} from '../analytics/NativeApi.js';
import {observeNativeBootstrap} from './Bootstrap.js';

// Observe the site's clients; never send player/ticket requests or modify their results.
export function installNativeObserver({window, document, fetchText, importModule}) {
    let enabled = false, nonce = null, generation = 0, sequence = 0, controller = null;
    let discovery = null, domObserver = null, attemptedEntry = '', replayBytes = 0, retryAt = 0, attempts = 0;
    let bootstrapCleanup = null;
    const clients = new Map(), requests = new WeakMap(), replay = new Map();
    const post = (type, extra = {}) => window.postMessage({channel: CHANNEL, type, nonce, ...extra}, window.location.origin);
    const publish = event => {
        if (!event) return;
        const previous = replay.get(event.key)?.event;
        if (previous && (previous.startedAt > event.startedAt || previous.startedAt === event.startedAt && previous.sequence >= event.sequence)) return;
        const bytes = JSON.stringify(event).length * 2;
        if (bytes > 2 * 1024 * 1024) return;
        replayBytes -= replay.get(event.key)?.bytes || 0;
        replay.delete(event.key); replay.set(event.key, {event, bytes}); replayBytes += bytes;
        while (replay.size > 80 || replayBytes > 8 * 1024 * 1024) {
            const oldest = replay.keys().next().value; replayBytes -= replay.get(oldest).bytes; replay.delete(oldest);
        }
        post('data', {event});
    };
    const observe = client => {
        if (!enabled || clients.has(client) || typeof client?.post !== 'function' || !client.interceptors?.response?.use) return;
        let base; try { base = new URL(client.defaults?.baseURL || '', window.location.origin); } catch { return; }
        if (!['io.cybershoke.net', 'io.cybershoke.ru', 'cybershoke.net', 'cybershoke.ru'].includes(base.hostname) || base.pathname.replace(/\/$/, '') !== '/api') return;
        const requestId = client.interceptors.request.use(config => {
            requests.set(config, {startedAt: requestTime(window), sequence: ++sequence, generation}); return config;
        });
        const capture = (response, error = false) => {
            try {
                if (!enabled || !response?.config) return;
                const d = describeRequest(response.config, window.location.origin);
                const stamp = requests.get(response.config);
                if (!stamp || stamp.generation !== generation) return;
                const context = {...stamp, receivedAt: Date.now(), status: response.status};
                const event = normalizeResponse(d, response.data, context) || normalizeFailure(d, context);
                if (!event || error && event.kind !== 'action' && event.kind !== 'resourceError') return;
                publish(event);
            } catch { /* A changed site schema must not affect the site's request. */ }
        };
        const responseId = client.interceptors.response.use(response => { capture(response); return response; }, error => {
            capture(error?.response || error?._orig?.response || {config: error?.config || error?._orig?.config, status: 0}, true); return Promise.reject(error);
        });
        clients.set(client, {requestId, responseId});
    };
    const discover = () => {
        if (enabled && !bootstrapCleanup) {
            const version = generation;
            bootstrapCleanup = observeNativeBootstrap(document, (raw, receivedAt) => {
                if (!enabled || version !== generation) return;
                publish(normalizeResponse({kind: 'account', key: '/api/admin/data/login'}, raw,
                    {startedAt: 0, receivedAt, sequence: ++sequence}));
            });
        }
        if (clients.size && bootstrapCleanup) domObserver?.disconnect();
        if (!enabled || discovery || clients.size || Date.now() < retryAt || attempts >= 3) return;
        const entry = [...document.querySelectorAll('script[type="module"][src]')].map(s => s.src).join('|');
        if (!entry || entry === attemptedEntry) return;
        attemptedEntry = entry; attempts++;
        const version = generation; controller = new AbortController();
        discovery = findNativeClient({document, origin: window.location.origin, fetchText, importModule, signal: controller.signal,
            onModule: module => { if (enabled && generation === version) Object.values(module).forEach(observe); }})
            .then(client => { if (enabled && generation === version) observe(client); })
            .catch(() => { if (version === generation) { attemptedEntry = ''; retryAt = Date.now() + 5000; } })
            .finally(() => { discovery = null; if (clients.size && bootstrapCleanup) domObserver?.disconnect(); else if (enabled && version !== generation) discover(); });
    };
    const stop = () => {
        enabled = false; generation++; controller?.abort(); domObserver?.disconnect();
        bootstrapCleanup?.(); bootstrapCleanup = null;
        for (const [c, ids] of clients) { c.interceptors.request.eject(ids.requestId); c.interceptors.response.eject(ids.responseId); }
        clients.clear(); replay.clear(); replayBytes = 0; attemptedEntry = ''; retryAt = 0; attempts = 0;
    };
    const listener = event => {
        if (event.source !== window || event.origin !== window.location.origin || event.data?.channel !== CHANNEL) return;
        const m = event.data;
        if (m.type === 'start' && /^[a-f0-9-]{16,64}$/i.test(m.nonce || '')) {
            nonce = m.nonce;
            if (!enabled) {
                enabled = true;
                domObserver = new window.MutationObserver(discover);
                domObserver.observe(document, {childList: true, subtree: true});
                discover();
            }
            for (const value of replay.values()) post('data', {event: value.event});
        } else if (m.type === 'stop' && m.nonce === nonce) stop();
    };
    window.addEventListener('message', listener);
    const hide = event => { if (!event.persisted) { stop(); window.removeEventListener('message', listener); window.removeEventListener('pagehide', hide); } };
    window.addEventListener('pagehide', hide);
    post('ready');
    return stop;
}
