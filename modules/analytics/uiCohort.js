import {rankProfiles} from './cohort.js';
import {safeAvatarUrl} from './schema.js';
import {bindDepthMotion} from './uiMotion.js';

const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value==null||!Number.isFinite(Number(value))?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Date(value+'T12:00:00+03:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Moscow'}):String(value||'');
const metricLabels={punishmentsPer100Complaints:'Импакт',complaints:'Закрытые жалобы',tickets:'Тикеты',reports:'Репорты',punishments:'Все наказания',bans:'Баны',mutes:'Муты',perActiveDay:'Жалоб за активный день'};
const impactMetric='punishmentsPer100Complaints';
const metricNumber=value=>metric===impactMetric&&value!=null?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value):number(value);
const role=(profile,member)=>profile.className||member?.className||'Должность не указана';
const punishments=profile=>profile.totals.bans==null||profile.totals.mutes==null?null:profile.totals.bans+profile.totals.mutes;
function firstPunishment(profile) {
    if(Number.isFinite(profile.firstPunishmentAt)&&profile.firstPunishmentAt>0){
        const label=new Date(profile.firstPunishmentAt*1000).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Moscow'});
        return `Первое наказание · ${label}${profile.firstPunishmentComplete?'':' · история неполная'}`;
    }
    return profile.firstPunishmentComplete?'В истории нет наказаний':'Первая дата недоступна';
}
const icon={
    trophy:'<path d="M8 3h8v5a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 5 4m7-6h4v2a4 4 0 0 1-5 4M12 12v6m-4 3h8m-8-3h8"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
    streak:'<path d="M13 3c1 4-2 5-2 8 0 2 2 3 3 2 2-2 1-4 1-4 4 3 5 5 4 8a7 7 0 0 1-13 0C4 12 9 9 13 3Z"/>'
};
let latestState,latestOptions={},controller,frame,renderedMetric,metric=impactMetric;
const selected=new Set();
const noMotion=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
function avatar(profile,members,className='') {
    const member=members.get(profile.steamId),url=safeAvatarUrl(profile.avatar||member?.avatar);
    return `<span class="cohort-avatar ${className}"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>${url?`<img src="${escape(url)}" alt="Аватар ${escape(profile.name)}" width="78" height="78" loading="lazy" referrerpolicy="no-referrer" data-cohort-avatar>`:''}</span>`;
}
function statusText(state,processed,total,failed,preliminary) {
    const period=state.period?`${date(state.period.start)} — ${date(state.period.end)}`:'';
    if(state.status==='running')return `Проверено ${number(processed)} из ${number(total)}. Рейтинг обновляется по мере получения профилей. ${period}`;
    if(state.status==='cancelled')return `Сбор остановлен. Показаны предварительные результаты ${number(state.profiles?.length||0)} профилей. ${period}`;
    if(state.status==='failed')return `Сбор завершился с ошибкой. Уже полученные результаты сохранены. ${period}`;
    if(preliminary)return `Предварительные результаты: ${number(state.profiles?.length||0)} из ${number(total)} профилей${failed?`, ошибок: ${number(failed)}`:''}. ${period}`;
    return `Получены результаты ${number(state.profiles?.length||0)} модераторов. ${period}`;
}
function podium(ranked,members) {
    const ties=new Map();ranked.forEach(row=>ties.set(row.rank,(ties.get(row.rank)||0)+1));
    const leader=ranked[0];
    return `<div class="cohort-leader-caption"><span class="eyebrow">ЛИДЕРЫ · ${metricLabels[metric].toUpperCase()}</span><p>${leader?`${escape(leader.profile.name)}${ties.get(1)>1?` и ещё ${number(ties.get(1)-1)}`:''} · ${metricNumber(leader.value)}${metric===impactMetric?' на 100 жалоб':''}`:'Лидеры появятся по мере загрузки'}</p></div><div class="cohort-podium" aria-label="Лучшие результаты выбранного показателя">${[1,0,2].map(index=>{
        const entry=ranked[index];
        if(!entry)return '<div class="cohort-podium-card is-pending" aria-hidden="true"><span>Место появится<br>после загрузки</span></div>';
        const {profile,value,rank}=entry,tied=ties.get(rank)>1;
        return `<article class="cohort-podium-card" data-rank="${rank}" data-podium-id="${escape(profile.steamId)}" data-depth><span class="cohort-place">${rank}<small>место</small></span>${avatar(profile,members)}<button type="button" class="cohort-podium-name" data-cohort-open="${escape(profile.steamId)}">${escape(profile.name)}</button><span class="cohort-podium-role">${escape(role(profile,members.get(profile.steamId)))}</span><strong class="cohort-podium-value" title="${escape(value)}">${metricNumber(value)}</strong><span class="cohort-podium-caption">${metric===impactMetric?'наказаний на 100 жалоб':metricLabels[metric].toLowerCase()}</span>${metric===impactMetric?`<span class="cohort-podium-base">База: <b>${number(profile.totals.complaints)}</b> жалоб<br>${number(punishments(profile))} наказаний</span>`:''}${tied?`<span class="cohort-podium-tie">Общее ${rank}-е место</span>`:''}</article>`;
    }).join('')}</div>`;
}
function ranking(ranked,profiles,members,preliminary) {
    const max=Math.max(0,...ranked.map(row=>row.value))||1;
    return `<section class="surface cohort-ranking"><div class="cohort-ranking-header"><div><h3>${metricLabels[metric]}</h3><p>В рейтинге ${number(ranked.length)} из ${number(profiles.length)} полученных профилей. При равных значениях место общее.</p>${metric===impactMetric?'<p class="cohort-impact-formula">(Баны + муты) ÷ (закрытые тикеты + репорты) × 100. Может быть выше 100. Сравнивайте вместе с базой жалоб.</p>':''}</div><div class="cohort-selection"><span id="cohortSelectionCount">Выберите два профиля</span><button type="button" class="secondary-button" id="cohortCompareSelected" disabled>Сравнить выбранных</button><button type="button" class="text-button" id="cohortClearSelection" hidden>Сбросить</button></div></div>${ranked.length?`<div class="cohort-ranking-wrap" tabindex="0" aria-label="Рейтинг модераторов, таблицу можно прокручивать"><table class="cohort-table"><thead><tr><th scope="col">Место</th><th scope="col">Модератор</th><th scope="col">${metric===impactMetric?'Импакт':'Результат'}</th><th scope="col">${metric===impactMetric?'База и сравнение':'Сравнение'}</th><th scope="col">Выбрать</th></tr></thead><tbody>${ranked.map(({profile,value,rank})=>{
        const member=members.get(profile.steamId);
        return `<tr data-cohort-id="${escape(profile.steamId)}" data-rank="${rank}" class="${selected.has(profile.steamId)?'is-selected':''}"><td>${rank}</td><td><div class="cohort-member">${avatar(profile,members)}<div class="cohort-member-info"><button type="button" class="cohort-member-name" data-cohort-open="${escape(profile.steamId)}">${escape(profile.name)}</button><span>${escape(role(profile,member))}</span><span class="cohort-member-since" title="По доступной истории с 2019 года, включая снятые наказания. Это не дата назначения.">${escape(firstPunishment(profile))}</span></div></div></td><td><strong class="cohort-result" title="${escape(value)}">${metricNumber(value)}</strong>${metric===impactMetric?'<small class="cohort-result-unit">на 100 жалоб</small>':''}</td><td>${metric===impactMetric?`<span class="cohort-base"><b>${number(profile.totals.complaints)}</b> жалоб<br>${number(punishments(profile))} наказаний</span>`:''}<div class="cohort-row-bar" aria-hidden="true"><i data-bar-width="${value/max*100}" style="--width:${value/max*100}%"></i></div></td><td><input class="cohort-check" type="checkbox" data-cohort-select="${escape(profile.steamId)}" aria-label="Выбрать ${escape(profile.name)} для сравнения"${selected.has(profile.steamId)?' checked':''}></td></tr>`;
    }).join('')}</tbody></table></div>`:`<p class="cohort-empty">${profiles.length?'Этот показатель недоступен в полученных профилях. Выберите другой.':'Получаем первые профили. Рейтинг появится здесь автоматически.'}</p>`}<p class="cohort-note" style="padding:0 26px 22px;margin-bottom:0">${preliminary?'Порядок может измениться после загрузки оставшихся профилей. ':''}Сравнивается выбранный показатель за один период. Импакт отражает соотношение объёмов, а не качество решений. Полосы нормированы относительно лидера.</p></section>`;
}
function bestDay(profiles,key) {
    const eligible=rankProfiles(profiles,key),records=[];let max=0;
    for(const {profile} of eligible) for(const day of profile.days||[]) {
        const value=key==='punishments'?(day.bans||0)+(day.mutes||0):Number(day[key])||0;
        if(value>max){max=value;records.length=0;}
        if(value===max&&value>0)records.push({profile,date:day.date,value});
    }
    records.sort((a,b)=>a.date.localeCompare(b.date)||a.profile.name.localeCompare(b.profile.name,'ru'));
    return records;
}
function bestStreak(profiles) {
    const records=[];let max=0;
    for(const {profile} of rankProfiles(profiles,'perActiveDay')) {
        let length=0,previous=null,end=null,best=0;
        for(const day of [...(profile.days||[])].sort((a,b)=>a.date.localeCompare(b.date))) {
            if((day.complaints||0)+(day.bans||0)+(day.mutes||0)<=0)continue;
            const at=Date.parse(day.date+'T12:00:00+03:00');
            length=previous!=null&&at-previous===86400000?length+1:1;previous=at;
            if(length>best){best=length;end=day.date;}
        }
        if(best>max){max=best;records.length=0;}
        if(best===max&&best>0)records.push({profile,date:end,value:best});
    }
    return records;
}
function achievements(profiles,preliminary) {
    const cards=[
        ['Максимальный импакт',impactMetric,'trophy','Наказания на 100 закрытых жалоб за выбранный период. Маленькая база может давать высокое значение; оценка качества решений здесь не рассчитывается.'],
        ['Рекорд всех наказаний','punishments','trophy','Самое большое суммарное число банов и мутов за один московский день.'],
        ['Рекорд по жалобам','complaints','calendar','Самое большое суммарное число закрытых тикетов и репортов за один московский день.'],
        ['Рекорд по банам','bans','calendar','Самое большое число банов за один московский день.'],
        ['Рекорд по мутам','mutes','calendar','Самое большое число мутов за один московский день.'],
        ['Серия активных дней','streak','streak','Самая длинная последовательность дней хотя бы с одной закрытой жалобой, баном или мутом. Участвуют профили с полной выборкой всех четырёх источников.']
    ];
    return `<div class="cohort-records-heading"><div><h3>Факты и лучшие дни</h3><p>Нажмите на карточку, чтобы изучить результат.</p></div><p>${preliminary?'По уже полученным профилям':'За выбранный период'}</p></div><div class="cohort-records">${cards.map(([title,key,svg,explanation])=>{
        const records=key===impactMetric?rankProfiles(profiles,key).filter(row=>row.rank===1):key==='streak'?bestStreak(profiles):bestDay(profiles,key),first=records[0];
        const format=value=>key===impactMetric?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value):number(value);
        const caption=record=>key===impactMetric?`База: ${number(record.profile.totals.complaints)} жалоб · ${number(punishments(record.profile))} наказаний`:date(record.date)+(key==='streak'?' · дней подряд':'');
        return `<details class="cohort-record" data-fact-id="${key}" data-depth><summary><span class="cohort-record-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icon[svg]}</svg></span><h4>${title}</h4><strong>${first?format(first.value):'—'}</strong>${key===impactMetric?'<span class="cohort-fact-unit">на 100 жалоб</span>':''}${first?`<p>${escape(first.profile.name)}${records.length>1?`<span class="cohort-fact-ties">Результатов с этим значением: ${number(records.length)}</span>`:''}<span class="cohort-fact-caption">${escape(caption(first))}</span></p>`:'<p>Нет доступных действий</p>'}<span class="cohort-fact-toggle">Подробности <i aria-hidden="true">+</i></span></summary><div class="cohort-fact-details"><p>${explanation}</p>${first?`<ol tabindex="0" aria-label="${title}: результаты с тем же значением">${records.slice(0,12).map(record=>`<li><button type="button" data-cohort-open="${escape(record.profile.steamId)}">${escape(record.profile.name)}</button><span>${escape(caption(record))}</span></li>`).join('')}</ol>${records.length>12?`<p>Ещё результатов с тем же значением: ${number(records.length-12)}.</p>`:''}`:''}</div></details>`;
    }).join('')}</div>`;
}
function syncSelection() {
    const root=$('cohortBody');if(!root)return;
    root.querySelectorAll('[data-cohort-select]').forEach(input=>{
        input.checked=selected.has(input.dataset.cohortSelect);
        input.disabled=selected.size>=2&&!input.checked;
        input.closest('tr').classList.toggle('is-selected',input.checked);
    });
    const compare=$('cohortCompareSelected'),clear=$('cohortClearSelection'),count=$('cohortSelectionCount');
    if(compare){compare.disabled=selected.size!==2;compare.textContent=selected.size===2?'Сравнить два профиля':'Сравнить выбранных';}
    if(clear)clear.hidden=!selected.size;
    if(count)count.textContent=selected.size?`Выбрано ${selected.size} из 2`:'Выберите два профиля';
}
function bind(state,options,signal) {
    const body=$('cohortBody');
    body.addEventListener('click',event=>{
        const open=event.target.closest('[data-cohort-open]');
        if(open)options.onSelectProfile?.(open.dataset.cohortOpen);
        if(event.target.closest('#cohortCompareSelected')&&selected.size===2)options.onCompare?.([...selected]);
        if(event.target.closest('#cohortClearSelection')){selected.clear();syncSelection();}
    },{signal});
    body.addEventListener('change',event=>{
        const input=event.target.closest('[data-cohort-select]');if(!input)return;
        if(input.checked&&selected.size<2)selected.add(input.dataset.cohortSelect);else selected.delete(input.dataset.cohortSelect);
        syncSelection();
    },{signal});
    body.addEventListener('error',event=>{if(event.target.matches?.('[data-cohort-avatar]'))event.target.remove();},{capture:true,signal});
    $('cohortMetric').addEventListener('change',event=>{
        metric=event.target.value;renderCohort(latestState,latestOptions);
    },{signal});
    bindDepthMotion(body,signal);
}

/** Render only: collection, cancellation and resume belong to the dashboard controller. */
export function renderCohort(state,options={}) {
    latestState=state;latestOptions=options;
    const root=$('cohort');if(!root)return;
    controller?.abort();controller=new AbortController();cancelAnimationFrame(frame);
    const profiles=Array.isArray(state?.profiles)?state.profiles:[],members=new Map((state?.members||[]).map(member=>[member.steamId,member]));
    const failures=Array.isArray(state?.failed)?state.failed:[],total=Math.max(0,Number(state?.total)||members.size||profiles.length),processed=Math.max(0,Math.min(total,Number(state?.completed)||0));
    const statuses=new Set(['idle','running','complete','cancelled','failed']);
    const status=statuses.has(state?.status)?state.status:'idle';
    root.hidden=status==='idle'&&!profiles.length;
    if(root.hidden)return;
    const preliminary=status!=='complete'||failures.length>0||processed<total;
    const ranked=rankProfiles(profiles,metric),percent=total?processed/total*100:0;
    const previous=new Map([...$('cohortBody').querySelectorAll('tr[data-cohort-id]')].map(row=>[row.dataset.cohortId,{top:row.getBoundingClientRect().top,width:row.querySelector('[data-bar-width]')?.dataset.barWidth}]));
    const previousPodium=new Map([...$('cohortBody').querySelectorAll('[data-podium-id]')].map(card=>[card.dataset.podiumId,card.getBoundingClientRect()]));
    const expandedFacts=new Set([...$('cohortBody').querySelectorAll('[data-fact-id][open]')].map(fact=>fact.dataset.factId));
    const oldScroll=$('cohortBody').querySelector('.cohort-ranking-wrap'),scrollTop=renderedMetric===metric?oldScroll?.scrollTop||0:0,scrollLeft=oldScroll?.scrollLeft||0;
    const focusedSelection=document.activeElement?.dataset.cohortSelect;
    const ids=new Set(ranked.map(row=>row.profile.steamId));[...selected].forEach(id=>{if(!ids.has(id))selected.delete(id);});
    root.dataset.status=status;
    $('cohortStatus').textContent=statusText({...state,status},processed,total,failures.length,preliminary);
    $('cohortCancel').hidden=status!=='running';
    $('cohortMetric').value=metric;$('cohortMetric').disabled=!profiles.length;
    const updated=state.updatedAt||state.startedAt;
    const timestamp=updated&&Number.isFinite(Number(updated))?new Date(updated).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
    const progress=`<div class="surface cohort-progress"><div class="cohort-progress-line"><strong>Проверено ${number(processed)} из ${number(total)}</strong>${preliminary?'<span class="cohort-preliminary">Предварительный результат</span>':'<span>Сбор завершён</span>'}</div><div class="cohort-progress-track" role="progressbar" aria-label="Сбор статистики команды" aria-valuemin="0" aria-valuemax="${total||1}" aria-valuenow="${processed}" style="--progress:${percent}%"><i></i></div><p class="cohort-progress-extra">${number(profiles.length)} профилей получено${failures.length?` · ошибок: ${number(failures.length)}`:''}${timestamp?` · обновлено в ${timestamp}`:''}</p></div>`;
    const failurePanel=failures.length?`<details class="cohort-failures"><summary>Не удалось получить ${number(failures.length)} ${failures.length===1?'профиль':'профилей'}</summary><ul>${failures.map(item=>`<li>${escape(item.name||item.steamId)}: ${escape(item.error||'Данные недоступны')}</li>`).join('')}</ul></details>`:'';
    $('cohortBody').innerHTML=progress+podium(ranked,members)+ranking(ranked,profiles,members,preliminary)+achievements(profiles,preliminary)+failurePanel;
    $('cohortBody').querySelectorAll('[data-fact-id]').forEach(fact=>{fact.open=expandedFacts.has(fact.dataset.factId);});
    const scroller=$('cohortBody').querySelector('.cohort-ranking-wrap');if(scroller){scroller.scrollTop=scrollTop;scroller.scrollLeft=scrollLeft;}
    syncSelection();bind(state,options,controller.signal);
    if(focusedSelection)$('cohortBody').querySelectorAll('[data-cohort-select]').forEach(input=>{if(input.dataset.cohortSelect===focusedSelection)input.focus({preventScroll:true});});
    renderedMetric=metric;
    if(!noMotion())frame=requestAnimationFrame(()=>{
        const animations=[];
        $('cohortBody').querySelectorAll('tr[data-cohort-id]').forEach((row,index)=>{
            const before=previous.get(row.dataset.cohortId),dy=before==null?8:before.top-row.getBoundingClientRect().top;
            if(Math.abs(dy)>.5||before==null)animations.push(row.animate([{transform:`translateY(${dy}px)`,opacity:before==null?0:.6},{transform:'translateY(0)',opacity:1}],{duration:450,delay:Math.min(100,index*7),easing:'cubic-bezier(.2,.75,.25,1)'}));
            const bar=row.querySelector('[data-bar-width]');
            if(bar&&before?.width!==bar.dataset.barWidth)animations.push(bar.animate([{width:(before?.width||0)+'%'},{width:bar.dataset.barWidth+'%'}],{duration:650,easing:'cubic-bezier(.2,.75,.25,1)'}));
        });
        $('cohortBody').querySelectorAll('[data-podium-id]').forEach(card=>{
            const before=previousPodium.get(card.dataset.podiumId),after=card.getBoundingClientRect();
            const dx=before?before.left-after.left:0,dy=before?before.top-after.top:14;
            if(Math.abs(dx)+Math.abs(dy)>.5||!before)animations.push(card.animate([{transform:`translate(${dx}px,${dy}px) scale(${before?1:.97})`,opacity:before ? .8 : 0},{transform:'translate(0,0) scale(1)',opacity:1}],{duration:650,easing:'cubic-bezier(.2,.75,.25,1)'}));
        });
        controller.signal.addEventListener('abort',()=>animations.forEach(animation=>animation.cancel()),{once:true});
    });
}
window.addEventListener('pagehide',()=>{controller?.abort();cancelAnimationFrame(frame);},{once:true});
