import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelService} from '../modules/PanelService.js';
import {clock} from './clock.mjs';

function fixture() {
    const document={createElement:()=>({nodeType:1,children:[],dataset:{},isConnected:true,
        setAttribute(){},append(...nodes){this.children.push(...nodes);},appendChild(node){this.children.push(node);}})};
    const target={value:'',dataset:{},isConnected:true,dispatchEvent(){}};
    return {service:new PanelService({document}),target};
}
const event={preventDefault(){}};
test('Ticket templates: explicit Toxicity is first, unique, immediate and never a warning',()=>{
    const {service,target}=fixture();
    const panel=service.createPanel([{name:'Оск',text:'Пред Оск'},{name:'Токсичность',text:'Пред Токсичность'}],target,'mod-ticket-panel');
    assert.deepEqual(panel.children.map(button=>button.children[1].innerText),['Токсичность','Оск']);
    panel.children[0].onclick(event);
    assert.equal(target.value,'Мут Токсичность');
    panel.children[0].onclick(event);
    assert.equal(target.value,'Мут Токсичность');
});
test('Insult triple click stays Insult; notification panel gets no Toxicity button',async t=>{
    const c=clock(t),{service,target}=fixture();
    const panel=service.createPanel([{name:'Оск',text:'Пред Оск'}],target,'mod-ticket-panel');
    for(let i=0;i<3;i++)panel.children[1].onclick(event);
    await c.advance(260);
    assert.equal(target.value,'Мут Оск');
    const notice=service.createPanel([{name:'Оск',text:'Не оскорбляйте'}],target,'mod-notif-panel');
    assert.deepEqual(notice.children.map(button=>button.children[1].innerText),['Оск']);
});
