import {CHANNEL} from './model.js';
import {NativeDataStore} from './Store.js';

export function startNativeDataClient({window, chrome}) {
    const store = new NativeDataStore(), nonce = window.crypto.randomUUID();
    let enabled = false, closed = false, storageVersion = 0;
    const post = type => window.postMessage({channel: CHANNEL, nonce, type}, window.location.origin);
    const listener = event => {
        if (closed || event.source !== window || event.origin !== window.location.origin || event.data?.channel !== CHANNEL) return;
        if (event.data.type === 'ready' && enabled) post('start');
        if (enabled && event.data.nonce === nonce && event.data.type === 'data') {
            try { store.apply(event.data.event); } catch { /* Ignore an incompatible bridge message. */ }
        }
    };
    const setEnabled = value => { enabled = value; if (!value) store.clear(); post(value ? 'start' : 'stop'); };
    const change = (changes, area) => { if (area === 'local' && changes.scriptEnabled) { storageVersion++; setEnabled(changes.scriptEnabled.newValue !== false); } };
    const stop = () => {
        if (closed) return; post('stop'); closed = true; store.clear();
        window.removeEventListener('message', listener); chrome.storage.onChanged.removeListener(change);
        window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show);
    };
    window.addEventListener('message', listener);
    chrome.storage.onChanged.addListener(change);
    const initialVersion = storageVersion;
    const hide = event => { if (!event.persisted) stop(); };
    const show = event => { if (event.persisted && enabled) post('start'); };
    chrome.storage.local.get(['scriptEnabled'], result => { if (!closed && storageVersion === initialVersion) setEnabled(result.scriptEnabled !== false); });
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    return {store, stop};
}
