let database;
async function db() {
    if (!database) database = new Promise((resolve, reject) => {
        const request = indexedDB.open('ioh-analytics', 2);
        request.onupgradeneeded = () => {
            for (const name of ['aggregates', 'cohort']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, {keyPath: 'key'});
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return database;
}
export const cacheKey = (steamId, range, removed) => ['v2', steamId, range.start, range.end, removed].join('|');
export async function cacheRead(key) {
    const database = await db();
    return new Promise((resolve, reject) => {
        const request = database.transaction('aggregates').objectStore('aggregates').get(key);
        request.onsuccess = () => resolve(request.result?.value);
        request.onerror = () => reject(request.error);
    });
}
export async function cacheWrite(key, value) {
    const database = await db();
    await new Promise((resolve, reject) => {
        const tx = database.transaction('aggregates', 'readwrite');
        const store = tx.objectStore('aggregates');
        store.put({key, value});
        const request = store.getAll();
        request.onsuccess = () => request.result.sort((a, b) => b.value.fetchedAt - a.value.fetchedAt).slice(30).forEach(r => store.delete(r.key));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}
export async function cacheClear() {
    const database = await db();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(['aggregates', 'cohort'], 'readwrite');
        tx.objectStore('aggregates').clear(); tx.objectStore('cohort').clear();
        tx.oncomplete = () => {written = new WeakSet(); checkpointId = null; resolve();}; tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Не удалось очистить кэш'));
    });
}
let written = new WeakSet(), checkpointId = null;
export async function cohortWrite(state, {replace = false} = {}) {
    const database = await db();
    const {profiles, ...meta} = state;
    const runId = state.runId || state.startedAt;
    await new Promise((resolve, reject) => {
        const tx = database.transaction('cohort', 'readwrite'), store = tx.objectStore('cohort');
        let pending = [], changed = false, conflict;
        const request = store.get('meta');
        request.onsuccess = () => {
            const current = request.result?.value;
            const currentId = current && (current.runId || current.startedAt);
            if (!replace && ((current && currentId !== runId) || (!current && checkpointId !== null))) {
                conflict = new Error('Кэш сравнения изменён в другой вкладке. Сбор остановлен; запустите новое сравнение для замены.');
                tx.abort(); return;
            }
            changed = replace || checkpointId !== runId;
            if (replace) store.clear();
            store.put({key: 'meta', value: meta});
            pending = changed ? profiles : profiles.filter(profile => !written.has(profile));
            for (const profile of pending) store.put({key: profile.steamId, value: profile});
        };
        tx.oncomplete = () => {
            if (changed) written = new WeakSet(); checkpointId = runId;
            pending.forEach(p => written.add(p)); resolve();
        };
        tx.onerror = () => reject(tx.error); tx.onabort = () => reject(conflict || tx.error || new Error('Не удалось сохранить рейтинг'));
    });
}
export async function cohortRead() {
    const database = await db();
    return new Promise((resolve, reject) => {
        const request = database.transaction('cohort').objectStore('cohort').getAll();
        request.onsuccess = () => {
            const meta = request.result.find(row => row.key === 'meta')?.value;
            resolve(meta ? {...meta, profiles: request.result.filter(row => row.key !== 'meta').map(row => row.value)} : null);
        };
        request.onerror = () => reject(request.error);
    });
}
