import {markIoh, isIohNode} from '../shared/dom.js';

export class ProfileLauncher {
    constructor({document, chrome}) {this.document = document; this.chrome = chrome;}
    sync() {
        const root=this.document.querySelector('main');
        if(this.href===location.href && this.root===root)return;
        this.href=location.href;this.root=root;this.refresh();
    }
    refresh() {
        this.stop();
        if (!/^\/moderator\/profile\/7656119\d{10}$/.test(location.pathname)) return;
        const root = this.document.querySelector('main');
        if (!root) return;
        const render = () => {
            if (!/^\/moderator\/profile\/(7656119\d{10})$/.test(location.pathname)) return;
            const steamId = location.pathname.split('/').at(-1);
            const native = [...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='Статистика' && !b.closest('[aria-hidden="true"]'));
            if (!native) return;
            const existing=native.parentElement.querySelector('.ioh-analytics-launch');
            if(existing){existing.dataset.steamId=steamId;return;}
            const button = markIoh(this.document.createElement('button'));
            const peer=[...native.parentElement.querySelectorAll(':scope > button')].find(item=>item!==native&&!item.hasAttribute('data-ioh'));
            button.className = (peer?.className || native.className) + ' ioh-analytics-launch'; button.type = 'button';
            button.dataset.steamId=steamId;
            button.setAttribute('aria-label','Открыть аналитику модератора IoHelper в новой вкладке');
            button.title='Подробная статистика и сравнение модераторов';
            button.innerHTML='<span class="ioh-analytics-launch__icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16M8 15v-4m5 4V7m5 8v-6"/></svg></span><span class="ioh-analytics-launch__label">Аналитика IoHelper</span><svg class="ioh-analytics-launch__arrow" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>';
            button.querySelectorAll('*').forEach(markIoh);
            button.addEventListener('click', ()=>this.chrome.runtime.sendMessage({action:'openAnalytics', steamId:button.dataset.steamId}));
            native.parentElement.append(button);
        };
        this.observer = new MutationObserver(mutations=>{
            if (mutations.every(m=>isIohNode(m.target)||[...m.addedNodes,...m.removedNodes].every(isIohNode))) return;
            if (this.raf) return;
            this.raf = requestAnimationFrame(()=>{this.raf=null;render();});
        });
        this.observer.observe(root,{childList:true,subtree:true}); render();
    }
    stop() {this.observer?.disconnect(); if(this.raf) cancelAnimationFrame(this.raf); this.raf=null;}
}
