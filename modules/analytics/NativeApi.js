import {dayKey, dayStart, parseSteamId, validateRange,HISTORY_START} from './model.js';
import {sanitizeResponse} from './schema.js';

export {HISTORY_START} from './model.js';
export const NATIVE_READ_TIMEOUT = 15000;
const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if(signal?.aborted)return reject(new Error('Сбор отменён'));
    const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();};
    const timer=setTimeout(finish,ms);
    const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(new Error('Сбор отменён'));};
    signal?.addEventListener('abort',cancel,{once:true});
});

// Only semantic read operations are accepted. Caller cannot supply a URL, headers or request body.
export function readOperation(kind, steamId, now = Date.now()) {
    if(!parseSteamId(steamId))throw new Error('Некорректный SteamID64');
    const start=dayStart(HISTORY_START),end=Math.floor(now/1000);
    if(kind==='profile')return {path:'/moderation/postprofile',body:{profiledata:{steamid64:steamId,format_date:'day'}}};
    if(kind==='bans'||kind==='mutes')return {path:`/moderation/profile/${steamId}/list/${kind==='bans'?'bans':'comms'}`,
        body:new URLSearchParams({date_start:String(start),date_end:String(end)}),form:true};
    if(kind==='shifts')return {path:'/moderation/profile/prime/closed/list',body:{data:{steamid64:steamId,unixtimeFrom:start,unixtimeTo:end,zeroVisibility:'hidden'}}};
    throw new Error('Операция не поддерживается');
}

export function rosterDayOperation(day) {
    if(!Number.isInteger(day)||day<0||day>6)throw new Error('Некорректный день расписания');
    return {method:'GET',path:`/moderation/worktime/${day}`};
}

export function clientExports(source) {
    const symbols=[...source.matchAll(/\b([\w$]+)\.interceptors\.request\.use\s*\(/g)].map(m=>m[1]);
    const tail=source.match(/export\s*\{([^}]+)\}/g)?.join(',')||'';
    return symbols.flatMap(symbol=>{
        const escaped=symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        const alias=tail.match(new RegExp('(?:^|[,{\\s])'+escaped+'\\s+as\\s+([\\w$]+)'));
        return alias?[alias[1]]:tail.match(new RegExp('(?:^|[,{\\s])'+escaped+'(?:[,}\\s]|$)'))?[symbol]:[];
    });
}

export async function findNativeClient({document, origin, fetchText, importModule, signal}) {
    const entries=[...document.querySelectorAll('script[type="module"][src]')].map(s=>s.src).filter(src=>{
        try {const url=new URL(src);return url.origin===origin&&/\.js$/.test(url.pathname);}catch{return false;}
    });
    for(const entry of entries) {
        if(signal?.aborted)throw new Error('Сбор отменён');
        const source=await fetchText(entry,signal);
        // Static imports are already evaluated by the site's entry. No arbitrary lazy modules are initialized.
        const dependencies=[...source.matchAll(/\bfrom\s*["']([^"']+\.js)["']/g)].map(m=>new URL(m[1],entry).href);
        const candidates=[entry,...new Set(dependencies)].filter(url=>new URL(url).origin===origin).slice(0,40);
        for(let i=0;i<candidates.length;i+=4) {
            const batch=await Promise.all(candidates.slice(i,i+4).map(async url=>{
                try {
                    const text=url===entry?source:await fetchText(url,signal);
                    return {url,exports:clientExports(text)};
                }catch(error){if(signal?.aborted)throw error;return {url,exports:[]};}
            }));
            for(const candidate of batch)if(candidate.exports.length) {
                const module=await importModule(candidate.url);
                for(const key of candidate.exports) {
                    const client=module[key];
                    if(typeof client?.post!=='function'||!client?.interceptors)continue;
                    const base=new URL(client.defaults?.baseURL||'',origin);
                    if(base.origin===origin&&base.pathname.replace(/\/$/,'')==='/api')return client;
                }
            }
        }
    }
    throw new Error('Не найден штатный клиент API. Обновите страницу админки и повторите сбор.');
}

async function nativeRead(client, operation, signal, progress, kind) {
    for(let attempt=0;attempt<3;attempt++) {
        if(signal.aborted)throw new Error('Сбор отменён');
        const controller=new AbortController();
        const cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});
        const timer=setTimeout(cancel,NATIVE_READ_TIMEOUT);
        try {
            const options={signal:controller.signal,timeout:NATIVE_READ_TIMEOUT,
                ...(operation.form?{headers:{'Content-Type':'application/x-www-form-urlencoded'}}:{})};
            const response=operation.method==='GET'?await client.get(operation.path,options):await client.post(operation.path,operation.body,options);
            if(response.status<200||response.status>=300)throw Object.assign(new Error('Данные недоступны'),{status:response.status});
            const data=sanitizeResponse(kind,response.data);
            if(!data)throw new Error('Сайт не предоставил данные этого раздела');
            return data;
        } catch(error) {
            if(signal.aborted)throw new Error('Сбор отменён');
            const status=error.status||error.response?.status||error._orig?.response?.status;
            if(status===429&&attempt<2) {
                const headers=error.response?.headers||error._orig?.response?.headers;
                const retry=Number(headers?.get?.('Retry-After')??headers?.['retry-after'])||0;
                progress('Сайт ограничил частоту запросов. Ожидание перед повтором…');
                await sleep(Math.min(15000,Math.max(1500*2**attempt,retry*1000)),signal);
                continue;
            }
            if(controller.signal.aborted)throw new Error('Сайт не ответил за 15 секунд');
            if(status===401||status===403)throw new Error('Нет доступа к данным раздела или сессия истекла');
            if(status)throw new Error(`Не удалось получить раздел: HTTP ${status}`);
            // Do not forward native Axios errors/configs: they can contain request headers.
            throw new Error(error.message==='Сайт не предоставил данные этого раздела'?error.message:'Не удалось получить данные раздела');
        } finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);}
    }
}

export async function collectNativeProfile({client,steamId,range,signal,progress=()=>{},now=Date.now()}) {
    if(!parseSteamId(steamId)||!validateRange(range))throw new Error('Некорректный профиль или период');
    const today=dayKey(now/1000);
    const result={steamId,fetchedAt:now,coverage:{},tickets:[],reports:[],bans:[],mutes:[],shifts:[]};
    const labels={profile:'История закрытых жалоб',bans:'История банов',mutes:'История мутов',shifts:'Рабочее время'};
    for(const kind of ['profile','bans','mutes','shifts']) {
        progress(labels[kind]);
        try {
            const data=await nativeRead(client,readOperation(kind,steamId,now),signal,progress,kind);
            if(signal.aborted)throw new Error('Сбор отменён');
            if(kind==='profile') {
                Object.assign(result,data);
                for(const metric of ['tickets','reports'])result.coverage[metric]={available:true,scope:'История, доступная API сайта',start:HISTORY_START,end:today};
            } else {
                result[kind]=data.items;
                result.coverage[kind]={available:true,start:HISTORY_START,end:today,count:data.items.length,partial:!!data.truncated,scope:'Прямой ответ API сайта'};
                if(kind==='shifts') {
                    // The endpoint returned current-year rows even for a 2019-only test window.
                    // Requested boundaries therefore do not establish coverage for per-hour rankings.
                    const valid=data.items.filter(item=>Number.isFinite(item.start)&&Number.isFinite(item.end));
                    result.coverage.shifts={available:true,partial:true,sourceLimited:true,count:data.items.length,
                        start:valid.length?dayKey(Math.min(...valid.map(item=>item.start))):null,
                        end:valid.length?dayKey(Math.max(...valid.map(item=>item.end))):null,
                        scope:'Доступные закрытые сессии API; полнота периода не подтверждена'};
                }
            }
        } catch(error) {
            if(signal.aborted)throw new Error('Сбор отменён');
            const unavailable={available:false,error:error.message};
            if(kind==='profile')result.coverage.tickets=result.coverage.reports=unavailable;
            else result.coverage[kind]=unavailable;
        }
    }
    if(!Object.values(result.coverage).some(item=>item.available))throw new Error('Сайт не предоставил статистику. Проверьте вход и доступ к профилю.');
    return result;
}

export async function collectNativeRoster({client,signal,progress=()=>{},now=Date.now()}) {
    const days=[],union=new Map();
    for(let day=0;day<7;day++) {
        progress(`Расписание: день ${day+1} из 7`);
        const data=await nativeRead(client,rosterDayOperation(day),signal,progress,'roster');
        if(signal.aborted)throw new Error('Сбор отменён');
        if(data.members.some(member=>member.day!==day))throw new Error('Сайт вернул расписание другого дня');
        const members=new Map();
        for(const {steamId,name,className} of data.members) {
            const previous=members.get(steamId);
            const known=previous||union.get(steamId);
            if(known&&(known.name!==name||known.className!==className))throw new Error('Сайт вернул противоречивые данные модератора');
            members.set(steamId,{steamId,name,className});
            union.set(steamId,{steamId,name,className});
        }
        days.push({day,members:[...members.values()]});
    }
    // No partial result can leave MAIN: callers commit only this complete seven-day snapshot.
    return {days,fetchedAt:now};
}
