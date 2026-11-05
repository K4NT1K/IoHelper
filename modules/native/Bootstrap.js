// The site keeps its initial login response in React Query. Reading/subscribing to
// that existing cache sends no request and avoids losing a one-off bootstrap
// which finished before Axios discovery. Never invoke React hooks/query functions.
export function observeNativeBootstrap(document, receive) {
    for (const root of document.querySelectorAll('#app, #root')) {
        const key = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
        const container = key && root[key];
        const queue = [container?.stateNode?.current || container], seen = new Set();
        for (let i = 0; i < queue.length && i < 300; i++) {
            const fiber = queue[i]; if (!fiber || seen.has(fiber)) continue;
            seen.add(fiber);
            for (const name of ['client', 'value']) {
                const client = fiber.memoizedProps?.[name];
                if (typeof client?.getQueryCache !== 'function' || typeof client?.getQueryState !== 'function') continue;
                const cache = client.getQueryCache();
                if (typeof cache?.subscribe !== 'function') continue;
                let lastUpdate = 0;
                const read = () => {
                    const state = client.getQueryState(['auth', 'me']);
                    if (state?.status !== 'success' || !state.data || !Number.isFinite(state.dataUpdatedAt) || state.dataUpdatedAt <= lastUpdate) return;
                    lastUpdate = state.dataUpdatedAt;
                    receive(state.data, state.dataUpdatedAt);
                };
                const safeRead = () => { try { read(); } catch { /* Cache/schema changes must not affect the site. */ } };
                const unsubscribe = cache.subscribe(event => {
                    const k = event?.query?.queryKey;
                    if (Array.isArray(k) && k.length === 2 && k[0] === 'auth' && k[1] === 'me') safeRead();
                });
                safeRead();
                return unsubscribe;
            }
            if (fiber.child) queue.push(fiber.child);
            if (fiber.sibling) queue.push(fiber.sibling);
        }
    }
    return null;
}
