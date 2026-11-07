import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageService} from '../modules/MessageService.js';
import {DOMCoordinator} from '../modules/DOMCoordinator.js';
import {App} from '../modules/App.js';
import {clock, deferred} from './clock.mjs';

test('Native HS excludes HSDM in category, mode or server label; missing/zero stats clear old decoration',()=>{
    let highlighted=true;
    const span={textContent:'HS: 100%',classList:{contains:()=>highlighted,toggle:(_name,value)=>{highlighted=value;}}};
    let data,serverText='DM';const server={get textContent(){return serverText;}};
    const row={querySelector:()=>({closest:()=>server}),querySelectorAll:s=>s==='span'?[span]:[]};
    const service=new MessageService({document:{},utils:{},badgeService:{},settings:{headshotPercentage:95}});
    service.ticketService={nativeData:{},getNativeRowTicket:()=>data};
    for(const record of [{mode:'PISTOLDM',category:'HSDM',kills:10,headshots:10},
        {mode:'hsdm',kills:10,headshots:10},{mode:'DM',kills:0,headshots:0},null]) {
        data=record;highlighted=true;service.highlightHighHs(row);assert.equal(highlighted,false);
    }
    data={mode:'DM',kills:10,headshots:10};service.highlightHighHs(row);assert.equal(highlighted,true);
    serverText='PISTOLDM (HSDM)';service.highlightHighHs(row);assert.equal(highlighted,false);
});

test('A batch of newly mounted complaint rows wakes tracking once; own/detached nodes do not',()=>{
    const table={},row={nodeType:1,isConnected:true,matches:s=>s==='tr',closest:s=>s==='table'?table:null};
    const own={...row,closest:s=>s==='[data-ioh]'?{}:table},detached={...row,isConnected:false};
    const wakes=[],app={document:{},_applyRowHighlights(){},onComplaintQueueRowsAdded:rows=>wakes.push(rows),
        ticketService:{isComplaintQueueTable:t=>t===table,pruneOffenderProjectCache(){}}};
    const coordinator=new DOMCoordinator(app);
    coordinator.handleComplaintQueueTableMutations([{target:{},addedNodes:[row,row,own,detached],removedNodes:[]}]);
    assert.deepEqual(wakes,[[row]]);
});

test('New complaints run targeted batches during the unchanged idle review pause',async t=>{
    const time=clock(t),pending=deferred();let passes=0,renders=0,arrivals=false;
    const app={...Object.fromEntries(['onComplaintQueueRowsAdded','restartOffenderTracking','runOffenderTrackingPass','scheduleNextOffenderInterval']
        .map(k=>[k,App.prototype[k]])),features:{trackOffenderServer:true},_offenderTrackingGeneration:0,
        window:{location:{href:'https://io.cybershoke.net/ticket/1'}},document:{hidden:false},isComplaintDetailPage:()=>false,getOffenderTrackIntervalSec:()=>30,
        ticketService:{renderNativeQueue:()=>renders++,queueOffenderTrackingRows:()=>{arrivals=true;},
            hasPendingOffenderTrackingRows:()=>arrivals,checkOffendersServers:(_ttl,options)=>{assert.equal(options.arrivalsOnly,true);arrivals=false;return ++passes===1?pending.promise:Promise.resolve();}}};
    app.scheduleNextOffenderInterval();assert.equal(time.timers.size,1);
    const deadline=[...time.timers.values()][0].at;
    app.onComplaintQueueRowsAdded();await time.flush();assert.equal(passes,1);assert.equal(time.timers.size,1);
    const generation=app._offenderTrackingGeneration;
    app.onComplaintQueueRowsAdded();app.onComplaintQueueRowsAdded();assert.equal(app._offenderTrackingGeneration,generation);
    pending.resolve();await time.flush();assert.equal(passes,2);assert.equal(time.timers.size,1);assert.equal(renders,3);
    assert.equal([...time.timers.values()][0].at,deadline);
    app.features.trackOffenderServer=false;app.onComplaintQueueRowsAdded();assert.equal(passes,2);
});

test('A populated queue and replacement tbody are observed and wake tracking without duplicate observers',t=>{
    const observers=[],before=globalThis.MutationObserver;t.after(()=>{globalThis.MutationObserver=before;});
    globalThis.MutationObserver=class {constructor(){observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}};
    let tbody;const table={querySelector:()=>tbody},wakes=[];
    const row={isConnected:true,nodeType:1,closest:s=>s==='table'?table:null};
    const app={document:{},onComplaintQueueRowsAdded:rows=>wakes.push(rows),ticketService:{isComplaintQueueTable:t=>t===table}};
    const coordinator=new DOMCoordinator(app);
    tbody={querySelectorAll:()=>[row]};coordinator.observeComplaintQueueTable(table);coordinator.observeComplaintQueueTable(table);
    assert.equal(observers.length,1);assert.deepEqual(wakes,[[row]]);
    tbody={querySelectorAll:()=>[row]};coordinator.observeComplaintQueueTable(table);
    assert.equal(observers[0].disconnected,true);assert.equal(observers[1].node,tbody);assert.equal(wakes.length,2);
    coordinator.teardownComplaintQueueTableObservers();assert.equal(observers[1].disconnected,true);
});
