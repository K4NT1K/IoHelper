import test from 'node:test';
import assert from 'node:assert/strict';
import {AnalyticsJobs,ANALYTICS_TIMEOUT_MS} from '../modules/analytics/AnalyticsJobs.js';
function setup() {
    const state={},tabs=new Map([[1,{id:1,active:true,url:'https://io.cybershoke.net/support/tickets'}]]),messages=[];
    const chrome={runtime:{getURL:path=>'chrome-extension://test/'+path},storage:{session:{get:async()=>structuredClone(state),set:async data=>Object.assign(state,structuredClone(data)),remove:async key=>delete state[key]}},
        tabs:{query:async()=>[...tabs.values()],get:async id=>tabs.get(id),sendMessage:async(id,data)=>{messages.push({id,...data});return data.action==='analyticsPing'?{success:true,version:2,profileMetadata:1}:{success:true};},
            create:()=>assert.fail('Statistics must not open a tab'),update:()=>assert.fail('Statistics must not navigate'),remove:()=>assert.fail('Statistics must not close user tabs')},
        alarms:{create:async()=>{},clear:async()=>{}}};
    return {jobs:new AnalyticsJobs(chrome),state,tabs,messages};
}
const ui={url:'chrome-extension://test/analytics.html'};
const request={action:'analyticsStart',steamId:'76561199163023778',range:{start:'2026-10-01',end:'2026-10-03'}};
test('API jobs: existing admin tab only, no navigation; concurrent starts rejected',async()=>{
    const s=setup();await assert.rejects(s.jobs.handle(request,{url:'https://io.cybershoke.net/'}));
    await assert.rejects(s.jobs.handle(request,{url:'chrome-extension://foreign/analytics.html'}));
    const result=await s.jobs.handle(request,ui),job=s.state.iohAnalyticsJob;
    assert.equal(result.jobId,job.id);assert.equal(job.sourceTabId,1);assert.equal(s.tabs.size,1);
    assert.equal(s.messages.filter(m=>m.action==='analyticsCollect').length,1);
    await assert.rejects(s.jobs.handle(request,ui),/уже выполняется/);
});
test('API jobs: foreign tab/nonce rejected and cancelled job cannot receive a late result',async()=>{
    const s=setup();await s.jobs.handle(request,ui);
    const job=s.state.iohAnalyticsJob,sender={tab:{id:1},url:s.tabs.get(1).url};
    const result={action:'analyticsResult',nonce:job.nonce,result:{steamId:job.steamId,coverage:{}}};
    assert.equal((await s.jobs.handle(result,{...sender,tab:{id:2}})).success,false);
    assert.equal((await s.jobs.handle({...result,nonce:'wrong'},sender)).success,false);
    await s.jobs.handle({action:'analyticsCancel',jobId:job.id},ui);
    assert.equal((await s.jobs.handle(result,sender)).success,false);assert.equal(s.state.iohAnalyticsJob.status,'cancelled');
    assert.ok(s.messages.some(m=>m.action==='analyticsCancelWorker'&&m.nonce===job.nonce));
});
test('API jobs: missing/newly outdated content script fails fast with refresh instruction',async()=>{
    const s=setup();s.jobs.chrome.tabs.sendMessage=async()=>undefined;
    await assert.rejects(s.jobs.handle(request,ui),/Обновите открытую страницу/);
    assert.equal(s.state.iohAnalyticsJob,undefined);
});
test('API jobs: missing metadata capability and busy roster collector cannot silently start a profile',async()=>{
    const s=setup();s.jobs.chrome.tabs.sendMessage=async()=>({success:true,version:2});
    await assert.rejects(s.jobs.handle(request,ui),/Обновите открытую страницу/);
    s.jobs.chrome.tabs.sendMessage=async()=>({success:true,version:2,profileMetadata:1,busy:true});
    await assert.rejects(s.jobs.handle(request,ui),/Дождитесь завершения/);
    assert.equal(s.state.iohAnalyticsJob,undefined);
});
test('API jobs: timeout and closed source tab fail without touching user navigation',async()=>{
    const s=setup();await s.jobs.handle(request,ui);s.state.iohAnalyticsJob.startedAt-=ANALYTICS_TIMEOUT_MS+1;
    await s.jobs.expire();assert.equal(s.state.iohAnalyticsJob.status,'failed');
    await s.jobs.handle(request,ui);await s.jobs.sourceClosed(1);assert.equal(s.state.iohAnalyticsJob.status,'failed');
});
test('API jobs: acknowledgement removes temporary records after dashboard receipt',async()=>{
    const s=setup();await s.jobs.handle(request,ui);const job=s.state.iohAnalyticsJob;
    await s.jobs.handle({action:'analyticsResult',nonce:job.nonce,result:{steamId:job.steamId,coverage:{}}},{tab:{id:1},url:s.tabs.get(1).url});
    assert.ok(s.state.iohAnalyticsJob.result);
    await s.jobs.handle({action:'analyticsAcknowledge',jobId:job.id},ui);assert.equal(s.state.iohAnalyticsJob.result,undefined);
});
test('API jobs: oversized collector result fails immediately instead of waiting for timeout',async()=>{
    const s=setup();await s.jobs.handle(request,ui);const job=s.state.iohAnalyticsJob;
    const result=await s.jobs.handle({action:'analyticsResult',nonce:job.nonce,result:{steamId:job.steamId,coverage:{},extra:'x'.repeat(8000000)}},
        {tab:{id:1},url:s.tabs.get(1).url});
    assert.equal(result.success,false);assert.equal(s.state.iohAnalyticsJob.status,'failed');
    assert.equal(s.state.iohAnalyticsJob.result,undefined);
    assert.ok(s.messages.some(m=>m.action==='analyticsCancelWorker'));
});
