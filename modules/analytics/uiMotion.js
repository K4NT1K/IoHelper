/** Subtle depth follows the pointer only when the device and motion preference allow it. */
export function bindDepthMotion(root, signal) {
    if (!root || !signal) return;
    const allowed = () => matchMedia('(hover:hover) and (pointer:fine)').matches && !matchMedia('(prefers-reduced-motion:reduce)').matches;
    let active, frame, point;
    const reset = () => {
        if (!active) return;
        for (const key of ['--tilt-x', '--tilt-y', '--light-x', '--light-y']) active.style.removeProperty(key);
        active.removeAttribute('data-depth-active'); active = null;
    };
    root.addEventListener('pointermove', event => {
        if (!allowed()) { reset(); return; }
        const card = event.target.closest?.('[data-depth]');
        if (!card || !root.contains(card)) { reset(); return; }
        if (active !== card) { reset(); active = card; }
        point = {x:event.clientX, y:event.clientY};
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = null; if (!active || !point || signal.aborted) return;
            const rect = active.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (point.x - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (point.y - rect.top) / rect.height));
            active.style.setProperty('--tilt-x', ((.5-y)*3).toFixed(2)+'deg');
            active.style.setProperty('--tilt-y', ((x-.5)*4).toFixed(2)+'deg');
            active.style.setProperty('--light-x', (x*100).toFixed(1)+'%');
            active.style.setProperty('--light-y', (y*100).toFixed(1)+'%');
            active.setAttribute('data-depth-active', '');
        });
    }, {signal, passive:true});
    root.addEventListener('pointerout', event => {
        if (active && !(event.relatedTarget instanceof Node && active.contains(event.relatedTarget))) reset();
    }, {signal, passive:true});
    signal.addEventListener('abort', () => { cancelAnimationFrame(frame); reset(); }, {once:true});
}
