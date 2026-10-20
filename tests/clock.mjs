import assert from 'node:assert/strict';

export function clock(t) {
    let now = 1000000;
    let id = 0;
    const timers = new Map();
    t.mock.method(Date, 'now', () => now);
    t.mock.method(globalThis, 'setTimeout', (fn, ms = 0) => {
        timers.set(++id, {fn, at: now + ms});
        return id;
    });
    t.mock.method(globalThis, 'clearTimeout', key => timers.delete(key));
    const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    async function advance(ms) {
        const end = now + ms;
        await flush();
        for (;;) {
            const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > end) break;
            now = next[1].at;
            timers.delete(next[0]);
            next[1].fn();
            await flush();
        }
        now = end;
        await flush();
    }
    async function finish(promise, limit = 150) {
        let done = false;
        let error;
        promise.then(() => { done = true; }, e => { done = true; error = e; });
        await flush();
        for (let i = 0; !done && i < limit; i++) {
            const nextAt = Math.min(...[...timers.values()].map(timer => timer.at));
            assert(Number.isFinite(nextAt), 'Operation is stuck without a scheduled timer');
            await advance(nextAt - now);
        }
        assert(done, 'Pass did not finish within the bounded simulation');
        if (error) throw error;
    }
    return {advance, finish, flush, timers};
}

export function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return {promise, resolve};
}
