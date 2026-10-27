import {isAdminUrl} from '../BackgroundScheduler.js';
import {parseSteamId,validateRange} from './model.js';

export const ANALYTICS_TIMEOUT_MS=120000;
export class AnalyticsJobs {
    constructor(chrome) {
        this.chrome=chrome;this.queue=Promise.resolve();
        chrome.tabs.onRemoved?.addListener(tabId=>{void this.enqueue(()=>this.sourceClosed(tabId));});
    }
    enqueue(operation) {const result=this.queue.then(operation);this.queue=result.catch(()=>{});return result;}
    async get() {return (await this.chrome.storage.session.get('iohAnalyticsJob')).iohAnalyticsJob;}
    ui(sender) {
        try {const url=new URL(sender.url),expected=new URL(this.chrome.runtime.getURL('analytics.html'));return url.protocol===expected.protocol&&url.host===expected.host&&url.pathname==='/analytics.html';}catch{return false;}
    }
    async sourceMatches(job,sender) {
        if(!job||sender.tab?.id!==job.sourceTabId||!isAdminUrl(sender.url))return false;
        try {
            const tab=await this.chrome.tabs.get(job.sourceTabId);
            return isAdminUrl(tab.url)&&new URL(tab.url).origin===job.origin&&new URL(sender.url).origin===job.origin;
        }catch{return false;}
    }
    async stop(job) {
        if(job?.sourceTabId)try {await this.chrome.tabs.sendMessage(job.sourceTabId,{action:'analyticsCancelWorker',nonce:job.nonce});}catch{/* Original tab may have closed. */}
        await this.chrome.alarms.clear('ioh-analytics-timeout');
    }
    handle(request,sender) {return this.enqueue(()=>this.process(request,sender));}
    async process(request,sender) {
        if(request.action==='analyticsStart')return this.start(request,sender);
        const job=await this.get();
        if(request.action==='analyticsStatus')return this.ui(sender)?{success:true,job}:{success:false};
        if(request.action==='analyticsAcknowledge'&&this.ui(sender)&&job?.id===request.jobId&&job.status==='complete') {
            const metadata={...job};delete metadata.result;
            await this.chrome.storage.session.set({iohAnalyticsJob:metadata});return {success:true};
        }
        if(request.action==='analyticsClear'&&this.ui(sender)) {
            if(job&&['running','queued'].includes(job.status))throw new Error('Сначала завершите или отмените сбор');
            await this.chrome.storage.session.remove('iohAnalyticsJob');return {success:true};
        }
        if(request.action==='analyticsCancel') {
            if(!this.ui(sender)||!job||request.jobId!==job.id)return {success:false};
            await this.chrome.storage.session.set({iohAnalyticsJob:{...job,status:'cancelled',stage:'Сбор отменён'}});
            await this.stop(job);return {success:true};
        }
        if(!job||!['queued','running'].includes(job.status)||request.nonce!==job.nonce||!await this.sourceMatches(job,sender))return {success:false};
        if(request.action==='analyticsProgress')await this.chrome.storage.session.set({iohAnalyticsJob:{...job,status:'running',stage:String(request.stage||'').slice(0,120)}});
        if(request.action==='analyticsResult'||request.action==='analyticsFailure') {
            const result=request.result;
            if(result&&(result.steamId!==job.steamId||!result.coverage||JSON.stringify(result).length>8000000)) {
                await this.chrome.storage.session.set({iohAnalyticsJob:{...job,status:'failed',stage:'Ошибка',error:'Ответ сборщика некорректен или превышает допустимый размер'}});
                await this.stop(job); return {success:false,error:'Некорректный ответ сборщика'};
            }
            await this.chrome.storage.session.set({iohAnalyticsJob:{...job,status:result?'complete':'failed',result,stage:result?'Готово':'Ошибка',error:String(request.error||'').slice(0,300)}});
            await this.stop(job);
        }
        return {success:true};
    }
    async start(request,sender) {
        if(!this.ui(sender)||!parseSteamId(request.steamId)||!validateRange(request.range))throw new Error('Некорректный профиль или период');
        const previous=await this.get();
        if(previous&&['running','queued'].includes(previous.status)&&Date.now()-previous.startedAt<ANALYTICS_TIMEOUT_MS)throw new Error('Сбор уже выполняется. Дождитесь завершения или отмените его.');
        await this.stop(previous);
        const tabs=await this.chrome.tabs.query({url:['https://io.cybershoke.net/*','https://io.cybershoke.ru/*']});
        const candidates=tabs.filter(tab=>isAdminUrl(tab.url)&&!tab.discarded&&!/^#ioh-(analytics|schedule)=/.test(new URL(tab.url).hash))
            .sort((a,b)=>Number(b.active)-Number(a.active)||(b.lastAccessed||0)-(a.lastAccessed||0));
        let source, busy = false;
        for(const tab of candidates)try {
            const pong=await this.chrome.tabs.sendMessage(tab.id,{action:'analyticsPing'});
            if(pong?.success&&pong.version===2&&pong.profileMetadata===1){
                if(pong.busy){busy=true;continue;}
                source=tab;break;
            }
        }catch{/* Old extension content scripts need a page refresh. */}
        if(!source)throw new Error(busy?'Админка уже получает данные. Дождитесь завершения текущего сбора и повторите.':candidates.length?'Обновите открытую страницу админки после установки расширения и повторите сбор.':'Сначала откройте админку и войдите в аккаунт.');
        const nonce=crypto.randomUUID();
        const job={id:nonce,nonce,steamId:request.steamId,range:request.range,sourceTabId:source.id,origin:new URL(source.url).origin,
            status:'queued',startedAt:Date.now(),stage:'Подключение к API админки'};
        await this.chrome.storage.session.set({iohAnalyticsJob:job});
        await this.chrome.alarms.create('ioh-analytics-timeout',{when:Date.now()+ANALYTICS_TIMEOUT_MS});
        try {
            const response=await this.chrome.tabs.sendMessage(source.id,{action:'analyticsCollect',nonce,steamId:job.steamId,range:job.range});
            if(!response?.success)throw new Error('Вкладка не приняла запрос');
        }catch {
            await this.chrome.storage.session.set({iohAnalyticsJob:{...job,status:'failed',error:'Не удалось подключиться к API. Обновите админку и повторите сбор.'}});
            await this.stop(job);throw new Error('Не удалось подключиться к API. Обновите админку и повторите сбор.');
        }
        return {success:true,jobId:job.id};
    }
    expire() {return this.enqueue(()=>this.expireCurrent());}
    async expireCurrent() {
        const job=await this.get();
        if(!job||!['queued','running'].includes(job.status)||Date.now()-job.startedAt<ANALYTICS_TIMEOUT_MS)return;
        await this.chrome.storage.session.set({iohAnalyticsJob:{...job,status:'failed',error:'Сайт не завершил запросы статистики. Обновите админку и повторите сбор.'}});
        await this.stop(job);
    }
    async sourceClosed(tabId) {
        const job=await this.get();
        if(job?.sourceTabId!==tabId||!['queued','running'].includes(job.status))return;
        await this.chrome.storage.session.set({iohAnalyticsJob:{...job,status:'failed',error:'Исходная вкладка админки была закрыта'}});
        await this.chrome.alarms.clear('ioh-analytics-timeout');
    }
}
