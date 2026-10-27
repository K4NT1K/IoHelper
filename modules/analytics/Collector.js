import {parseSteamId,validateRange} from './model.js';

// Isolated-world relay on an existing admin tab. No native UI is clicked or navigated.
export function startAnalyticsCollector(chrome,window,document) {
    void document;
    let task=null,alive=true;
    const send=request=>chrome.runtime.sendMessage(request).catch(()=>{});
    const cancel=nonce=>window.postMessage({channel:'ioh-analytics-request-v2',type:'cancel',nonce},window.location.origin);
    const finish=(message,{notifyReady=true,notifyResult=true}={})=>{
        if(!task)return;
        const completed=task;clearTimeout(completed.timer);task=null;
        if(completed.kind==='roster')completed.respond(message);
        else {
            if(notifyResult)void send(message.success?{action:'analyticsResult',nonce:completed.nonce,result:message.result}
                :{action:'analyticsFailure',nonce:completed.nonce,error:message.error});
            if(notifyReady)void send({action:'iohClientReady'});
        }
    };
    const onPageMessage=event=>{
        if(event.source!==window||event.origin!==window.location.origin)return;
        if(event.data?.channel==='ioh-moderator-config-request-v1'&&/^[a-f0-9-]{16,64}$/.test(event.data.nonce||'')) {
            const nonce=event.data.nonce;
            void chrome.runtime.sendMessage({action:'getModeratorConfig'}).then(response=>{
                if(alive)window.postMessage({channel:'ioh-moderator-config-response-v1',nonce,response},window.location.origin);
            }).catch(()=>{if(alive)window.postMessage({channel:'ioh-moderator-config-response-v1',nonce,response:{success:false,error:'Не удалось прочитать локальный список модераторов'}},window.location.origin);});
            return;
        }
        if(!task||event.data?.channel!=='ioh-analytics-response-v2'||event.data.nonce!==task.nonce)return;
        const message=event.data;
        if(message.type==='progress'&&task.kind!=='roster')void send({action:'analyticsProgress',nonce:task.nonce,stage:String(message.stage||'').slice(0,120)});
        if(message.type==='result'||message.type==='error') {
            finish(message.type==='result'?{success:true,result:message.result}:{success:false,error:String(message.error||'Не удалось получить данные').slice(0,300),...(message.code==='BUSY'?{code:'BUSY'}:{})});
        }
    };
    const onRuntimeMessage=(request,_sender,respond)=>{
        if(request.action==='analyticsPing'){respond({success:true,version:2,scheduleNative:1,profileMetadata:1,busy:!!task});return;}
        if(request.action==='analyticsCancelWorker'||request.action==='scheduleCancelNative') {
            const kind=request.action==='scheduleCancelNative'?'roster':'profile';
            if(task?.nonce===request.nonce&&task.kind===kind){cancel(task.nonce);finish({success:false,error:'Сбор отменён'},{notifyResult:false});}
            respond({success:true});return;
        }
        const roster=request.action==='scheduleCollectNative';
        if(!roster&&request.action!=='analyticsCollect')return;
        if((!roster&&(!parseSteamId(request.steamId)||!validateRange(request.range)))||!/^[a-f0-9-]{16,64}$/.test(request.nonce||'')) {respond({success:false});return;}
        if(task){respond({success:false,code:'BUSY',error:'Вкладка уже собирает данные'});return;}
        task={nonce:request.nonce,kind:roster?'roster':'profile',respond};
        task.timer=setTimeout(()=>{
            if(task?.nonce!==request.nonce)return;
            cancel(task.nonce);finish({success:false,error:'Клиент сайта не ответил. Обновите админку и повторите сбор.'});
        },120000);
        window.postMessage({channel:'ioh-analytics-request-v2',type:roster?'roster':'collect',nonce:request.nonce,
            ...(!roster?{steamId:request.steamId,range:request.range}:{})},window.location.origin);
        // Roster replies use this one bounded runtime channel; profiles retain job progress/result RPC.
        if(roster)return true;
        respond({success:true});
    };
    window.addEventListener('message',onPageMessage);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    window.addEventListener('pagehide',()=>{
        alive=false;
        if(task){cancel(task.nonce);finish({success:false,error:'Исходная страница админки была закрыта или обновлена'},{notifyReady:false});}
        window.removeEventListener('message',onPageMessage);chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    },{once:true});
    return false;
}
