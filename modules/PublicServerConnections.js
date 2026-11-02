import {ServerConnectionMemory} from './ServerConnectionMemory.js';

// The public site only records connect intent; moderator services stay on io.*.
export async function startPublicServerConnections({document, window, chrome}) {
    const memory = new ServerConnectionMemory({document, chrome});
    let closed = false;
    const onHide = event => {
        if (event.persisted) return;
        closed = true;
        memory.stop();
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('pageshow', onShow);
    };
    const onShow = event => {if (event.persisted) void memory.refresh();};
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    try {
        const {scriptEnabled} = await chrome.storage.local.get('scriptEnabled');
        if (closed) return null;
        if (scriptEnabled === false) {
            onHide({persisted: false});
            return null;
        }
        await memory.start();
        return closed ? null : memory;
    } catch {
        onHide({persisted: false});
        return null;
    }
}
