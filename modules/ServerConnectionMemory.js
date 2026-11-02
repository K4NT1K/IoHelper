const STORAGE_KEY = 'iohLastServerConnection';
const ADMIN_URL = /^https:\/\/io\.cybershoke\.(net|ru)(?:\/|$)/i;
const PUBLIC_URL = /^https:\/\/(?:www\.)?cybershoke\.(net|ru)(?:\/|$)/i;
export const SERVER_CONNECTION_MATCHES = [
    'https://io.cybershoke.net/*', 'https://io.cybershoke.ru/*',
    'https://cybershoke.net/*', 'https://www.cybershoke.net/*',
    'https://cybershoke.ru/*', 'https://www.cybershoke.ru/*'
];

// Store only the endpoint, never optional Steam URL passwords or other parameters.
export function normalizeServerEndpoint(value) {
    const text = String(value || '').trim().replace(/^steam:\/\/connect\//i, '');
    const endpoint = text.split(/[/?#]/, 1)[0].toLowerCase();
    const match = endpoint.match(/^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\]):(\d{1,10})$/i);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return null;
    return `${match[1]}:${Number(match[2])}`;
}

export function serverEndpointFromConnectUrl(value) {
    const url = String(value || '').trim();
    if (/^steam:\/\/connect\//i.test(url)) return normalizeServerEndpoint(url);
    const launch = url.match(/^steam:\/\/(?:rungameid|run)\/[1-9]\d*\/\/(.*)$/i);
    if (!launch) return null;
    let options;
    try { options = decodeURIComponent(launch[1]); } catch { return null; }
    const command = options.match(/^\+connect\s+(?:"([^"]+)"|([^\s;"+]+))(?=\s|;|$)/i);
    return command ? normalizeServerEndpoint(command[1] || command[2]) : null;
}

function validRecord(record) {
    return record && normalizeServerEndpoint(record.endpoint) === record.endpoint
        && Number.isSafeInteger(record.revision) && record.revision > 0;
}

// Keep one durable connect intent until the next connection. The worker orders
// writes from different tabs and broadcasts the resulting revision to each tab.
export class ServerConnectionStore {
    constructor(chrome) {
        this.chrome = chrome;
        this.queue = Promise.resolve();
    }

    handle(request, sender) {
        const url = sender?.url || sender?.tab?.url || '';
        const admin = ADMIN_URL.test(url);
        if (!admin && !PUBLIC_URL.test(url)) return Promise.resolve({success: false});
        const operation = this.queue.then(async () => {
            const stored = (await this.chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
            const previous = validRecord(stored) ? stored : null;
            if (request.action === 'getServerConnection') return {success: true, record: previous};
            const endpoint = normalizeServerEndpoint(request.endpoint);
            if (!endpoint || !['manual', 'auto'].includes(request.source)) return {success: false};
            if (!admin && request.source !== 'manual') return {success: false};
            const record = {endpoint, source: request.source, requestedAt: Date.now(), revision: (previous?.revision || 0) + 1};
            await this.chrome.storage.local.set({[STORAGE_KEY]: record});
            const tabs = await this.chrome.tabs.query({url: SERVER_CONNECTION_MATCHES});
            await Promise.all(tabs.map(tab => this.chrome.tabs.sendMessage(tab.id, {
                action: 'serverConnectionChanged', record
            }).catch(() => {})));
            return {success: true, record};
        });
        this.queue = operation.catch(() => {});
        return operation;
    }
}

export class ServerConnectionMemory {
    constructor({document, chrome}) {
        this.document = document;
        this.chrome = chrome;
        this.record = null;
        this.optimistic = null;
        this.writeVersion = 0;
        this.alive = false;
        this.onClick = event => {
            if (event.button > 1 || this.automaticClick) return;
            const link = event.target?.closest?.('a[href]');
            const endpoint = serverEndpointFromConnectUrl(link?.href);
            if (endpoint) this.remember(endpoint, 'manual');
        };
        this.onMessage = message => {
            if (message.action === 'serverConnectionChanged') this.accept(message.record);
        };
    }

    get endpoint() {
        return this.optimistic?.endpoint || this.record?.endpoint || null;
    }

    accept(record) {
        if (this.alive && validRecord(record) && record.revision > (this.record?.revision || 0)) {
            this.record = record;
            if (this.optimistic && !this.optimistic.pending) this.optimistic = null;
        }
    }

    async start() {
        if (this.alive) return;
        this.alive = true;
        this.document.addEventListener('click', this.onClick, true);
        this.document.addEventListener('auxclick', this.onClick, true);
        this.chrome?.runtime?.onMessage?.addListener(this.onMessage);
        await this.refresh();
    }

    async refresh() {
        const version = this.writeVersion;
        try {
            const response = await this.chrome?.runtime?.sendMessage({action: 'getServerConnection'});
            if (response?.success && version === this.writeVersion) this.accept(response.record);
        } catch {
            // In-memory tracking remains available when the worker is unavailable.
        }
    }

    remember(value, source = 'auto') {
        const endpoint = normalizeServerEndpoint(value);
        if (!this.alive || !endpoint) return;
        const version = ++this.writeVersion;
        this.optimistic = {endpoint, pending: true};
        console.log(`[Helper] Запрошено подключение (${source === 'manual' ? 'вручную' : 'авто'}):`, endpoint);
        void (async () => {
            try {
                const response = await this.chrome?.runtime?.sendMessage({action: 'rememberServerConnection', endpoint, source});
                if (!this.alive) return;
                if (response?.success) {
                    this.accept(response.record);
                    if (version === this.writeVersion) this.optimistic = null;
                }
            } catch {
                // Keep the latest local intent even if persistence failed.
            } finally {
                if (this.alive && version === this.writeVersion && this.optimistic) this.optimistic.pending = false;
            }
        })();
    }

    clickAutomatically(link, endpoint) {
        this.remember(endpoint, 'auto');
        this.automaticClick = true;
        try { link.click(); } finally { this.automaticClick = false; }
    }

    stop() {
        this.alive = false;
        this.document.removeEventListener('click', this.onClick, true);
        this.document.removeEventListener('auxclick', this.onClick, true);
        this.chrome?.runtime?.onMessage?.removeListener(this.onMessage);
    }
}
