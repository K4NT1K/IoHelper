import test from 'node:test';
import assert from 'node:assert/strict';
let tabSequence=0;

// A transactional IndexedDB fixture: requests are asynchronous and aborted writes roll back.
// Distinct ESM URLs below represent two dashboard tabs, with independent module-local caches.
function fixture(t) {
    const stores=new Map([['aggregates',new Map()],['cohort',new Map()]]);
    let fail=null;
    const clone=value=>value===undefined?undefined:structuredClone(value);
    const database={objectStoreNames:{contains:name=>stores.has(name)},transaction(names,mode='readonly') {
        const included=Array.isArray(names)?names:[names];
        const work=new Map(included.map(name=>[name,new Map([...stores.get(name)].map(([key,value])=>[key,clone(value)]))]));
        let pending=0,settled=false;
        const tx={error:null,abort(){
            if(settled)return;settled=true;
            tx.error ||= new DOMException('Transaction aborted','AbortError');
            queueMicrotask(()=>tx.onabort?.());
        }};
        const commit=()=>{
            if(settled||pending)return;settled=true;
            if(mode==='readwrite')for(const name of included)stores.set(name,work.get(name));
            tx.oncomplete?.();
        };
        const request=(operation,run)=>{
            const req={};pending++;
            queueMicrotask(()=>{
                if(settled)return;
                if(fail===operation){
                    fail=null;req.error=tx.error=new DOMException('Storage quota exceeded','QuotaExceededError');
                    req.onerror?.();tx.onerror?.();tx.abort();return;
                }
                req.result=clone(run());req.onsuccess?.();pending--;queueMicrotask(commit);
            });
            return req;
        };
        tx.objectStore=name=>{
            assert.ok(work.has(name),'Store belongs to the transaction');const map=work.get(name);
            return {
                get:key=>request('get',()=>map.get(key)),
                getAll:()=>request('getAll',()=>[...map.values()]),
                put:row=>{assert.equal(mode,'readwrite');const copy=clone(row);return request('put',()=>{map.set(copy.key,copy);return copy.key;});},
                delete:key=>{assert.equal(mode,'readwrite');return request('delete',()=>map.delete(key));},
                clear:()=>{assert.equal(mode,'readwrite');return request('clear',()=>map.clear());}
            };
        };
        return tx;
    }};
    const previous=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
    Object.defineProperty(globalThis,'indexedDB',{configurable:true,writable:true,value:{open(){const req={};queueMicrotask(()=>{req.result=database;req.onsuccess?.();});return req;}}});
    t.after(()=>{if(previous)Object.defineProperty(globalThis,'indexedDB',previous);else delete globalThis.indexedDB;});
    return {failNext:operation=>{fail=operation;},tab:()=>import('../modules/analytics/cache.js?checkpoint-review='+ ++tabSequence)};
}
const profile=id=>({steamId:id,name:id,days:[],coverage:{}});
const state=(id,ids)=>({runId:id,startedAt:id==='A'?1:2,members:ids.map(steamId=>({steamId})),profiles:ids.map(profile),finishedIds:[...ids],completed:ids.length,total:ids.length,status:'cancelled'});
const ids=checkpoint=>checkpoint.profiles.map(p=>p.steamId).sort();

test('checkpoint: second tab replacement cannot mix profiles into an earlier writer',async t=>{
    const f=fixture(t),a=await f.tab(),b=await f.tab(),first=state('A',['A1']);
    await a.cohortWrite(first,{replace:true});
    await b.cohortWrite(state('B',['B1']),{replace:true});
    first.profiles.push(profile('A2'));first.finishedIds.push('A2');
    await assert.rejects(a.cohortWrite(first),/другой вкладке|изменён/);
    const restored=await b.cohortRead();assert.equal(restored.runId,'B');assert.deepEqual(ids(restored),['B1']);
});

test('checkpoint: page reload resumes the same run without deleting already saved profiles',async t=>{
    const f=fixture(t),a=await f.tab();await a.cohortWrite(state('A',['A1']),{replace:true});
    const reloaded=await f.tab(),saved=await reloaded.cohortRead();
    saved.profiles.push(profile('A2'));saved.finishedIds.push('A2');await reloaded.cohortWrite(saved);
    assert.deepEqual(ids(await reloaded.cohortRead()),['A1','A2']);
    await assert.rejects(reloaded.cohortWrite(state('B',['B1'])),/другой вкладке|изменён/);
    await reloaded.cohortWrite(state('B',['B1']),{replace:true});assert.deepEqual(ids(await reloaded.cohortRead()),['B1']);
});

test('checkpoint: aborted replacement is atomic and cannot leave mixed run rows on retry',async t=>{
    const f=fixture(t),a=await f.tab();await a.cohortWrite(state('A',['A1']),{replace:true});
    const replacement=state('B',['B1']);f.failNext('put');
    await assert.rejects(a.cohortWrite(replacement,{replace:true}),/quota/i);
    let restored=await a.cohortRead();assert.equal(restored.runId,'A');assert.deepEqual(ids(restored),['A1']);
    await a.cohortWrite(replacement,{replace:true});restored=await a.cohortRead();
    assert.equal(restored.runId,'B');assert.deepEqual(ids(restored),['B1']);
});

test('checkpoint: an aborted append remains pending and is persisted by the next retry',async t=>{
    const f=fixture(t),a=await f.tab(),data=state('A',['A1']);await a.cohortWrite(data,{replace:true});
    data.profiles.push(profile('A2'));data.finishedIds.push('A2');f.failNext('put');
    await assert.rejects(a.cohortWrite(data),/quota/i);assert.deepEqual(ids(await a.cohortRead()),['A1']);
    await a.cohortWrite(data);assert.deepEqual(ids(await a.cohortRead()),['A1','A2']);
});

test('checkpoint: another tab clearing cache invalidates the old writer instead of resurrecting it',async t=>{
    const f=fixture(t),a=await f.tab(),b=await f.tab(),data=state('A',['A1']);await a.cohortWrite(data,{replace:true});
    await b.cacheClear();assert.equal(await b.cohortRead(),null);
    data.profiles.push(profile('A2'));await assert.rejects(a.cohortWrite(data),/другой вкладке|изменён/);
    assert.equal(await a.cohortRead(),null);
});

test('checkpoint: aborted clear keeps both durable checkpoint and writer ownership',async t=>{
    const f=fixture(t),a=await f.tab(),b=await f.tab(),data=state('A',['A1']);await a.cohortWrite(data,{replace:true});
    f.failNext('clear');await assert.rejects(a.cacheClear(),/quota/i);assert.deepEqual(ids(await a.cohortRead()),['A1']);
    // Clearing in a different tab must still be detected after the first tab's failed clear.
    await b.cacheClear();await assert.rejects(a.cohortWrite(data),/другой вкладке|изменён/);assert.equal(await a.cohortRead(),null);
});
