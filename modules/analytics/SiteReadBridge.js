import {collectNativeProfile,collectNativeRoster,findNativeClient} from './NativeApi.js';
import {parseSteamId,validateRange} from './model.js';

export function installNativeReadBridge({window,document,fetchText,importModule}) {
    if(window.__iohNativeReadBridgeV2)return;
    window.__iohNativeReadBridgeV2=true;
    let active=null,clientPromise=null,configRequest=null;
    const emit=(nonce,type,extra={})=>window.postMessage({channel:'ioh-analytics-response-v2',nonce,type,...extra},window.location.origin);
    const configExport=()=>{
        if(configRequest)return configRequest.promise;
        const nonce=window.crypto.randomUUID();
        let resolve,reject;
        const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
        const timer=setTimeout(()=>{
            if(configRequest?.nonce!==nonce)return;
            configRequest=null;reject(new Error('Расширение не ответило. Обновите страницу админки.'));
        },5000);
        configRequest={nonce,promise,timer,resolve,reject};
        window.postMessage({channel:'ioh-moderator-config-request-v1',nonce},window.location.origin);
        return promise;
    };
    window.ioHelperModerators=configExport;
    const listener=event=>{
        if(event.source!==window||event.origin!==window.location.origin)return;
        if(event.data?.channel==='ioh-moderator-config-response-v1') {
            if(!configRequest||event.data.nonce!==configRequest.nonce)return;
            const request=configRequest;configRequest=null;clearTimeout(request.timer);
            const response=event.data.response;
            if(response?.success)request.resolve(response);
            else request.reject(new Error(String(response?.error||'Не удалось прочитать список модераторов').slice(0,300)));
            return;
        }
        if(event.data?.channel!=='ioh-analytics-request-v2')return;
        const {nonce,type,steamId,range}=event.data;
        if(!/^[a-f0-9-]{16,64}$/.test(nonce||''))return;
        if(type==='cancel') {if(active?.nonce===nonce)active.controller.abort();return;}
        if(type!=='roster'&&(type!=='collect'||!parseSteamId(steamId)||!validateRange(range)))return;
        if(active){emit(nonce,'error',{error:'В этой вкладке уже выполняется сбор',code:'BUSY'});return;}
        const controller=new AbortController();
        active={nonce,controller};
        const run=async()=>{
            if(!clientPromise)clientPromise=findNativeClient({document,origin:window.location.origin,fetchText,importModule,signal:controller.signal}).catch(error=>{clientPromise=null;throw error;});
            const client=await clientPromise;
            if(controller.signal.aborted)return;
            const options={client,signal:controller.signal,progress:stage=>emit(nonce,'progress',{stage})};
            const result=type==='roster'?await collectNativeRoster(options):await collectNativeProfile({...options,steamId,range});
            if(!controller.signal.aborted)emit(nonce,'result',{result});
        };
        void run().catch(error=>{if(!controller.signal.aborted)emit(nonce,'error',{error:error.message||'Не удалось получить статистику'});})
            .finally(()=>{if(active?.nonce===nonce)active=null;});
    };
    window.addEventListener('message',listener);
    window.addEventListener('pagehide',()=>{
        active?.controller.abort();window.removeEventListener('message',listener);
        if(configRequest){clearTimeout(configRequest.timer);configRequest.reject(new Error('Страница админки была закрыта'));configRequest=null;}
        if(window.ioHelperModerators===configExport)delete window.ioHelperModerators;
    },{once:true});
}

if(typeof window!=='undefined'&&['io.cybershoke.net','io.cybershoke.ru'].includes(window.location.hostname)) {
    const nativeFetch=window.fetch.bind(window);
    installNativeReadBridge({window,document,
        fetchText:async(url,signal)=>{
            const response=await nativeFetch(url,{signal,cache:'force-cache'});
            if(!response.ok)throw new Error('Не удалось прочитать клиент сайта');
            return response.text();
        },importModule:url=>import(/* @vite-ignore */ url)});
}
