import {findNativeClient} from '../analytics/NativeApi.js';
import {QUEUE_CHAT_CHANNEL, QUEUE_CHAT_LIMIT, QUEUE_CHAT_TIMEOUT, QUEUE_CHAT_MAX_INFLIGHT, normalizeQueueChatResponse} from './QueueChatClient.js';

export function installQueueChatBridge({window, document, fetchText, importModule}) {
    if (!/^https:\/\/io\.cybershoke\.(net|ru)$/.test(window.location.origin) || window.__iohQueueChatBridgeV1) return;
    window.__iohQueueChatBridgeV1 = true;
    const pending = new Map();
    const origin = window.location.origin;
    let client = null, stopped = false;
    const emit = (request, type, extra = {}) => window.postMessage({channel: QUEUE_CHAT_CHANNEL, type, nonce: request.nonce, steamId: request.steamId, ...extra}, origin);
    const finish = (request, type, extra) => {
        if (pending.get(request.nonce) !== request) return;
        pending.delete(request.nonce); clearTimeout(request.timer);
        if (type && !stopped) emit(request, type, extra);
    };
    const listener = event => {
        if (stopped || event.source !== window || event.origin !== origin || event.data?.channel !== QUEUE_CHAT_CHANNEL) return;
        const {type, nonce, steamId} = event.data;
        if (typeof nonce !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(nonce)) return;
        if (type === 'cancel') {
            const request = pending.get(nonce); if (request) {finish(request); request.controller.abort();} return;
        }
        if (type !== 'read' || typeof steamId !== 'string' || !/^\d{17}$/.test(steamId) || pending.has(nonce)) return;
        const request = {nonce, steamId, controller: new AbortController(), timer: null};
        if (pending.size >= QUEUE_CHAT_MAX_INFLIGHT) {emit(request, 'error', {code: 'BUSY'}); return;}
        pending.set(nonce, request);
        request.timer = setTimeout(() => {finish(request, 'error', {code: 'TIMEOUT'}); request.controller.abort();}, QUEUE_CHAT_TIMEOUT);
        const run = async () => {
            if (!client) client = await findNativeClient({document, origin, fetchText, importModule, signal: request.controller.signal});
            if (request.controller.signal.aborted || stopped) return;
            const response = await client.post('/chat/list', {
                // The live API's numeric created filter hides even recent messages.
                // Read the player's bounded history and enforce the 24h window locally.
                data: {steamid64_user: steamId},
                other: {limit: QUEUE_CHAT_LIMIT, name_type: true}
            }, {signal: request.controller.signal, timeout: QUEUE_CHAT_TIMEOUT});
            if (request.controller.signal.aborted || stopped) return;
            if (!(response.status >= 200 && response.status < 300)) {
                finish(request, 'error', {code: response.status === 429 ? 'RATE_LIMIT' : 'UNAVAILABLE'}); return;
            }
            const messages = normalizeQueueChatResponse(response.data, steamId);
            finish(request, 'result', {messages});
        };
        void run().catch(error => {
            const status = error?.response?.status ?? error?._orig?.response?.status;
            // Native Axios errors can contain credentials/config. Only fixed codes leave MAIN.
            finish(request, 'error', {code: status === 429 ? 'RATE_LIMIT' : error?.code === 'INVALID_RESPONSE' ? 'INVALID_RESPONSE' : 'UNAVAILABLE'});
        });
    };
    const stop = () => {
        stopped = true;
        for (const request of [...pending.values()]) {finish(request); request.controller.abort();}
        window.removeEventListener('message', listener); window.removeEventListener('pagehide', stop);
        delete window.__iohQueueChatBridgeV1;
    };
    window.addEventListener('message', listener); window.addEventListener('pagehide', stop);
    return stop;
}
