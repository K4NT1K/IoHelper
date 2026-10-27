import {HISTORY_START, dayStart, dayKey, groupDays, rankDays, profileRatios} from './model.js';
import {reasonLabel} from './reasons.js';
import {safeAvatarUrl} from './schema.js';
import {bindDepthMotion} from './uiMotion.js';

const $ = id => document.getElementById(id);
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const number = value => value == null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('ru-RU', {maximumFractionDigits:1}).format(value);
const shortNumber = value => new Intl.NumberFormat('ru-RU', {notation:'compact', maximumFractionDigits:1}).format(value);
const labels = {tickets:'Тикеты', reports:'Репорты', complaints:'Закрытые жалобы', bans:'Баны', mutes:'Муты'};
const dateLabel = date => /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date+'T12:00:00+03:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Moscow'}) : date;
let interactions, animationFrame, dataIdentity = '';
const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;

function displayRange(profiles) {
    const selected = {...profiles[0].range};
    if (selected.start === HISTORY_START) selected.start = profiles.flatMap(p=>p.days.map(d=>d.date)).sort()[0] || selected.end;
    return selected;
}
function coverage(profile) {
    return ['tickets','reports','bans','mutes','shifts'].map(key => {
        const c = profile.coverage[key];
        const text = c?.available ? (c.start ? dateLabel(c.start)+' — '+dateLabel(c.end) : c.scope || 'Доступная история сайта')+(c.partial?' · частично':'') : c?.error || 'недоступно';
        return `<li><b>${labels[key] || 'Рабочее время'}:</b> ${escape(text)}</li>`;
    }).join('');
}
const numeric = value => `<strong aria-label="${number(value)}"><span aria-hidden="true"${value != null ? ` data-number="${Number(value)}"` : ''}>${number(value)}</span></strong>`;
function avatar(profile) {
    const url=safeAvatarUrl(profile.avatar);
    return `<span class="profile-avatar"><svg class="profile-avatar-fallback" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>${url?`<img src="${escape(url)}" alt="Аватар ${escape(profile.name)}" width="56" height="56" loading="lazy" referrerpolicy="no-referrer" data-profile-avatar>`:''}</span>`;
}
function profileCards(profiles) {
    $('summaries').innerHTML = profiles.map((p,i) => {
        const coreIncomplete = ['tickets','reports','bans','mutes'].some(key=>!p.coverage[key]?.available||p.coverage[key].partial);
        const badge = coreIncomplete ? 'Часть статистики недоступна' : !p.coverage.shifts?.available ? 'Рабочее время недоступно' : p.coverage.shifts.partial ? 'Рабочее время ограничено' : 'Данные получены';
        const firstDate=Number.isFinite(p.firstPunishmentAt)&&p.firstPunishmentAt>0?dateLabel(dayKey(p.firstPunishmentAt)):null;
        const firstLabel=firstDate?`${firstDate}${p.firstPunishmentComplete?'':' · история неполная'}`:p.firstPunishmentComplete?'В истории нет наказаний':'Дата недоступна';
        return `<article class="surface profile-card ${i?'second':''}" data-depth>
            <div class="profile-title"><div class="profile-heading">${avatar(p)}<div><h3>${escape(p.name)}</h3><span class="id">${escape(p.steamId)}</span></div></div><span class="pill">${badge}</span></div>
            <div class="profile-context"><span><small>Должность</small><b>${escape(p.className||'Не указана')}</b></span><span title="Самое раннее наказание в доступной истории с 2019 года, включая снятые. Это не дата назначения на должность."><small>Первое наказание</small><b>${escape(firstLabel)}</b></span></div>
            <div class="kpis"><div class="kpi major">${numeric(p.totals.complaints)}<span>Закрытые жалобы<br>Тикеты + репорты</span></div>${['tickets','reports','bans','mutes'].map(k=>`<div class="kpi">${numeric(p.totals[k])}<span>${labels[k]}</span></div>`).join('')}</div>
            <div class="mini-stats"><span title="Дни хотя бы с одним действием из доступных метрик">Активные дни<b>${number(p.activeDays)}</b></span><span>Жалоб / активный день<b>${number(p.perActiveDay)}</b></span><span>Часы на прайме<b>${number(p.hours)}</b></span><span>Жалоб / час прайма<b>${number(p.perHour)}</b></span></div>
            <details class="coverage"><summary>Источники и полнота · ${escape(new Date(p.fetchedAt).toLocaleString('ru-RU'))}</summary><div class="coverage-content"><ul>${coverage(p)}</ul><p>Снято банов: ${number(p.removed.bans)}, мутов: ${number(p.removed.mutes)}. Ноль означает отсутствие записей в полученной выборке. «—» — данные недоступны.</p></div></details>
        </article>`;
    }).join('');
    $('summaries').querySelectorAll('[data-profile-avatar]').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;},{once:true}));
    if (!reducedMotion()) {
        const items = [...$('summaries').querySelectorAll('[data-number]')];
        const start = performance.now();
        const update = now => {
            const amount = Math.min(1,(now-start)/450), eased = 1-(1-amount)**3;
            items.forEach(el=>{el.textContent = number(Math.round(Number(el.dataset.number)*eased));});
            if(amount<1) animationFrame=requestAnimationFrame(update);
        };
        animationFrame=requestAnimationFrame(update);
    }
}
function comparison(profiles) {
    $('comparison').hidden = profiles.length !== 2;
    if(profiles.length!==2)return;
    const [a,b]=profiles;
    $('comparison').innerHTML = `<div class="panel-title"><div><p class="eyebrow">СОПОСТАВИМЫЕ ПОКАЗАТЕЛИ</p><h3>Два профиля. Один период.</h3></div></div><div class="comparison-header"><span>Показатель</span><span>${escape(a.name)}</span><span>Разница</span><span>${escape(b.name)}</span></div>`+['complaints','bans','mutes'].map(metric=>{
        const av=a.totals[metric],bv=b.totals[metric],max=Math.max(av||0,bv||0,1);
        const delta=av==null||bv==null?'—':(av-bv>0?'+':'')+number(av-bv);
        const percent=bv>0&&av!=null?`${av-bv>0?'+':''}${number((av-bv)/bv*100)}%`:'';
        return `<div class="comparison-row"><span>${labels[metric]}</span><div class="comparison-value"><b>${number(av)}</b><div class="bar"><i style="--width:${(av||0)/max*100}%"></i></div></div><em title="Первый профиль минус второй">${delta}<small>${percent}</small></em><div class="comparison-value second"><b>${number(bv)}</b><div class="bar"><i style="--width:${(bv||0)/max*100}%"></i></div></div></div>`;
    }).join('');
}
function rateComparison(profiles) {
    const target=$('rates');target.hidden=false;
    const values=profiles.map(p=>profileRatios(p.totals,p.coverage));
    const groups=[
        {label:'Импакт',suffix:'Complaints',base:'закрытые тикеты + репорты',key:'complaints',unit:'на 100 жалоб'},
        {label:'На 100 закрытых тикетов',suffix:'Tickets',base:'закрытые тикеты',key:'tickets',unit:'на 100 тикетов'}
    ];
    target.innerHTML=`<div class="panel-title"><div><p class="eyebrow">ИМПАКТ</p><h3>Соотношение действий</h3></div><span class="rate-hint">Наведите на число или нажмите, чтобы увидеть детали</span></div><p class="impact-intro">Импакт = (баны + муты) ÷ (закрытые тикеты + репорты) × 100</p><div class="rate-groups">`+groups.map((group,g)=>{
        const maximum=Math.max(0,...values.map(r=>r['punishmentsPer100'+group.suffix]||0))||1;
        return `<div class="rate-group ${g?'':'impact-primary'}" data-depth><h4>${group.label}</h4><div class="rate-values">${profiles.map((profile,i)=>{
        const ratio=values[i],total=ratio['punishmentsPer100'+group.suffix],tipId='rateDetail'+g+'_'+i;
        const other=profiles[1-i],otherValue=values[1-i]?.['punishmentsPer100'+group.suffix];
        const delta=total!=null&&otherValue!=null?total-otherValue:null;
        return `<div class="rate-insight ${i?'second':''}"><button type="button" class="rate-main" aria-expanded="false" aria-controls="${tipId}" aria-describedby="${tipId}"><span>${escape(profile.name)}</span><strong>${number(total)}</strong><small>${group.unit}</small><span class="rate-base">База: ${number(profile.totals[group.key])} ${group.key==='complaints'?'закрытых жалоб':'закрытых тикетов'}</span><span class="rate-bar" aria-hidden="true"><b style="--width:${total==null?0:total/maximum*100}%"></b></span><i aria-hidden="true">i</i></button><div class="rate-tooltip" id="${tipId}" role="tooltip" aria-hidden="true"><strong>${escape(profile.name)}</strong><p>${group.label} · ${group.unit}</p><dl><div><dt>Баны</dt><dd>${number(ratio['bansPer100'+group.suffix])}</dd></div><div><dt>Муты</dt><dd>${number(ratio['mutesPer100'+group.suffix])}</dd></div><div class="rate-total"><dt>Все наказания</dt><dd>${number(total)}</dd></div><div><dt>База: ${group.key==='complaints'?'закрытые жалобы':'закрытые тикеты'}</dt><dd>${number(profile.totals[group.key])}</dd></div></dl><div class="rate-share"><span>В составе наказаний</span><span>Баны <b>${ratio.bansShare==null?'—':number(ratio.bansShare)+'%'}</b></span><span>Муты <b>${ratio.mutesShare==null?'—':number(ratio.mutesShare)+'%'}</b></span></div>${other?`<p class="rate-difference">Разница с ${escape(other.name)}: <b>${delta==null?'—':(delta>0?'+':'')+number(delta)+' на 100'}</b></p>`:''}<p class="rate-formula">(Баны + муты) ÷ ${group.base} × 100. При нулевой базе или неполных данных — прочерк.</p></div></div>`;
    }).join('')}</div></div>`;}).join('')+`</div><p class="rate-note">Импакт может быть выше 100: это соотношение объёмов, а не процент успешных решений. Длина полос показывает соотношение профилей. Оценивайте число вместе с базой жалоб; наказания не обязательно связаны с этими жалобами.</p>`;
    const signal=interactions?.signal,options=signal?{signal}:{};
    const tips=new Map();let hideTimer;
    target.querySelectorAll('.rate-insight').forEach(wrapper=>{
        const tip=wrapper.querySelector('[role="tooltip"]');
        tip.style.setProperty('--profile-color',wrapper.classList.contains('second')?'var(--b)':'var(--a)');
        document.body.append(tip);tips.set(wrapper,tip);
    });
    const close=wrapper=>{
        clearTimeout(hideTimer);wrapper.removeAttribute('data-open');wrapper.removeAttribute('data-pinned');
        wrapper.querySelector('button').setAttribute('aria-expanded','false');
        const tip=tips.get(wrapper);tip?.removeAttribute('data-open');tip?.setAttribute('aria-hidden','true');
    };
    const place=wrapper=>{
        const tip=tips.get(wrapper),anchor=wrapper.querySelector('button').getBoundingClientRect();
        if(!tip)return;
        const rect=tip.getBoundingClientRect();
        tip.style.left=Math.max(16,Math.min(innerWidth-rect.width-16,anchor.left))+'px';
        const below=anchor.bottom+10,above=anchor.top-rect.height-10;
        const preferred=below+rect.height<=innerHeight-16?below:above>=16?above:Math.max(16,innerHeight-rect.height-16);
        tip.style.top=preferred+'px';
    };
    const open=wrapper=>{
        clearTimeout(hideTimer);
        tips.forEach((tip,other)=>{if(other!==wrapper)close(other);});
        wrapper.setAttribute('data-open','');wrapper.querySelector('button').setAttribute('aria-expanded','true');
        const tip=tips.get(wrapper);tip.setAttribute('data-open','');tip.setAttribute('aria-hidden','false');place(wrapper);
    };
    const leave=wrapper=>{
        clearTimeout(hideTimer);hideTimer=setTimeout(()=>{
            const tip=tips.get(wrapper);
            if(!wrapper.hasAttribute('data-pinned')&&!wrapper.contains(document.activeElement)&&!wrapper.matches(':hover')&&!tip?.matches(':hover'))close(wrapper);
        },180);
    };
    tips.forEach((tip,wrapper)=>{
        wrapper.addEventListener('pointerenter',()=>open(wrapper),options);
        wrapper.addEventListener('pointerleave',()=>leave(wrapper),options);
        tip.addEventListener('pointerenter',()=>open(wrapper),options);
        tip.addEventListener('pointerleave',()=>leave(wrapper),options);
        wrapper.addEventListener('focusin',()=>open(wrapper),options);
        wrapper.addEventListener('focusout',event=>{if(!wrapper.contains(event.relatedTarget)&&!tip.contains(event.relatedTarget)&&!wrapper.hasAttribute('data-pinned'))close(wrapper);},options);
        wrapper.querySelector('button').addEventListener('click',()=>{
            if(wrapper.hasAttribute('data-pinned'))close(wrapper);
            else{wrapper.setAttribute('data-pinned','');open(wrapper);}
        },options);
    });
    document.addEventListener('pointerdown',event=>{
        tips.forEach((tip,wrapper)=>{if(!wrapper.contains(event.target)&&!tip.contains(event.target))close(wrapper);});
    },options);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')tips.forEach((tip,wrapper)=>close(wrapper));},options);
    const reposition=()=>tips.forEach((tip,wrapper)=>{if(wrapper.hasAttribute('data-open'))place(wrapper);});
    window.addEventListener('resize',reposition,options);
    window.addEventListener('scroll',reposition,{...options,capture:true,passive:true});
    signal?.addEventListener('abort',()=>{clearTimeout(hideTimer);tips.forEach(tip=>tip.remove());},{once:true});

}
function niceMax(value) {
    if(value<=1)return 1;
    const power=10**Math.floor(Math.log10(value));
    return [1,2,5,10].find(n=>n*power>=value)*power;
}
function chart(profiles,selected,signal) {
    const metric=$('metric').value,unit=$('unit').value;
    const series=profiles.map(p=>new Map(groupDays(p.days,unit,metric)));
    const calendar=[];
    for(let t=dayStart(selected.start);t<=dayStart(selected.end);t+=86400)calendar.push({date:dayKey(t),[metric]:0});
    const keys=groupDays(calendar,unit,metric).map(d=>d[0]);
    const max=niceMax(Math.max(1,...series.flatMap(s=>[...s.values()])));
    const width=1100,height=290,left=44,right=width-12,top=14,bottom=height-34;
    const x=i=>left+i/Math.max(1,keys.length-1)*(right-left);
    const y=value=>bottom-value/max*(bottom-top);
    const grid=[0,.25,.5,.75,1].map(f=>`<line class="gridline" x1="${left}" y1="${y(max*f)}" x2="${right}" y2="${y(max*f)}"/><text class="axis" x="0" y="${y(max*f)+4}">${shortNumber(max*f)}</text>`).join('');
    const paths=series.map((s,i)=>{
        if(profiles[i].totals[metric]==null)return '';
        const points=keys.map((key,j)=>`${x(j)},${y(s.get(key)||0)}`).join(' ');
        const fill=i===0?`<polygon points="${left},${bottom} ${points} ${right},${bottom}" fill="url(#chart-fill)"/>`:'';
        return `${fill}<polyline class="chart-line chart-line-${i?'b':'a'}" stroke-width="2.1" points="${points}"/>`;
    }).join('');
    const ticks=[...new Set([0,Math.floor((keys.length-1)/4),Math.floor((keys.length-1)/2),Math.floor((keys.length-1)*3/4),keys.length-1])].filter(i=>i>=0).map(i=>`<text class="axis" x="${x(i)}" y="${height-4}" text-anchor="${i===0?'start':i===keys.length-1?'end':'middle'}">${keys[i]}</text>`).join('');
    const table=`<details class="coverage"><summary>Посмотреть данные таблицей</summary><div class="coverage-content table-wrap"><table><thead><tr><th>Период</th>${profiles.map(p=>`<th>${escape(p.name)}</th>`).join('')}</tr></thead><tbody>${keys.map(key=>`<tr><td>${key}</td>${profiles.map((p,i)=>`<td>${p.totals[metric]==null?'—':number(series[i].get(key)||0)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
    $('chart').innerHTML=`<div class="chart-readout" id="chartReadout"></div><div class="chart-stage"><svg tabindex="0" viewBox="0 0 ${width} ${height}" role="group" aria-label="Интерактивный график: ${labels[metric]}" aria-describedby="chartInstructions"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--a)" stop-opacity=".13"/><stop offset="100%" stop-color="var(--a)" stop-opacity="0"/></linearGradient></defs>${grid}${paths}${ticks}<line class="chart-guide" id="chartGuide" x1="${right}" x2="${right}" y1="${top}" y2="${bottom}"/>${profiles.map((p,i)=>p.totals[metric]!=null?`<circle class="chart-marker" id="chartMarker${i}" r="4.5" fill="var(--${i?'b':'a'})"/>`:'').join('')}</svg></div><p id="chartInstructions" class="chart-help">Наведите на график или используйте ← → после фокуса, чтобы изучить период.</p>${table}`;
    let selectedIndex=keys.length-1;
    const svg=$('chart').querySelector('svg'),guide=$('chartGuide');
    const select=index=>{
        selectedIndex=Math.max(0,Math.min(keys.length-1,index));
        const key=keys[selectedIndex];
        $('chartReadout').innerHTML=`<time>${escape(dateLabel(key))}</time>`+profiles.map((p,i)=>`<span class="${i?'second':''}"><i></i>${escape(p.name)}<b>${p.totals[metric]==null?'—':number(series[i].get(key)||0)}</b></span>`).join('');
        guide.setAttribute('x1',x(selectedIndex));guide.setAttribute('x2',x(selectedIndex));
        profiles.forEach((p,i)=>{const marker=$('chartMarker'+i);if(marker){marker.setAttribute('cx',x(selectedIndex));marker.setAttribute('cy',y(series[i].get(key)||0));}});
        svg.setAttribute('aria-label',`${labels[metric]}, ${dateLabel(key)}. `+profiles.map((p,i)=>`${p.name}: ${p.totals[metric]==null?'недоступно':number(series[i].get(key)||0)}`).join('. '));
    };
    select(selectedIndex);
    const stage=svg.parentElement;
    stage.scrollLeft=stage.scrollWidth-stage.clientWidth;
    svg.addEventListener('pointermove',event=>{
        const rect=svg.getBoundingClientRect(),at=(event.clientX-rect.left)/rect.width*width;
        select(Math.round((at-left)/(right-left)*(keys.length-1)));
    },{signal});
    svg.addEventListener('keydown',event=>{
        const steps={ArrowLeft:-1,ArrowRight:1,PageUp:-7,PageDown:7};
        if(event.key==='Home'){event.preventDefault();select(0);}
        else if(event.key==='End'){event.preventDefault();select(keys.length-1);}
        else if(event.key in steps){event.preventDefault();select(selectedIndex+steps[event.key]);}
        else return;
        const point=x(selectedIndex)/width*svg.getBoundingClientRect().width;
        if(point<stage.scrollLeft+24||point>stage.scrollLeft+stage.clientWidth-24)stage.scrollLeft=Math.max(0,point-stage.clientWidth/2);
    },{signal});
    if(!reducedMotion())svg.animate([{opacity:.15,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:360,easing:'cubic-bezier(.2,.75,.25,1)'});
}
function calendar(profile,metric,selected,index) {
    if(profile.totals[metric]==null)return '<p class="no-data">Для этого профиля показатель недоступен.</p>';
    const days=[],byDate=new Map(profile.days.map(d=>[d.date,d]));
    const first=Math.max(dayStart(selected.start),dayStart(profile.range.end)-181*86400);
    const leading=(new Date(first*1000+10800000).getUTCDay()+6)%7;
    const max=Math.max(1,...profile.days.map(d=>d[metric]));
    for(let t=first;t<=dayStart(profile.range.end);t+=86400){const date=dayKey(t);days.push(byDate.get(date)||{date,[metric]:0});}
    const columns=Math.ceil((days.length+leading)/7);
    return `<div class="calendar-wrap"><div class="weekdays" aria-hidden="true"><span>Пн</span><span></span><span>Ср</span><span></span><span>Пт</span><span></span><span>Вс</span></div><div class="heatmap" style="grid-template-columns:repeat(${columns},1fr);width:min(100%,${columns*18-4}px)">${'<span class="heat-blank" aria-hidden="true"></span>'.repeat(leading)}${days.map(d=>`<button type="button" tabindex="-1" class="${d[metric]?'heat':''}" style="--heat:${Math.round(18+82*d[metric]/max)}%" title="${d.date}: ${number(d[metric])}" aria-label="${escape(dateLabel(d.date))}: ${labels[metric].toLowerCase()} ${number(d[metric])}" data-heat-index="${index}" data-heat-date="${d.date}" data-heat-value="${d[metric]}"></button>`).join('')}</div></div><div class="calendar-readout"><span id="calendarReadout${index}">Последние ${days.length} дней периода</span><span class="heat-key" aria-label="От меньшей активности к большей"><i></i><i></i><i></i><i></i></span></div>`;
}
function details(profiles,selected,signal) {
    const metric=$('metric').value;
    $('details').innerHTML=profiles.map((p,i)=>{
        const ranks=rankDays(p.days,metric),available=p.totals[metric]!=null;
        const reasonGroups=['bans','mutes'].map(k=>`<div class="reason-group"><h4>${labels[k]}</h4>${Object.entries(p.reasons[k]).sort((a,b)=>b[1]-a[1]).map(([reason,n])=>`<div class="reason"><span>${escape(reasonLabel(reason))}</span><b>${number(n)}</b><div class="bar"><i style="--width:${100*n/Math.max(1,p.totals[k]||0)}%"></i></div></div>`).join('')||'<p class="no-data">Нет доступных записей</p>'}</div>`).join('');
        const ranked=available?`<div class="table-wrap"><table><thead><tr><th>Место</th><th>Дата</th><th>${labels[metric]}</th></tr></thead><tbody>${ranks.slice(0,100).map(d=>`<tr class="${d.rank<=3?'rank-leading':''}"><td class="rank-number">${String(d.rank).padStart(2,'0')}</td><td>${escape(dateLabel(d.date))}</td><td>${number(d[metric])}</td></tr>`).join('')||'<tr><td colspan="3">За этот период нет действий</td></tr>'}</tbody></table></div>`:'<p class="no-data">Для этого профиля показатель недоступен.</p>';
        return `<div class="detail-column ${i?'second':''}"><section class="surface"><div class="detail-header"><h3>Лучшие дни</h3><span class="pill">${escape(p.name)}</span></div><p class="panel-caption">${labels[metric]} · ${dateLabel(selected.start)} — ${dateLabel(selected.end)}</p>${ranked}</section><section class="surface"><h3>Календарь активности</h3><p class="panel-caption">${escape(p.name)} · ${labels[metric].toLowerCase()}</p>${calendar(p,metric,selected,i)}</section><section class="surface"><h3>Причины наказаний</h3><p class="panel-caption">${escape(p.name)} · за выбранный период</p>${reasonGroups}</section></div>`;
    }).join('');
    const read=event=>{
        const button=event.target.closest('[data-heat-date]');if(!button)return;
        $('calendarReadout'+button.dataset.heatIndex).textContent=`${dateLabel(button.dataset.heatDate)} · ${number(Number(button.dataset.heatValue))}`;
    };
    $('details').addEventListener('pointerover',read,{signal});
    $('details').addEventListener('focusin',event=>{
        read(event);
        const button=event.target.closest('[data-heat-date]');
        if(button){button.parentElement.querySelectorAll('button').forEach(b=>b.tabIndex=b===button?0:-1);}
    },{signal});
    $('details').querySelectorAll('.heatmap').forEach(map=>{
        const buttons=[...map.querySelectorAll('button')];if(buttons.length)buttons.at(-1).tabIndex=0;
        map.addEventListener('keydown',event=>{
            const at=buttons.indexOf(event.target),steps={ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1};
            let next=at;
            if(event.key==='Home')next=0;
            else if(event.key==='End')next=buttons.length-1;
            else if(event.key in steps)next=Math.max(0,Math.min(buttons.length-1,at+steps[event.key]));
            else return;
            event.preventDefault();buttons[next]?.focus();
        },{signal});
    });
}

export function renderDashboard(profiles) {
    if(!profiles.length)return;
    interactions?.abort();interactions=new AbortController();
    cancelAnimationFrame(animationFrame);
    $('summaries').querySelectorAll('[data-number]').forEach(el=>{el.textContent=number(Number(el.dataset.number));});
    $('results').hidden=false;$('empty').hidden=true;
    const selected=displayRange(profiles),identity=JSON.stringify(profiles.map(p=>({id:p.steamId,name:p.name,avatar:p.avatar,className:p.className,firstPunishmentAt:p.firstPunishmentAt,firstPunishmentComplete:p.firstPunishmentComplete,at:p.fetchedAt,range:p.range,totals:p.totals,removed:p.removed,coverage:p.coverage})));
    $('rangeTitle').textContent=`${dateLabel(selected.start)} — ${dateLabel(selected.end)}`;
    if(identity!==dataIdentity){profileCards(profiles);dataIdentity=identity;}
    $('legend').innerHTML=profiles.map(p=>`<span><i></i>${escape(p.name)}</span>`).join('');
    comparison(profiles);rateComparison(profiles);chart(profiles,selected,interactions.signal);details(profiles,selected,interactions.signal);
    bindDepthMotion($('results'),interactions.signal);
}
window.addEventListener('pagehide',()=>{interactions?.abort();cancelAnimationFrame(animationFrame);},{once:true});
