import test from 'node:test';
import assert from 'node:assert/strict';
import {clock as fakeClock} from './clock.mjs';
import {CloseReasonMethods, chooseCloseReason, parseCloseReasonTimer, closeReasonEvidenceMinutes}
    from '../modules/ticket/CloseReason.js';

const punished = 'Нарушитель был наказан';
const noCheats = 'Читов не найдено';
const insufficient = 'Недостаточно доказательств';
const noViolations = 'Нет нарушений';
const left = 'Игрок вышел с сервера';

test('Cheating uses the displayed timer and inclusive configurable threshold', () => {
    assert.equal(chooseCloseReason('Читерство', 179), noCheats);
    assert.equal(chooseCloseReason('Читерство', 180), insufficient);
    assert.equal(chooseCloseReason('Читерство', 0, 0), insufficient);
    assert.equal(chooseCloseReason('Читерство', 89, 1.5), noCheats);
    assert.equal(chooseCloseReason('Читерство', 90, 1.5), insufficient);
    assert.equal(chooseCloseReason('Читерство', null), noCheats);
    assert.equal(parseCloseReasonTimer('00:03:00'), 180);
    assert.equal(parseCloseReasonTimer('01:02:03'), 3723);
    for (const value of ['', '03:00', '12:34', 'В работе 00:03:00', '00:61:00']) {
        assert.equal(parseCloseReasonTimer(value), null);
    }
});

test('Evidence setting bounds and invalid stored values are normalized', () => {
    for (const value of [undefined, null, '', 'wrong', NaN, Infinity]) assert.equal(closeReasonEvidenceMinutes(value), 3);
    assert.equal(closeReasonEvidenceMinutes(-1), 0);
    assert.equal(closeReasonEvidenceMinutes(300), 120);
    assert.equal(closeReasonEvidenceMinutes('2.5'), 2.5);
});

for (const category of ['Читерство', 'Багоюз', 'Мониторинг', 'Спам', 'Попрошайничество']) {
    test(category + ': only the matching punishment type overrides baseline', () => {
        const ban = category === 'Читерство' || category === 'Багоюз';
        const baseline = category === 'Читерство' ? noCheats : noViolations;
        assert.equal(chooseCloseReason(category, 0), baseline);
        assert.equal(chooseCloseReason(category, 0, 3, ban ? {isBanned:true} : {isMuted:true}), punished);
        assert.equal(chooseCloseReason(category, 0, 3, ban ? {isMuted:true} : {isBanned:true}), baseline);
        if (category !== 'Читерство') assert.equal(chooseCloseReason(category, 1000000), noViolations);
    });
}

test('Unspecified complaint categories never select a reason', () => {
    for (const category of ['', 'Читерство и спам', 'Другое']) {
        assert.equal(chooseCloseReason(category, 200, 3, {isBanned:true, isMuted:true}), null);
    }
});

function fixture(t) {
    const observers = [];
    const oldObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
        constructor(callback) {this.callback = callback; observers.push(this);}
        observe(target, options) {this.target=target; this.options=options; this.connected=true;}
        disconnect() {this.connected=false;}
    };
    t.after(() => {globalThis.MutationObserver=oldObserver;});
    const state = {category:'Читерство', steamId:'76561198000000001', visible:true, active:true,
        timer:'00:00:00', ticketId:'1234567', clicks:[], cached:null, texts:[], ttl:[]};
    const body = {};
    const scope = {parentElement:body, attrs:{}, getAttribute(name) {return this.attrs[name] ?? null;}};
    const clockParent = {get textContent() {return state.timer;}};
    const clock = {closest:() => ({parentElement:clockParent})};
    const header = {querySelector:selector => selector === 'use[href="#lc-clock"]' ? clock : null};
    const title = {get textContent() {return 'Результат рассмотрения тикета #' + state.ticketId;}, parentElement:header};
    const handlers = new Map();
    const group = {};
    const labels = [punished, noCheats, insufficient, noViolations, left, 'Некорректная жалоба'];
    const buttons = labels.map(label => ({textContent:label, type:'button', disabled:false, parentElement:group,
        closest(selector) {return selector === 'button' ? this : null;},
        click() {handlers.get('click')?.({target:this}); state.clicks.push(label);}}));
    const card = {parentElement:scope,
        querySelectorAll:selector => selector === 'h3' ? [title] : selector === 'button' ? buttons : [],
        addEventListener:(name, handler) => handlers.set(name,handler),
        removeEventListener:(name, handler) => {if(handlers.get(name)===handler) handlers.delete(name);}};
    const content = {parentElement:card, querySelectorAll:() => []};
    const comment = {parentElement:content, querySelectorAll:() => []};
    const textarea = {parentElement:comment, readOnly:false, disabled:false, connected:true,
        getClientRects:() => state.visible ? [{}] : []};
    state.texts = [textarea];
    const ctx = {...CloseReasonMethods,
        settings:{features:{autoSelectCloseReason:true}, closeReasonEvidenceMinutes:3,
            trackOffenderIntervalWhileReviewing:30},
        document:{body, contains:node => node.connected !== false, querySelectorAll:() => state.texts,
            querySelector:() => state.modal ? {} : null,
            defaultView:{getComputedStyle:node => node.style || {display:'block',visibility:'visible'}}},
        getTicketScopeRoot:() => state.scopeOverride || scope,
        findInfoFieldScoped:() => ({steamId:state.steamId}),
        extractSteamIdFromField:field => field.steamId,
        getTicketComplaintCategory:() => state.category,
        scopeHasInProgressStatus:(_scope, options) => {assert.equal(options.includeActivePanel,false); return state.active;},
        isVisibleTicketTextarea:() => state.visible,
        getCachedUserData:(_id, ttl) => {state.ttl.push(ttl); return state.cached;}};
    return {ctx,state,textarea,buttons,card,content,scope,header,observers,handlers};
}

test('Native start timestamp wakes once at the threshold and cancels when the timer disappears', async t => {
    const time = fakeClock(t), {ctx, state, observers} = fixture(t);
    const ticket = {id: Number(state.ticketId), suspectId: state.steamId, startedAt: Date.now() - 179000};
    ctx.nativeData = {}; ctx.getNativeTicket = () => ticket;
    ctx.syncCloseReasonSelection(); assert.deepEqual(state.clicks, [noCheats]);
    assert.equal(observers[0].options.characterData, false); assert.equal(time.timers.size, 1);
    await time.advance(999); assert.deepEqual(state.clicks, [noCheats]);
    await time.advance(11); assert.deepEqual(state.clicks, [noCheats, insufficient]); assert.equal(time.timers.size, 0);
    ticket.startedAt = Date.now(); ctx.syncCloseReasonSelection(); assert.equal(time.timers.size, 1);
    ticket.startedAt = null; ctx.syncCloseReasonSelection(); assert.equal(time.timers.size, 0);
    ctx.stopCloseReasonSelection(); assert.equal(time.timers.size, 0);
});

test('Native baseline, timer transition and punishment transition click once; close is never clicked', t => {
    const {ctx,state,observers,card} = fixture(t);
    ctx.syncCloseReasonSelection();
    assert.deepEqual(state.clicks,[noCheats]);
    assert.equal(observers[0].target,card);
    assert.equal(observers[0].options.characterData,true);
    state.timer='00:02:59'; observers[0].callback([{target:card}]);
    ctx.syncCloseReasonSelection();
    assert.deepEqual(state.clicks,[noCheats]);
    state.timer='00:03:00'; observers[0].callback([{target:card}]);
    state.timer='00:03:01'; observers[0].callback([{target:card}]);
    assert.deepEqual(state.clicks,[noCheats,insufficient]);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true});
    state.timer='01:00:00'; observers[0].callback([{target:card}]);
    assert.deepEqual(state.clicks,[noCheats,insufficient,punished]);
    assert.equal(state.ttl[0],undefined, "native-only cache does not use a polling interval");
});

test('Fresh tracker false restores baseline after both queue and form detection', t => {
    const {ctx,state} = fixture(t);
    ctx.syncCloseReasonSelection();
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true});
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:false});
    assert.deepEqual(state.clicks,[noCheats,punished,noCheats]);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,issuedType:'ban'});
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:false});
    assert.equal(state.clicks.at(-1),noCheats);
    assert.equal(state.clicks.length,5);
});

test('Fresh queue cache provides the initial reason without another request', t => {
    const {ctx,state} = fixture(t);
    state.cached={isBanned:true, fetchedAt:Date.now()};
    ctx.syncCloseReasonSelection();
    assert.deepEqual(state.clicks,[punished]);
});

test('Wrong offender, wrong scope, wrong ticket and wrong punishment do not affect a session', t => {
    const {ctx,state} = fixture(t);
    ctx.syncCloseReasonSelection();
    ctx.onCloseReasonPunishmentData('76561198000000002',{isBanned:true});
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,scope:{}});
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,ticketId:'999'});
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,issuedType:'ban',scope:null});
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,issuedType:'ban',ticketId:null});
    ctx.onCloseReasonPunishmentData(state.steamId,{isMuted:true});
    assert.deepEqual(state.clicks,[noCheats]);
});

test('Manual selection transfers control until the complaint changes', t => {
    const {ctx,state,buttons,observers,card} = fixture(t);
    ctx.syncCloseReasonSelection();
    buttons.at(-1).click();
    state.timer='00:04:00'; observers[0].callback([{target:card}]);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true});
    ctx.syncCloseReasonSelection();
    assert.deepEqual(state.clicks,[noCheats,'Некорректная жалоба']);
    state.ticketId='1234568';
    ctx.syncCloseReasonSelection();
    assert.equal(state.clicks.at(-1),insufficient);
    assert.equal(observers[0].connected,false);
});

test('Hidden SPA session defers writes and preserves identity until returning', t => {
    const {ctx,state} = fixture(t);
    ctx.syncCloseReasonSelection();
    state.visible=false;
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true});
    assert.deepEqual(state.clicks,[noCheats]);
    assert.equal(ctx._closeReasonSessions.size,1);
    state.visible=true;
    ctx.syncCloseReasonSelection();
    assert.deepEqual(state.clicks,[noCheats,punished]);
});

for (const condition of ['readOnly','disabled','inactive','disabledButtons','unsupported']) {
    test('No auto clicks for ' + condition, t => {
        const {ctx,state,textarea,buttons,observers} = fixture(t);
        if(condition==='readOnly' || condition==='disabled') textarea[condition]=true;
        if(condition==='inactive') state.active=false;
        if(condition==='disabledButtons') buttons.forEach(button => {button.disabled=true;});
        if(condition==='unsupported') state.category='Другое';
        ctx.syncCloseReasonSelection();
        assert.deepEqual(state.clicks,[]);
        assert.equal(observers.length,['readOnly','disabled','disabledButtons'].includes(condition) ? 1 : 0);
        assert.equal(ctx._closeReasonSessions.size,0);
    });
}

test('Disabled feature creates no observers; later disable and removal release listeners', t => {
    const {ctx,state,observers,handlers,textarea} = fixture(t);
    ctx.settings.features.autoSelectCloseReason=false;
    ctx.syncCloseReasonSelection();
    assert.equal(observers.length,0);
    ctx.settings.features.autoSelectCloseReason=true;
    ctx.syncCloseReasonSelection();
    ctx.settings.features.autoSelectCloseReason=false;
    ctx.syncCloseReasonSelection();
    assert.equal(observers[0].connected,false);
    assert.equal(handlers.size,0);
    ctx.settings.features.autoSelectCloseReason=true;
    ctx.syncCloseReasonSelection();
    textarea.connected=false; state.texts=[];
    ctx.syncCloseReasonSelection();
    assert.equal(observers[1].connected,false);
    assert.equal(ctx._closeReasonSessions.size,0);
});

test('Rules category changes no baseline/offline choice and selects punished after a confirmed ban or mute', () => {
    for (const data of [{}, {serverIp: null}, {isBanned: false, isMuted: false}, {isMuted: 'true'}]) {
        assert.equal(chooseCloseReason('Нарушение правил', 10000, 3, data), null);
    }
    assert.equal(chooseCloseReason('Нарушение правил', 0, 3, {isMuted: true}), punished);
    assert.equal(chooseCloseReason('Нарушение правил', 0, 3, {isBanned: true}), punished);
});

for (const type of ['ban', 'mute']) {
    test(`Rules category waits for confirmed ${type}; pending/cancelled attempt does not change the selected reason`, t => {
        const {ctx, state, scope} = fixture(t);
        state.category = 'Нарушение правил'; ctx.syncCloseReasonSelection();
        assert.deepEqual(state.clicks, []);
        const attemptToken = {};
        assert.equal(ctx.onCloseReasonPunishmentIntent({type, scope, steamId: state.steamId, ticketId: state.ticketId, attemptToken}), true);
        assert.deepEqual(state.clicks, []);
        ctx.cancelCloseReasonPunishmentIntent(attemptToken);
        assert.deepEqual(state.clicks, []);
        ctx.onCloseReasonPunishmentData(state.steamId, {[type === 'ban' ? 'isBanned' : 'isMuted']: true});
        assert.deepEqual(state.clicks, [punished]);
    });
}

test('Acceptance attribute changes activate a formerly readonly form without another mount', t => {
    const {ctx,state,textarea,observers,card} = fixture(t);
    textarea.readOnly=true;
    ctx.syncCloseReasonSelection();
    assert.deepEqual(state.clicks,[]);
    assert.equal(ctx._closeReasonSessions.size,0);
    assert.equal(observers[0].options.characterData,true);
    textarea.readOnly=false;
    observers[0].callback([{target:card}]);
    assert.deepEqual(state.clicks,[noCheats]);
    assert.equal(observers[0].connected,false);
    assert.equal(ctx._closeReasonPendingCards.size,0);
    assert.equal(ctx._closeReasonSessions.size,1);
});

test('Reused scope with another Steam ID discards old punishment and manual state', t => {
    const {ctx,state,observers} = fixture(t);
    ctx.syncCloseReasonSelection();
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,issuedType:'ban'});
    state.steamId='76561198000000002';
    ctx.syncCloseReasonSelection();
    assert.equal(observers[0].connected,false);
    assert.deepEqual(state.clicks,[noCheats,punished,noCheats]);
});

for (const [category, first, second] of [['Читерство','ban','mute'], ['Мониторинг','mute','ban']]) {
    test(category + ': a second active punishment preserves the matching type in complete status data', t => {
        const {ctx,state} = fixture(t);
        state.category=category;
        ctx.syncCloseReasonSelection();
        ctx.onCloseReasonPunishmentData(state.steamId,{issuedType:first, isBanned:first==='ban', isMuted:first==='mute'});
        ctx.onCloseReasonPunishmentData(state.steamId,{issuedType:second, isBanned:true, isMuted:true});
        ctx.syncCloseReasonSelection();
        assert.deepEqual(state.clicks,[category==='Читерство' ? noCheats : noViolations,punished]);
    });
}

test('Manual choice survives feature off/on and a replacement card, but does not follow a new ticket', t => {
    const {ctx,state,buttons,card,content,observers} = fixture(t);
    ctx.syncCloseReasonSelection();
    buttons.at(-1).click();
    ctx.settings.features.autoSelectCloseReason=false;
    ctx.syncCloseReasonSelection();
    assert.equal(observers[0].connected,false);
    ctx.settings.features.autoSelectCloseReason=true;
    ctx.syncCloseReasonSelection();
    state.timer='00:04:00';
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,issuedType:'ban'});
    content.parentElement={...card};
    ctx.syncCloseReasonSelection();
    assert.deepEqual(state.clicks,[noCheats,'Некорректная жалоба']);
    state.ticketId='1234568';
    ctx.syncCloseReasonSelection();
    assert.deepEqual(state.clicks,[noCheats,'Некорректная жалоба',insufficient]);
});

test('Replacing only the selected native button reapplies once without repeated timer clicks', t => {
    const {ctx,state,buttons,card,observers} = fixture(t);
    ctx.syncCloseReasonSelection();
    const index=buttons.findIndex(button => button.textContent===noCheats);
    buttons[index]={...buttons[index]};
    observers[0].callback([{target:card}]);
    state.timer='00:00:01'; observers[0].callback([{target:card}]);
    state.timer='00:00:02'; observers[0].callback([{target:card}]);
    assert.deepEqual(state.clicks,[noCheats,noCheats]);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true});
    const punishedIndex=buttons.findIndex(button => button.textContent===punished);
    buttons[punishedIndex]={...buttons[punishedIndex]};
    observers[0].callback([{target:card}]);
    ctx.syncCloseReasonSelection();
    assert.deepEqual(state.clicks,[noCheats,noCheats,punished,punished]);
});

test('Replacement card retains fresh punishment status and restores its native selection once', t => {
    const {ctx,state,card,content,observers} = fixture(t);
    ctx.syncCloseReasonSelection();
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,issuedType:'ban'});
    content.parentElement={...card};
    ctx.syncCloseReasonSelection();
    ctx.syncCloseReasonSelection();
    assert.equal(observers[0].connected,false);
    assert.deepEqual(state.clicks,[noCheats,punished,punished]);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:false});
    assert.equal(state.clicks.at(-1),noCheats);
});

for (const transition of ['buttons','readonly']) {
    test('An active card resumes after temporary '+transition+' without another mount', t => {
        const {ctx,state,buttons,textarea,observers,card} = fixture(t);
        ctx.syncCloseReasonSelection();
        if (transition==='buttons') buttons.forEach(button => {button.disabled=true;});
        else textarea.readOnly=true;
        state.timer='00:04:00';
        observers[0].callback([{target:card}]);
        ctx.syncCloseReasonSelection();
        assert.equal(observers[0].connected,true);
        assert.deepEqual(state.clicks,[noCheats]);
        if (transition==='buttons') buttons.forEach(button => {button.disabled=false;});
        else textarea.readOnly=false;
        observers[0].callback([{target:card}]);
        assert.deepEqual(state.clicks,[noCheats,insufficient]);
        assert.equal(observers.length,1);
    });
}

test('A pending readonly card releases its observer on a status-only close', t => {
    const {ctx,state,textarea,observers,card} = fixture(t);
    textarea.readOnly=true;
    ctx.syncCloseReasonSelection();
    state.active=false;
    observers[0].callback([{type:'characterData',target:card}]);
    assert.equal(observers[0].connected,false);
    assert.equal(ctx._closeReasonPendingCards.size,0);
    assert.deepEqual(state.clicks,[]);
});

for (const category of ['Читерство','Багоюз','Мониторинг','Спам','Попрошайничество']) {
    test(category+': punishment outranks offline, explicit online restores the normal baseline', () => {
        const ban=category==='Читерство'||category==='Багоюз';
        const data={serverIp:null,isBanned:ban,isMuted:!ban};
        assert.equal(chooseCloseReason(category,0,3,data),punished);
        assert.equal(chooseCloseReason(category,0,3,{serverIp:null}),left);
        assert.equal(chooseCloseReason(category,0,3,{serverIp:'127.0.0.2:27015'}),
            category==='Читерство'?noCheats:noViolations);
        assert.equal(chooseCloseReason(category,0,3,{serverIp:undefined}),
            category==='Читерство'?noCheats:noViolations);
    });
}

test('Offline and relocated tracker updates preserve presence across partial punishment data', t => {
    const {ctx,state}=fixture(t);
    ctx.syncCloseReasonSelection();
    ctx.onCloseReasonPunishmentData(state.steamId,{serverIp:null,isBanned:false,isMuted:false});
    ctx.onCloseReasonPunishmentData(state.steamId,{serverIp:undefined,isMuted:true});
    assert.deepEqual(state.clicks,[noCheats,left]);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true});
    assert.equal(state.clicks.at(-1),punished);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:false});
    assert.equal(state.clicks.at(-1),left);
    ctx.onCloseReasonPunishmentData(state.steamId,{serverIp:'127.0.0.2:27015'});
    assert.equal(state.clicks.at(-1),noCheats);
    ctx.onCloseReasonPunishmentData(state.steamId,{isMuted:false});
    assert.equal(state.clicks.at(-1),noCheats);
    ctx.onCloseReasonPunishmentData(state.steamId,{serverIp:null});
    state.timer='00:04:00';
    ctx.onCloseReasonPunishmentData(state.steamId,{serverIp:'127.0.0.1:27015'});
    assert.equal(state.clicks.at(-1),insufficient);
});

function intentFor(fixture, overrides={}) {
    return {scope:fixture.scope,steamId:fixture.state.steamId,ticketId:fixture.state.ticketId,
        type:'ban',attemptToken:{},...overrides};
}

test('Native intent updates synchronously, survives API false and rolls back on explicit failure', t => {
    const f=fixture(t), {ctx,state}=f;
    ctx.syncCloseReasonSelection();
    ctx.onCloseReasonPunishmentData(state.steamId,{serverIp:null,isBanned:false});
    const intent=intentFor(f);
    assert.equal(ctx.onCloseReasonPunishmentIntent(intent),true);
    assert.equal(state.clicks.at(-1),punished);
    ctx.onCloseReasonPunishmentData(state.steamId,{serverIp:null,isBanned:false});
    assert.equal(state.clicks.at(-1),punished);
    ctx.cancelCloseReasonPunishmentIntent(intent.attemptToken);
    assert.equal(state.clicks.at(-1),left);
    ctx.cancelCloseReasonPunishmentIntent(intent.attemptToken);
    assert.deepEqual(state.clicks,[noCheats,left,punished,left]);
});

test('API true confirms an intent; a later false then follows current tracker status', t => {
    const f=fixture(t),{ctx,state}=f;
    const intent=intentFor(f);
    ctx.onCloseReasonPunishmentIntent(intent);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,serverIp:null});
    assert.equal(ctx._closeReasonIntentStates.has(intent.attemptToken),false);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:false,serverIp:null});
    assert.equal(state.clicks.at(-1),left);
    ctx.cancelCloseReasonPunishmentIntent(intent.attemptToken);
    assert.equal(state.clicks.at(-1),left);
});

test('Independent attempts cancel individually and unsupported origins and types are ignored', t => {
    const f=fixture(t),{ctx,state}=f;
    ctx.syncCloseReasonSelection();
    for (const overrides of [{scope:{}},{steamId:'76561198000000002'},{ticketId:'999'},
        {type:'mute'},{type:'unknown'},{attemptToken:null},{attemptToken:'invalid'}]) {
        assert.equal(ctx.onCloseReasonPunishmentIntent(intentFor(f,overrides)),false);
    }
    assert.deepEqual(state.clicks,[noCheats]);
    const first=intentFor(f),second=intentFor(f);
    ctx.onCloseReasonPunishmentIntent(first);
    ctx.onCloseReasonPunishmentIntent(second);
    ctx.cancelCloseReasonPunishmentIntent(first.attemptToken);
    assert.deepEqual(state.clicks,[noCheats,punished]);
    ctx.cancelCloseReasonPunishmentIntent(second.attemptToken);
    assert.deepEqual(state.clicks,[noCheats,punished,noCheats]);
});

test('A mute intent belongs to voice complaint categories and respects manual choice', t => {
    const f=fixture(t),{ctx,state,buttons}=f;
    state.category='Мониторинг';
    ctx.syncCloseReasonSelection();
    assert.equal(ctx.onCloseReasonPunishmentIntent(intentFor(f)),false);
    const intent=intentFor(f,{type:'mute'});
    assert.equal(ctx.onCloseReasonPunishmentIntent(intent),true);
    assert.equal(state.clicks.at(-1),punished);
    buttons.find(button=>button.textContent===left).click();
    ctx.onCloseReasonPunishmentData(state.steamId,{isMuted:true,serverIp:'127.0.0.1:27015'});
    ctx.cancelCloseReasonPunishmentIntent(intent.attemptToken);
    ctx.onCloseReasonPunishmentIntent(intentFor(f,{type:'mute'}));
    assert.deepEqual(state.clicks,[noViolations,punished,left]);
});

test('Modal background aria-hidden and inert do not change source scope or delay native intent selection', t => {
    const f=fixture(t),{ctx,state,content,scope,header}=f;
    ctx.syncCloseReasonSelection();
    state.modal=true;
    state.scopeOverride=content;
    content.getAttribute=name=>name==='aria-hidden'||name==='data-aria-hidden'?'true':null;
    content.inert=true;
    ctx.isVisibleTicketTextarea=()=>false;
    header.querySelectorAll=()=>[{textContent:'В работе'}];
    ctx.scopeHasInProgressStatus=()=>false;
    assert.equal(ctx.getCloseReasonContext(f.textarea).scope,scope);
    assert.equal(ctx.onCloseReasonPunishmentIntent(intentFor(f)),true);
    assert.deepEqual(state.clicks,[noCheats,punished]);
    assert.equal(ctx._closeReasonSessions.size,1);
});

for (const hiddenBy of ['display','visibility','tabpanel','inactive','ariaOnly','noRects']) {
    test('An open modal does not authorize a hidden SPA source: '+hiddenBy, t => {
        const f=fixture(t),{ctx,state,scope}=f;
        ctx.syncCloseReasonSelection();
        state.modal=true;
        if(hiddenBy==='display') scope.style={display:'none',visibility:'visible'};
        if(hiddenBy==='visibility') scope.style={display:'block',visibility:'hidden'};
        if(hiddenBy==='tabpanel') scope.attrs={'role':'tabpanel','aria-hidden':'true'};
        if(hiddenBy==='inactive') scope.attrs={'data-state':'inactive','aria-hidden':'true'};
        if(hiddenBy==='ariaOnly') scope.attrs={'aria-hidden':'true'};
        if(hiddenBy==='noRects') state.visible=false;
        ctx.onCloseReasonPunishmentIntent(intentFor(f));
        assert.deepEqual(state.clicks,[noCheats]);
        delete scope.style; scope.attrs={}; state.visible=true;
        ctx.syncCloseReasonSelection();
        assert.deepEqual(state.clicks,[noCheats,punished]);
    });
}

test('Complaint replacement and feature disable clean optimistic attempt tokens', t => {
    const f=fixture(t),{ctx,state}=f;
    const first=intentFor(f);
    ctx.onCloseReasonPunishmentIntent(first);
    assert.equal(ctx._closeReasonIntentStates.has(first.attemptToken),true);
    state.ticketId='1234568';
    ctx.syncCloseReasonSelection();
    assert.equal(ctx._closeReasonIntentStates.has(first.attemptToken),false);
    assert.equal(state.clicks.at(-1),noCheats);
    const second=intentFor(f);
    ctx.onCloseReasonPunishmentIntent(second);
    ctx.settings.features.autoSelectCloseReason=false;
    ctx.syncCloseReasonSelection();
    assert.equal(ctx._closeReasonIntentStates.has(second.attemptToken),false);
    ctx.settings.features.autoSelectCloseReason=true;
    ctx.syncCloseReasonSelection();
    assert.equal(state.clicks.at(-1),noCheats);
});

test('Explicit detached-scope transfer preserves manual priority on the same remounted complaint', t => {
    const f=fixture(t),{ctx,state,scope,card,textarea,buttons,observers}=f;
    ctx.syncCloseReasonSelection();
    buttons.find(button=>button.textContent===left).click();
    const intent=intentFor(f);
    ctx.onCloseReasonPunishmentIntent(intent);
    ctx.onCloseReasonPunishmentData(state.steamId,{serverIp:null,isBanned:false});
    const oldState=ctx._closeReasonStateByScope.get(scope);
    const remountedScope={...scope,connected:true};
    scope.connected=false;
    card.parentElement=remountedScope;
    state.scopeOverride=remountedScope;
    const context=ctx.getCloseReasonContext(textarea);
    assert.equal(ctx.transferCloseReasonComplaintScope(scope,context),true);
    assert.equal(observers[0].connected,false);
    assert.equal(ctx._closeReasonStateByScope.get(remountedScope),oldState);
    assert.equal(ctx._closeReasonStateByScope.has(scope),false);
    ctx.syncCloseReasonSelection();
    ctx.onCloseReasonPunishmentData(state.steamId,{serverIp:'127.0.0.2:27015',isBanned:true});
    assert.deepEqual(state.clicks,[noCheats,left]);
    assert.equal(ctx._closeReasonSessions.get(remountedScope).complaintState.manual,true);
});

test('Transferred optimistic attempt remains cancellable after the source scope remounts', t => {
    const f=fixture(t),{ctx,state,scope,card,textarea}=f;
    const intent=intentFor(f);
    ctx.onCloseReasonPunishmentIntent(intent);
    const remountedScope={...scope,connected:true};
    scope.connected=false; card.parentElement=remountedScope; state.scopeOverride=remountedScope;
    const context=ctx.getCloseReasonContext(textarea);
    assert.equal(ctx.transferCloseReasonComplaintScope(scope,context),true);
    ctx.syncCloseReasonSelection();
    assert.equal(state.clicks.at(-1),punished);
    ctx.cancelCloseReasonPunishmentIntent(intent.attemptToken);
    assert.equal(state.clicks.at(-1),noCheats);
    assert.equal(ctx._closeReasonIntentStates.has(intent.attemptToken),false);
});

test('Transfer respects a manual choice already made in the remounted scope', t => {
    const f=fixture(t),{ctx,state,scope,card,textarea,buttons}=f;
    ctx.syncCloseReasonSelection();
    const remountedScope={...scope,connected:true};
    scope.connected=false; card.parentElement=remountedScope; state.scopeOverride=remountedScope;
    ctx.syncCloseReasonSelection();
    buttons.find(button=>button.textContent===left).click();
    const clicksBeforeTransfer=[...state.clicks];
    const context=ctx.getCloseReasonContext(textarea);
    assert.equal(ctx.transferCloseReasonComplaintScope(scope,context),true);
    ctx.onCloseReasonPunishmentData(state.steamId,{isBanned:true,serverIp:null});
    assert.deepEqual(state.clicks,clicksBeforeTransfer);
    assert.equal(ctx._closeReasonSessions.get(remountedScope).complaintState.manual,true);
});

for (const mismatch of ['mounted','ticket','steam','category','readonly']) {
    test('Scope transfer rejects a '+mismatch+' source mismatch', t => {
        const f=fixture(t),{ctx,state,scope,card,textarea}=f;
        ctx.syncCloseReasonSelection();
        const oldState=ctx._closeReasonStateByScope.get(scope);
        const remountedScope={...scope,connected:true};
        if(mismatch!=='mounted') scope.connected=false;
        card.parentElement=remountedScope; state.scopeOverride=remountedScope;
        if(mismatch==='ticket') state.ticketId='1234568';
        if(mismatch==='steam') state.steamId='76561198000000002';
        if(mismatch==='category') state.category='Мониторинг';
        if(mismatch==='readonly') textarea.readOnly=true;
        const context=ctx.getCloseReasonContext(textarea);
        assert.equal(ctx.transferCloseReasonComplaintScope(scope,context),false);
        assert.equal(ctx._closeReasonStateByScope.get(scope),oldState);
        assert.equal(ctx._closeReasonStateByScope.has(remountedScope),false);
    });
}
