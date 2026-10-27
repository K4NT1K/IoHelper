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
