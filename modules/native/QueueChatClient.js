export const QUEUE_CHAT_CHANNEL = 'ioh-queue-chat-v1';
export const QUEUE_CHAT_LIMIT = 1000;
export const QUEUE_CHAT_TIMEOUT = 15000;
export const QUEUE_CHAT_MAX_INFLIGHT = 8;
const clients = new WeakMap();
const validSteamId = id => typeof id === 'string' && /^\d{17}$/.test(id);
const allowedOrigin = origin => /^https:\/\/io\.cybershoke\.(net|ru)$/.test(origin);
const codes = new Set(['ABORTED', 'TIMEOUT', 'RATE_LIMIT', 'UNAVAILABLE', 'INVALID_RESPONSE', 'BUSY']);
export const queueChatError = code => Object.assign(new Error('Не удалось прочитать историю чата: ' + (codes.has(code) ? code : 'UNAVAILABLE')), {code: codes.has(code) ? code : 'UNAVAILABLE'});

// chat/list is a bounded sample, not the complete native ticket chat history.
// Keep duplicate messages: removing them would change spam verdicts.
export function normalizeQueueChatResponse(raw, steamId, {now = Date.now()} = {}) {
    const source = Array.isArray(raw) ? raw : raw?.messages;
    if (!validSteamId(steamId) || !Array.isArray(source) || source.length > 10000) throw queueChatError('INVALID_RESPONSE');
    const messages = [];
    for (const row of source) {
        if (row?.steamid64 !== steamId || typeof row.msg !== 'string' || !row.msg.trim()) continue;
        if (typeof row.unixtime !== 'number' && typeof row.unixtime !== 'string' || String(row.unixtime).trim() === '') continue;
        const timeMs = Number(row.unixtime) * 1000;
        if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs < now - 86400000 || timeMs > now) continue;
        messages.push({timeMs, text: row.msg.slice(0, 20000), channel: row.type === 1 || row.type === '1' ? 'team' : 'all'});
    }
    return messages;
}

function validMessages(messages) {
    return Array.isArray(messages) && messages.length <= 10000 && messages.every(m => m && Number.isFinite(m.timeMs)
        && m.timeMs > 0 && typeof m.text === 'string' && m.text.length <= 20000 && ['all', 'team'].includes(m.channel));
}

function getClient(window) {
    if (clients.has(window)) return clients.get(window);
    const pending = new Map();
    const origin = window.location.origin;
    const post = data => window.postMessage({channel: QUEUE_CHAT_CHANNEL, ...data}, origin);
    const finish = (nonce, error, messages) => {
        const request = pending.get(nonce); if (!request) return;
        pending.delete(nonce); clearTimeout(request.timer);
        request.signal?.removeEventListener('abort', request.cancel);
        if (error) request.reject(error); else request.resolve(messages);
    };
    const listener = event => {
        if (event.source !== window || event.origin !== origin || event.data?.channel !== QUEUE_CHAT_CHANNEL) return;
        const data = event.data, request = pending.get(data.nonce);
        if (!request || data.steamId !== request.steamId) return;
        if (data.type === 'error') finish(data.nonce, queueChatError(data.code));
        else if (data.type === 'result') finish(data.nonce, validMessages(data.messages) ? null : queueChatError('INVALID_RESPONSE'), data.messages);
    };
    const hide = () => {
        for (const nonce of [...pending.keys()]) { post({type: 'cancel', nonce}); finish(nonce, queueChatError('ABORTED')); }
        window.removeEventListener('message', listener); window.removeEventListener('pagehide', hide);
        clients.delete(window);
    };
    window.addEventListener('message', listener); window.addEventListener('pagehide', hide);
    const client = {pending, post, finish}; clients.set(window, client); return client;
}

export function requestQueueChat({window, steamId, signal}) {
    if (!allowedOrigin(window?.location?.origin || '') || !validSteamId(steamId)) return Promise.reject(queueChatError('UNAVAILABLE'));
    if (signal?.aborted) return Promise.reject(queueChatError('ABORTED'));
    const client = getClient(window);
    if (client.pending.size >= QUEUE_CHAT_MAX_INFLIGHT) return Promise.reject(queueChatError('BUSY'));
    const nonce = window.crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const cancel = () => {client.post({type: 'cancel', nonce}); client.finish(nonce, queueChatError('ABORTED'));};
        const timer = setTimeout(() => {client.post({type: 'cancel', nonce}); client.finish(nonce, queueChatError('TIMEOUT'));}, QUEUE_CHAT_TIMEOUT + 1000);
        client.pending.set(nonce, {steamId, signal, resolve, reject, cancel, timer});
        signal?.addEventListener('abort', cancel, {once: true});
        client.post({type: 'read', nonce, steamId});
    });
}
