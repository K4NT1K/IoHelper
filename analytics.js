import {HISTORY_START, aggregateProfile, dateRange, validateRange} from './modules/analytics/model.js';
import {cacheRead, cacheWrite, cacheKey, cacheClear, cohortRead, cohortWrite} from './modules/analytics/cache.js';
import {renderDashboard} from './modules/analytics/uiDashboard.js';
import {renderCohort} from './modules/analytics/uiCohort.js';
import {buildDirectory, filterDirectory} from './modules/analytics/directory.js';
import {moderatorSearch} from './modules/analytics/uiModeratorSearch.js';
import {runCohort} from './modules/analytics/cohort.js';
import {validScheduleSnapshot} from './modules/shared/moderators.js';
const $ = id => document.getElementById(id);
let profiles = [], generation = 0, jobId = null, busy = false, directory = [], cohort = null, scheduleAt = 0, focusResults = false, rosterRequest = null;
const range = () => ({start: $('startDate').value, end: $('endDate').value});
const status = (text, type = '') => {$('status').textContent = text; $('status').className = 'status ' + type; $('controls').setAttribute('aria-busy', String(type === 'busy'));};
const message = async request => {
    const response = await chrome.runtime.sendMessage(request);
    if (!response?.success) throw new Error(response?.error || 'Не удалось связаться с расширением');
    return response;
};
const searchA = moderatorSearch($('profileA'), () => directory), searchB = moderatorSearch($('profileB'), () => directory);
function setRange() {
    const value = $('period').value;
    const selected = value === 'all' ? {start: HISTORY_START, end: dateRange().end} : dateRange(Number(value) || 30);
    if (value !== 'custom') {$('startDate').value = selected.start; $('endDate').value = selected.end;}
}
$('period').addEventListener('change', setRange); setRange();
for (const id of ['startDate', 'endDate']) $(id).addEventListener('change', () => {$('period').value = 'custom';});
searchA.set(new URLSearchParams(location.search).get('steamId') || '');
function updateDirectoryStatus() {
    const count = filterDirectory(directory, $('cohortSource').value).length;
    const source = $('cohortSource').value;
    const label = source === 'config' ? 'конфиг' : source === 'schedule' ? 'API расписания · 7 дней' : 'конфиг + API расписания';
    $('directoryStatus').textContent = `Модераторов: ${count} · ${label}${source !== 'config' ? (scheduleAt ? ' от ' + new Date(scheduleAt).toLocaleString('ru-RU') : ' (скан пока отсутствует)') : ''}`;
    if (!count && source === 'schedule') $('directoryStatus').textContent = 'Состав API ещё не получен. Сравнение сначала загрузит расписание семи дней.';
    $('compareAll').disabled = busy || (!count && source !== 'schedule');
}
async function loadDirectory() {
    const stored = await chrome.storage.local.get(['helperConfig', 'helperScheduleModerators']);
    const config = stored.helperConfig || (await message({action: 'getHelperConfig'})).config;
    const snapshot = validScheduleSnapshot(stored.helperScheduleModerators) ? stored.helperScheduleModerators : {};
    scheduleAt = snapshot.scannedAt || 0;
    directory = buildDirectory(config, snapshot);
    for (const profile of [...profiles, ...(cohort?.profiles || [])]) enrich(profile);
    updateDirectoryStatus();
}
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.helperConfig || changes.helperScheduleModerators)) void loadDirectory().catch(() => {});
});
$('cohortSource').addEventListener('change', updateDirectoryStatus);
function setBusy(value) {
    busy = value;
    for (const el of $('controls').querySelectorAll('input,select')) el.disabled = value;
    for (const id of ['load', 'clearCache', 'compareAll', 'cohortResume']) $(id).disabled = value;
    $('cancel').hidden = !value; $('cohortCancel').hidden = !value || cohort?.status !== 'running';
    if (!value) updateDirectoryStatus();
}
function paintCohort() {
    if (!cohort) {$('cohort').hidden = true; $('cohortResume').hidden = true; return;}
    renderCohort(cohort, {onCompare: ids => showProfiles(ids), onSelectProfile: id => showProfiles([id])});
    $('cohortResume').hidden = (!['cancelled', 'failed'].includes(cohort.status) || cohort.completed >= cohort.total) && !cohort.failed.length;
    $('cohortResume').textContent = cohort.failed.length && cohort.completed >= cohort.total ? 'Повторить неудачные запросы' : 'Продолжить сбор';
    $('cohortResume').disabled = busy;
    $('empty').hidden = !!cohort.profiles.length || !!profiles.length;
}
function showProfiles(ids) {
    if (busy) return status('Дождитесь завершения сбора или остановите его для отдельного сравнения.');
    searchA.set(ids[0]); searchB.set(ids[1]); $('controls').requestSubmit(); $('status').scrollIntoView({block: 'center'});
}
function enrich(profile) {
    const member = directory.find(m => m.steamId === profile.steamId);
    if (member) {
        member.aliases = [...new Set([...member.aliases, profile.name])]; member.name = profile.name; member.avatar = profile.avatar;
        if (profile.className) member.className = profile.className;
        else profile.className = member.className || '';
    }
    return profile;
}
async function collect(steamId, selected, token, onStarted) {
    const response = await message({action: 'analyticsStart', steamId, range: selected});
    const currentJobId = response.jobId; jobId = currentJobId;
    if (onStarted) await onStarted(currentJobId);
    if (token !== generation) {await message({action: 'analyticsCancel', jobId: currentJobId}).catch(() => {}); throw new Error('Сбор отменён');}
    while (token === generation) {
        const {job} = await message({action: 'analyticsStatus'});
        if (job?.id !== currentJobId) throw new Error('Задача заменена в другой вкладке');
        status(`${steamId} · ${job.stage || 'Загрузка'}`, 'busy');
        if (job.status === 'complete') {
            const result = job.result;
            await message({action: 'analyticsAcknowledge', jobId: currentJobId}).catch(() => {}); jobId = null;
            return result;
        }
        if (job.status === 'failed' || job.status === 'cancelled') {jobId = null; throw new Error(job.error || 'Сбор отменён');}
        await new Promise(resolve => setTimeout(resolve, 600));
    }
    throw new Error('Сбор отменён');
}
$('controls').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const ids = [searchA.resolve(), $('profileB').value.trim() ? searchB.resolve() : null];
    if (!ids[0] || ($('profileB').value.trim() && !ids[1])) return status('Выберите ник из подсказок либо укажите корректный SteamID64 или ссылку.', 'error');
    if (ids[0] === ids[1]) return status('Для сравнения укажите двух разных модераторов.', 'error');
    const selected = range();
    if (!validateRange(selected)) return status('Проверьте даты: начало не позже конца, без будущих дат.', 'error');
    const token = ++generation; jobId = null; focusResults = true; setBusy(true); status('Подготовка статистики…', 'busy');
    const includeRemoved = $('removed').checked; profiles = [];
    try {
        const cached = await Promise.all(ids.filter(Boolean).map(id => cacheRead(cacheKey(id, selected, includeRemoved)).catch(() => null)));
        if (token !== generation) return;
        profiles = cached.filter(Boolean); if (profiles.length) render();
        const current = [];
        for (const steamId of ids.filter(Boolean)) {
            const source = await collect(steamId, selected, token);
            if (token !== generation) return;
            const aggregate = enrich(aggregateProfile(source, selected, includeRemoved));
            await cacheWrite(cacheKey(steamId, selected, includeRemoved), aggregate).catch(() => {});
            current.push(aggregate); profiles = [...current]; render();
        }
        const coreIncomplete = profiles.some(p => ['tickets', 'reports', 'bans', 'mutes'].some(key => !p.coverage[key]?.available || p.coverage[key].partial));
        const timeIncomplete = profiles.some(p => !p.coverage.shifts?.available || p.coverage.shifts.partial);
        status(coreIncomplete ? 'Часть статистики недоступна. Подробности указаны в «Источники и полнота» у профиля.'
            : timeIncomplete ? 'Статистика жалоб и наказаний обновлена. Рабочее время ограничено данными API — подробности указаны у профиля.'
            : 'Статистика обновлена. Время получения и источники указаны у каждого профиля.');
    } catch (error) {if (token === generation) status(error.message + (profiles.length ? ' Показаны ранее полученные данные.' : ''), 'error');}
    finally {await releaseJob(); setBusy(false);}
});
async function startCohort(resume = false) {
    if (busy) return;
    if (resume && !cohort) return;
    const selected = resume ? cohort.period : range(), chosenSource = $('cohortSource').value;
    if (!validateRange(selected)) return status('Проверьте выбранный период.', 'error');
    const token = ++generation; let started = false; setBusy(true);
    try {
        if (!resume) {
            if (chosenSource !== 'config') {
                rosterRequest = crypto.randomUUID(); status('Проверяем состав модераторов через API расписания…', 'busy');
                const response = await message({action: 'requestScheduleScan', clientRequestId: rosterRequest});
                rosterRequest = null;
                if (token !== generation) return;
                await loadDirectory();
                if (!scheduleAt) throw new Error(response.state?.error || 'Состав API пока недоступен. Дождитесь завершения обновления или выберите «Конфиг».');
            }
            const members = filterDirectory(directory, chosenSource).map(m => ({...m}));
            if (!members.length) throw new Error('Список модераторов пуст. Проверьте источник списка.');
            cohort = {version: 2, runId: crypto.randomUUID(), members, profiles: [], failed: [], finishedIds: [], completed: 0, total: members.length,
                period: selected, includeRemoved: $('removed').checked, source: chosenSource, rosterAt: scheduleAt, startedAt: Date.now(), updatedAt: Date.now(), status: 'running'};
        } else if (cohort.failed.length) {
            const failed = new Set(cohort.failed.map(member => member.steamId));
            cohort.finishedIds = cohort.finishedIds.filter(id => !failed.has(id));
            cohort.failed = []; cohort.completed = cohort.finishedIds.length;
        }
        if (token !== generation) return;
        started = true; cohort.status = 'running'; paintCohort();
        $('cohort').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
        if (resume && cohort.activeJobId) {
            const {job} = await message({action: 'analyticsStatus'});
            if (job?.id === cohort.activeJobId && ['queued', 'running'].includes(job.status)) await message({action: 'analyticsCancel', jobId: job.id});
        }
        await cohortWrite(cohort, {replace: !resume});
        await runCohort(cohort, {
            collect: async member => enrich(aggregateProfile(await collect(member.steamId, cohort.period, token,
                async id => {cohort.activeJobId = id; await cohortWrite(cohort);}), cohort.period, cohort.includeRemoved)),
            save: cohortWrite, onProgress: paintCohort, isCurrent: () => token === generation
        });
        status(cohort.status === 'complete' ? `Сравнение завершено: получено ${cohort.profiles.length} из ${cohort.total}. Ошибок: ${cohort.failed.length}.`
            : cohort.status === 'failed' ? 'Сбор остановлен после трёх ошибок подряд. Проверьте вход в админку; результаты сохранены, сбор можно продолжить.'
            : 'Сбор остановлен. Уже полученные результаты сохранены.');
    } catch (error) {
        if (started) cohort.status = 'failed';
        if (token === generation) status(error.message + ' Уже полученные данные остаются на странице.', 'error');
    }
    finally {rosterRequest = null; await releaseJob(); setBusy(false); paintCohort();}
}
$('compareAll').addEventListener('click', () => startCohort());
$('cohortResume').addEventListener('click', () => startCohort(true));
async function cancel() {
    if (!busy) return; generation++;
    status('Останавливаем сбор…', 'busy');
    if (rosterRequest) await message({action: 'cancelScheduleScan', clientRequestId: rosterRequest}).catch(() => {});
    if (jobId) await message({action: 'analyticsCancel', jobId}).catch(() => {});
    status('Сбор отменён. Уже полученные данные сохранены.');
}
async function releaseJob() {
    if (jobId) await message({action: 'analyticsCancel', jobId}).catch(() => {});
    jobId = null;
}
$('cancel').addEventListener('click', cancel); $('cohortCancel').addEventListener('click', cancel);
$('clearCache').addEventListener('click', async () => {
    if (!busy) try {
        await message({action: 'analyticsClear'}); await cacheClear(); cohort = null; profiles = []; paintCohort();
        $('results').hidden = true; $('empty').hidden = false; status('Локальный кэш очищен.');
    } catch (error) {status(error.message, 'error');}
});
for (const id of ['metric', 'unit']) $(id).addEventListener('change', render);
function render() {
    renderDashboard(profiles);
    if (focusResults && profiles.length) {focusResults = false; $('results').scrollIntoView({block: 'start'});}
}
await loadDirectory().catch(error => status('Список модераторов недоступен: ' + error.message, 'error'));
try {
    const stored = await cohortRead();
    if (stored?.version === 2 && validateRange(stored.period) && Array.isArray(stored.members)) {
        cohort = stored; cohort.profiles.forEach(enrich);
        if (cohort.status === 'running') cohort.status = 'cancelled'; paintCohort();
    }
} catch {/* Manual profile lookup remains available if local storage is unavailable. */}
