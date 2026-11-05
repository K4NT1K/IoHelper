import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageService} from '../modules/MessageService.js';
function fixture() {
    const node = {nodeValue:'hello'}, handlers=new Map(), classes=new Set();
    const cell = {dataset:{}, isConnected:true, contains:n=>n===node, matches:()=>true,
        classList:{add:(...keys)=>keys.forEach(k=>classes.add(k)),remove:(...keys)=>keys.forEach(k=>classes.delete(k))},
        addEventListener:(name, fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name);}};
    const service = new MessageService({document:{},utils:{extractMainTextNode:()=>node,detectLanguage:()=>false},
        badgeService:{translateText:async text=>({translated:'ru:'+text})},settings:{features:{translateText:true}}});
    return {service,node,cell,handlers};
}
test('Translation: reused native cell gets current text, cleanup retains native listeners', async()=>{
    const s=fixture(), native=()=>{};s.cell.addEventListener('click',native);
    s.service.decorateMessageCell(s.cell);await s.handlers.get('mouseenter')();
    assert.equal(s.node.nodeValue,'ru:hello');
    s.node.nodeValue='new message';await s.handlers.get('mouseenter')();
    assert.equal(s.node.nodeValue,'ru:new message');
    const binding=s.service.translationBindings.get(s.cell);s.service.releaseTranslation(s.cell,binding);
    assert.equal(s.node.nodeValue,'new message');assert.equal(s.handlers.get('click'),native);
});
test('Translation: late response after cell reuse cannot overwrite the new message', async()=>{
    const s=fixture();let resolve;s.service.badgeService.translateText=()=>new Promise(r=>{resolve=r;});
    s.service.decorateMessageCell(s.cell);const pending=s.handlers.get('mouseenter')();
    s.node.nodeValue='replacement';s.service.decorateMessageCell(s.cell);resolve({translated:'old translation'});await pending;
    assert.equal(s.node.nodeValue,'replacement');
});

function nativeFixture() {
    const s = fixture(), scope = {}, ticket = {key:'ticket:1', suspectId:'76561198000000001'};
    const message = {id:'message1', text:'hello'};
    s.service.ticketService = {getNativeTicket:()=>ticket, nativeData:{history:()=>({items:[message]})}};
    return {...s, scope, ticket, message};
}

test('Native translation changes the original text node and creates no overlay, restoring it on leave', async()=>{
    const s=nativeFixture(), native=()=>{};s.cell.addEventListener('click',native);
    s.service.decorateNativeMessageCell(s.cell,s.message,s.scope);
    await s.handlers.get('mouseenter')();
    assert.equal(s.node.nodeValue,'ru:hello');
    const binding=s.service.translationBindings.get(s.cell);
    assert.equal(binding.node,s.node);assert.equal(binding.overlay,undefined);
    s.service.decorateNativeMessageCell(s.cell,s.message,s.scope);
    assert.equal(s.service.translationBindings.get(s.cell),binding);
    s.handlers.get('mouseleave')();assert.equal(s.node.nodeValue,'hello');
    s.service.releaseTranslation(s.cell,binding);assert.equal(s.handlers.get('click'),native);
});

test('Native translation ignores a late result for another offender or changed message', async()=>{
    for(const change of ['offender','message']) {
        const s=nativeFixture();let resolve;
        s.service.badgeService.translateText=()=>new Promise(r=>{resolve=r;});
        s.service.decorateNativeMessageCell(s.cell,s.message,s.scope);
        const pending=s.handlers.get('mouseenter')();
        if(change==='offender')s.ticket.suspectId='76561198000000002';else s.message.text='new message';
        s.node.nodeValue='new message';resolve({translated:'old translation'});await pending;
        assert.equal(s.node.nodeValue,'new message');
        s.service.clearTranslationDecorations();assert.equal(s.node.nodeValue,'new message');
    }
});
