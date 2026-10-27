import test from 'node:test';
import assert from 'node:assert/strict';
import {clock,deferred} from './clock.mjs';
import {clientExports,collectNativeProfile,collectNativeRoster,findNativeClient,HISTORY_START,NATIVE_READ_TIMEOUT,readOperation,rosterDayOperation} from '../modules/analytics/NativeApi.js';
import {installNativeReadBridge} from '../modules/analytics/SiteReadBridge.js';
import {sanitizeResponse} from '../modules/analytics/schema.js';
const steamId='76561199163023778',now=Date.parse('2026-10-26T12:00Z'),range={start:'2026-10-01',end:'2026-10-03'};
const reply=path=>path.endsWith('postprofile')?{data:{name:'Moderator'},history_tickets:[{year:2026,month:10,day:1,count:3}],history_reports:[]}:
    path.endsWith('/list/bans')?[{bid:1,created:1757188947,reason:'Reason_Ban_Cheat',ip:'private',name:'private',RemoveType:null}]:
    path.endsWith('/list/comms')?[]:{prime_list:[{unixtime_on_prime:1767625224,unixtime_out_prime:1767628824}]};
function fakeClock(t) {const c=clock(t),read=Date.now;Date.now=()=>now+read();return c;}
function clientFixture() {const calls=[];return {calls,post:async(path,body,options)=>{calls.push({path,body,options});return {status:200,data:reply(path)};}};}
test('Native reads: fixed allowlist and one 2019→now interval, independent of displayed period',()=>{
    assert.equal(HISTORY_START,'2019-01-01');const ban=readOperation('bans',steamId,now),mute=readOperation('mutes',steamId,now);
    assert.equal(ban.path,'/moderation/profile/'+steamId+'/list/bans');assert.equal(mute.path,'/moderation/profile/'+steamId+'/list/comms');
    assert.equal(ban.body.get('date_start'),'1546290000');assert.equal(ban.body.get('date_end'),String(now/1000));
    assert.throws(()=>readOperation('/moderation/ban/add',steamId));assert.throws(()=>readOperation('bans','invalid'));
});
test('Native client discovery follows current static import/export names, never copies headers',async()=>{
    const origin='https://io.cybershoke.net',entry=origin+'/assets/current-app.js',shared=origin+'/assets/new-hash.js';
    const sources={[entry]:'import{api}from"./new-hash.js";import("./lazy-write-panel.js");',[shared]:'var RequestClient={};RequestClient.interceptors.request.use(()=>{});export{RequestClient as api}'};
    const client={post(){},interceptors:{},defaults:{baseURL:origin+'/api'}};const imports=[];
    const actual=await findNativeClient({origin,document:{querySelectorAll:()=>[{src:entry}]},fetchText:async url=>sources[url]||'',importModule:async url=>{imports.push(url);return {api:client};},signal:new AbortController().signal});
    assert.equal(actual,client);assert.deepEqual(imports,[shared]);assert.deepEqual(clientExports(sources[shared]),['api']);
});
test('Native collector: exactly four direct reads; minimal result and source-limited shifts',async()=>{
    const client=clientFixture();const result=await collectNativeProfile({client,steamId,range,now,signal:new AbortController().signal});
    assert.equal(client.calls.length,4);assert.equal(result.tickets[0].count,3);assert.equal(result.bans.length,1);
    assert.equal(result.coverage.bans.start,'2019-01-01');assert.equal(result.coverage.mutes.available,true);assert.equal(result.mutes.length,0);
    assert.equal(result.coverage.shifts.partial,true);assert.equal(result.coverage.shifts.sourceLimited,true);
    assert.equal('ip' in result.bans[0],false);assert.equal('name' in result.bans[0],false);
});
test('Native collector: 429 retries current read only, permission errors stay unavailable',async t=>{
    const c=fakeClock(t),client=clientFixture();let tries=0;
    const original=client.post;client.post=async(path,body,options)=>{
        if(path.endsWith('/list/bans')&&tries++===0)throw {status:429,_orig:{response:{headers:{'retry-after':'1'}}}};
        if(path.endsWith('/list/comms'))throw {status:403};
        return original(path,body,options);
    };
    let result;const operation=collectNativeProfile({client,steamId,range,now,signal:new AbortController().signal}).then(r=>result=r);
    await c.finish(operation);assert.equal(tries,2);assert.equal(result.coverage.bans.available,true);assert.equal(result.coverage.mutes.available,false);assert.match(result.coverage.mutes.error,/доступ/);
});
test('Native collector: abort stops subsequent calls and no native error config escapes',async t=>{
    const c=fakeClock(t),controller=new AbortController();let calls=0;
    const client={post:(_path,_body,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject({message:'secret headers',config:{secret:'never return'}}),{once:true}));}};
    const operation=collectNativeProfile({client,steamId,range,now,signal:controller.signal});const rejected=assert.rejects(operation,/Сбор отменён/);
    await c.flush();controller.abort();await rejected;assert.equal(calls,1);
});
test('Native collector: 15-second request timeout is bounded without turning failures into zeros',async t=>{
    const c=fakeClock(t);let calls=0;
    const client={post:(_path,_body,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}};
    const operation=assert.rejects(collectNativeProfile({client,steamId,range,now,signal:new AbortController().signal}),/не предоставил статистику/);
    await c.finish(operation);assert.equal(calls,4);assert.equal(NATIVE_READ_TIMEOUT,15000);
});
test('MAIN bridge: foreign origin and arbitrary commands ignored; cancellation cannot emit late result',async t=>{
    const c=fakeClock(t),win=new EventTarget(),responses=[];win.location={origin:'https://io.cybershoke.net'};win.postMessage=data=>responses.push(data);
    const pending=deferred();let calls=0;const client={post:async()=>{calls++;return pending.promise;},interceptors:{},defaults:{baseURL:win.location.origin+'/api'}};
    installNativeReadBridge({window:win,document:{querySelectorAll:()=>[{src:win.location.origin+'/main.js'}]},fetchText:async()=> 'var C={};C.interceptors.request.use(()=>{});export{C as api}',importModule:async()=>({api:client})});
    const nonce='12345678-abcd-1234-abcd-123456789abc';
    const emit=(data,origin=win.location.origin)=>{const event=new Event('message');Object.assign(event,{source:win,origin,data:{channel:'ioh-analytics-request-v2',nonce,steamId,range,...data}});win.dispatchEvent(event);};
    emit({type:'collect'},'https://evil.example');emit({type:'fetch',url:'/moderation/ban/add'});await c.flush();assert.equal(calls,0);
    emit({type:'collect',url:'/moderation/ban/add'});await c.flush();assert.equal(calls,1);
    emit({type:'cancel'});pending.resolve({status:200,data:reply('/moderation/postprofile')});await c.flush();
    assert.equal(responses.some(r=>r.type==='result'),false);win.dispatchEvent(new Event('pagehide'));
});

const rosterRow=(day,extra={})=>({steamid64:steamId,week_day:day,name:'Moderator',class:'Moderator Tier 1',avatar:'private',on_prime:1,...extra});
test('Roster: strict native day schema, literal class labels and profile class_name metadata only',()=>{
    for(let day=0;day<7;day++)assert.deepEqual(rosterDayOperation(day),{method:'GET',path:'/moderation/worktime/'+day});
    for(const day of [-1,7,'2',1.5,'../../ban/add'])assert.throws(()=>rosterDayOperation(day));
    const clean=sanitizeResponse('roster',[rosterRow(2)]);
    assert.deepEqual(clean,{members:[{steamId,name:'Moderator',className:'Moderator Tier 1',day:2}]});
    for(const invalid of [{week_day:7},{week_day:'2'},{steamid64:'bad'},{name:''},{class:null}])assert.equal(sanitizeResponse('roster',[rosterRow(2),rosterRow(2,invalid)]),null);
    assert.equal(sanitizeResponse('roster',{error:'forbidden'}),null);
    assert.deepEqual(sanitizeResponse('roster',[]),{members:[]});
    const profile=sanitizeResponse('profile',{data:{name:'Moderator',class_name:'Senior Moderator',class:'MODER-SENIOR',auth:'never'},history_tickets:[],history_reports:[]});
    assert.equal(profile.className,'Senior Moderator');assert.equal('class' in profile,false);assert.equal('auth' in profile,false);
});

test('Roster: exactly seven GET reads, atomically sanitized complete week without UI or profile calls',async()=>{
    const calls=[],client={get:async(path,options)=>{calls.push({path,options});const day=Number(path.at(-1));return {status:200,data:[rosterRow(day),rosterRow(day)]};},post:()=>assert.fail('No profile or moderation POST')};
    const result=await collectNativeRoster({client,signal:new AbortController().signal,now});
    assert.equal(result.fetchedAt,now);assert.equal(calls.length,7);assert.deepEqual(result.days.map(d=>d.day),[0,1,2,3,4,5,6]);
    assert(result.days.every(d=>d.members.length===1));assert.deepEqual(result.days[0].members,[{steamId,name:'Moderator',className:'Moderator Tier 1'}]);
    assert(calls.every(c=>c.options.timeout===15000));assert.equal(JSON.stringify(result).includes('on_prime'),false);
});

test('Roster: malformed/mismatched days or conflicting member metadata reject the entire week',async()=>{
    for(const mode of ['invalid','wrongDay','permission','conflict']) {
        const calls=[],client={get:async path=>{const day=Number(path.at(-1));calls.push(day);if(day===3&&mode==='permission')throw {status:403};return {status:200,data:[rosterRow(day,day===3?(mode==='invalid'?{steamid64:'invalid'}:mode==='wrongDay'?{week_day:2}:mode==='conflict'?{class:'Moderator Tier 2'}:{}):{})]};}};
        await assert.rejects(collectNativeRoster({client,signal:new AbortController().signal,now}));assert.deepEqual(calls,[0,1,2,3]);
    }
});

test('Roster: abort prevents remaining days and does not leak native errors',async()=>{
    const controller=new AbortController(),calls=[],client={get:async path=>{calls.push(path);controller.abort();return {status:200,data:[rosterRow(0)]};}};
    await assert.rejects(collectNativeRoster({client,signal:controller.signal,now}),/Сбор отменён/);assert.equal(calls.length,1);
});

test('MAIN roster bridge: semantic allowlist ignores arbitrary URL/body; foreign requests cannot start collection',async t=>{
    const c=fakeClock(t),win=new EventTarget(),responses=[],calls=[];win.location={origin:'https://io.cybershoke.net'};win.postMessage=data=>responses.push(data);
    const client={get:async path=>{calls.push(path);return {status:200,data:[rosterRow(Number(path.at(-1)))]};},post:()=>assert.fail('Roster cannot issue POST'),interceptors:{},defaults:{baseURL:win.location.origin+'/api'}};
    installNativeReadBridge({window:win,document:{querySelectorAll:()=>[{src:win.location.origin+'/main.js'}]},fetchText:async()=> 'var C={};C.interceptors.request.use(()=>{});export{C as api}',importModule:async()=>({api:client})});
    const nonce='12345678-abcd-1234-abcd-123456789abc';
    const emit=(extra,origin=win.location.origin)=>{const event=new Event('message');Object.assign(event,{source:win,origin,data:{channel:'ioh-analytics-request-v2',type:'roster',nonce,...extra}});win.dispatchEvent(event);};
    emit({},'https://evil.example');emit({nonce:'bad'});await c.flush();assert.equal(calls.length,0);
    emit({url:'/moderation/ban/add',method:'POST',body:{steamid64:'private'}});await c.flush();
    assert.deepEqual(calls,[0,1,2,3,4,5,6].map(day=>'/moderation/worktime/'+day));
    assert.equal(responses.find(r=>r.type==='result').result.days.length,7);win.dispatchEvent(new Event('pagehide'));
});

test('MAIN console export: reads cached config only; singleflight, nonce/origin guards and bounded cleanup',async t=>{
    const c=fakeClock(t),win=new EventTarget(),posts=[];win.location={origin:'https://io.cybershoke.net'};win.crypto=crypto;win.postMessage=data=>posts.push(data);
    installNativeReadBridge({window:win,document:{querySelectorAll:()=>assert.fail('Cached export must not discover native API')},fetchText:()=>assert.fail('No network'),importModule:()=>assert.fail('No import')});
    const first=win.ioHelperModerators();assert.equal(win.ioHelperModerators(),first);assert.equal(posts.length,1);const request=posts[0];
    const emit=(data,origin=win.location.origin)=>{const event=new Event('message');Object.assign(event,{source:win,origin,data});win.dispatchEvent(event);};
    const response={success:true,moderators:{Tier:{'Tier 1':{[steamId]:'Moderator'}}},snapshot:{count:1}};
    emit({channel:'ioh-moderator-config-response-v1',nonce:request.nonce,response},'https://evil.example');emit({channel:'ioh-moderator-config-response-v1',nonce:'foreign',response});
    emit({channel:'ioh-moderator-config-response-v1',nonce:request.nonce,response});assert.deepEqual(await first,response);
    const timed=assert.rejects(win.ioHelperModerators(),/не ответило/);await c.advance(5000);await timed;
    win.dispatchEvent(new Event('pagehide'));assert.equal(win.ioHelperModerators,undefined);
});
