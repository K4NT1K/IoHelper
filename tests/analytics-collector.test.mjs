import test from 'node:test';
import assert from 'node:assert/strict';
import {clock} from './clock.mjs';
import {startAnalyticsCollector} from '../modules/analytics/Collector.js';
const steamId='76561199163023778',nonce='12345678-abcd-1234-abcd-123456789abc',range={start:'2026-10-01',end:'2026-10-03'};
function fakeClock(t) {
    const c=clock(t),clockNow=Date.now;
    Date.now=()=>Date.parse('2026-10-26T12:00Z')+clockNow();return c;
}
function fixture() {
    const win=new EventTarget();win.location={origin:'https://io.cybershoke.net'};const posts=[],sent=[],listeners=new Set();
    win.postMessage=data=>posts.push(data);
    const chrome={runtime:{onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendMessage:async request=>{sent.push(request);return {success:true};}}};
    const dispatch=request=>{const responses=[];const keepAlive=[...listeners][0](request,{},value=>responses.push(value));return {responses,keepAlive};};
    const call=request=>dispatch(request).responses[0];
    const emit=(data,origin=win.location.origin)=>{const event=new Event('message');Object.assign(event,{source:win,origin,data:{channel:'ioh-analytics-response-v2',nonce,...data}});win.dispatchEvent(event);};
    startAnalyticsCollector(chrome,win,{});
    return {win,posts,sent,call,dispatch,emit,cleanup:()=>win.dispatchEvent(new Event('pagehide'))};
}
test('Collector relay: registers on normal admin tab and sends one semantic request, no native UI',()=>{
    const s=fixture();assert.deepEqual(s.call({action:'analyticsPing'}),{success:true,version:2,scheduleNative:1,profileMetadata:1,busy:false});
    assert.deepEqual(s.call({action:'analyticsCollect',steamId,nonce,range}),{success:true});
    assert.deepEqual(s.posts[0],{channel:'ioh-analytics-request-v2',type:'collect',nonce,steamId,range});
    s.emit({type:'result',result:{steamId,coverage:{}}});assert.equal(s.sent[0].action,'analyticsResult');s.cleanup();
});
test('Collector relay: foreign source/nonce ignored, cancellation suppresses late reply',()=>{
    const s=fixture();s.call({action:'analyticsCollect',steamId,nonce,range});
    s.emit({type:'result',nonce:'foreign',result:{} });s.emit({type:'result',result:{}},'https://evil.example');assert.equal(s.sent.length,0);
    s.call({action:'analyticsCancelWorker',nonce});s.emit({type:'result',result:{}});assert.deepEqual(s.sent,[{action:'iohClientReady'}]);assert.equal(s.posts.at(-1).type,'cancel');s.cleanup();
});
test('Collector relay: missing MAIN response has bounded timeout and cleanup',async t=>{
    const c=fakeClock(t),s=fixture();
    s.call({action:'analyticsCollect',steamId,nonce,range});await c.advance(120000);
    assert.equal(s.sent[0].action,'analyticsFailure');assert.equal(s.sent.at(-1).action,'iohClientReady');assert.equal(s.posts.at(-1).type,'cancel');s.cleanup();
});

test('Roster relay: one bounded async reply, no navigation; analytics and schedule share busy slot',()=>{
    const s=fixture(),run=s.dispatch({action:'scheduleCollectNative',nonce,url:'/moderation/ban/add'});
    assert.equal(run.keepAlive,true);assert.equal(run.responses.length,0);
    assert.deepEqual(s.posts[0],{channel:'ioh-analytics-request-v2',type:'roster',nonce});
    assert.equal(s.call({action:'analyticsPing'}).busy,true);
    assert.equal(s.call({action:'analyticsCollect',nonce,steamId,range}).code,'BUSY');
    const result={days:[{day:0,members:[]}],fetchedAt:1};
    s.emit({type:'result',nonce:'foreign',result});s.emit({type:'result',result},'https://evil.example');assert.equal(run.responses.length,0);
    s.emit({type:'result',result});s.emit({type:'result',result});assert.deepEqual(run.responses,[{success:true,result}]);
    assert.equal(s.call({action:'analyticsPing'}).busy,false);assert.equal(s.sent.length,0);s.cleanup();
});

test('Roster relay: matching semantic cancel resolves once, late results ignored; no retry loop on errors',async t=>{
    const c=clock(t),s=fixture(),run=s.dispatch({action:'scheduleCollectNative',nonce});
    s.call({action:'scheduleCancelNative',nonce:'foreign'});s.call({action:'analyticsCancelWorker',nonce});assert.equal(run.responses.length,0);
    s.call({action:'scheduleCancelNative',nonce});s.emit({type:'result',result:{}});assert.equal(run.responses[0].success,false);assert.equal(s.sent.length,0);
    const timed=s.dispatch({action:'scheduleCollectNative',nonce});await c.advance(120000);
    assert.equal(timed.responses[0].success,false);assert.match(timed.responses[0].error,/не ответил/);assert.equal(s.sent.length,0);s.cleanup();
});

test('Console roster export relay reads cached config only, independent of analytics collection',async()=>{
    const s=fixture();s.call({action:'analyticsCollect',steamId,nonce,range});
    const event=new Event('message');Object.assign(event,{source:s.win,origin:s.win.location.origin,data:{channel:'ioh-moderator-config-request-v1',nonce,action:'requestScheduleScan'}});s.win.dispatchEvent(event);
    await Promise.resolve();assert.deepEqual(s.sent,[{action:'getModeratorConfig'}]);
    assert.equal(s.posts.at(-1).channel,'ioh-moderator-config-response-v1');assert.equal(s.posts.at(-1).nonce,nonce);assert.equal(s.call({action:'analyticsPing'}).busy,true);s.cleanup();
});
