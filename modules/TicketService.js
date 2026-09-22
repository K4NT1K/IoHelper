import { SitePunishmentBridge } from './SitePunishmentBridge.js';
import { compileRuleMatcher, detectSpamLinear } from './shared/RuleMatcher.js';
import { TicketScopeMethods } from './ticket/TicketScope.js';
import { ChatAnalyzerMethods } from './ticket/ChatAnalyzer.js';
import { VerdictMethods } from './ticket/Verdict.js';
import { AnalysisBadgeMethods } from './ticket/AnalysisBadge.js';
import { ActivePunishmentMethods } from './ticket/ActivePunishment.js';
import { AutoConnectMethods } from './ticket/AutoConnect.js';
import { QueueCardsMethods } from './ticket/QueueCards.js';
import { PunishmentPanelMethods } from './ticket/PunishmentPanel.js';
import { OffenderProfileMethods } from './ticket/OffenderProfile.js';
import { OffenderTrackingMethods } from './ticket/OffenderTracking.js';

export class TicketService {
    constructor({document, utils, badgeService, settings, rules, muteExceptions = {}, chrome = null}) {
        this.document = document;
        this.utils = utils;
        this.badgeService = badgeService;
        this.settings = settings;
        this._rules = rules;
        this._muteExceptions = muteExceptions;
        this.chrome = chrome;
        this._ruleMatcher = compileRuleMatcher(rules, muteExceptions);
        this._scopeCache = new WeakMap();
        this._offenderRowSnapshots = new WeakMap();
        this._vipRafId = null;
        this._vipPending = new Set();

        this.triggerRows = new Map();
        this.handleTriggerClick = this.handleTriggerClick.bind(this);
        this.isCheckingServer = false;
        this.offenderProfileCache = new Map();
        this.offenderProfileInflight = new Map();
        this.autoConnectedServerIps = new Map();
        this._autoConnectSkipLoggedIps = new Set();
        this.chatSignatureByKey = new Map();
        this.activePunishmentBadgeByKey = new Map();
        this.suggestedMuteReason = null;
        this.globalServerCooldown = 0;
        this.offenderOffline = new Map();
        this.offenderRelocated = new Map();
        this.userDataCache = new Map();
        this._openTicketOffenderLastCheck = 0;
        this.LEFT_OFFENDER_TTL_MS = 8 * 60 * 1000;

        this.MODERATOR_PERMISSIONS_KEY = 'iohModeratorPermissions';
        this.MUTE_MANAGEMENT_ROUTE = '/comms/list';
        this.BAN_MANAGEMENT_ROUTE = '/bans/list';
        this.TICKET_PUNISHMENT_ACTIONS_ID = 'ioh-ticket-punishment-actions';
        this.TICKET_MUTE_BUTTON_ID = 'ioh-ticket-issue-mute';
        this.TICKET_BAN_BUTTON_ID = 'ioh-ticket-issue-ban';
        this.TICKET_LIST_TAB_LABELS = ['Актуальные тикеты'];
        this.canIssueMute = false;
        this.canIssueBan = false;
        this.mutePanelReady = false;
        this.banPanelReady = false;
        this._cachedOpenMuteHandler = null;
        this._cachedOpenBanHandler = null;
        this._cachedMuteIssueButton = null;
        this._cachedBanIssueButton = null;
        this._punishmentPermissionObserver = null;
        this._punishmentPermissionDebounceId = null;
        this._muteRevokeDebounceId = null;
        this._banRevokeDebounceId = null;
        this._lastPunishmentScope = null;
        this._isUpdatingPunishmentButtons = false;
        this._permissionsHydrated = false;
        this._permissionScanSuppressed = 0;
        this._wasMutePanelActive = false;
        this._wasBanPanelActive = false;
        this._lastManagementOpenedViaAside = false;
        this._punishmentInitFailCount = 0;
        this.handleTicketMuteButtonClick = this.handleTicketMuteButtonClick.bind(this);
        this.handleTicketBanButtonClick = this.handleTicketBanButtonClick.bind(this);
        this.punishmentBridge = new SitePunishmentBridge({document, ticketService: this});
    }

    get rules() {
        return this._rules;
    }

    set rules(value) {
        this._rules = value;
        this._ruleMatcher = compileRuleMatcher(value, this._muteExceptions);
    }

    get muteExceptions() {
        return this._muteExceptions;
    }

    set muteExceptions(value) {
        this._muteExceptions = value || {};
        this._ruleMatcher = compileRuleMatcher(this._rules, this._muteExceptions);
    }

    recompileRuleMatcher() {
        this._ruleMatcher = compileRuleMatcher(this._rules, this._muteExceptions);
    }

    async processTicketRules(textarea) {
        if (!this.isVisibleTicketTextarea(textarea)) {
            return {kind: 'skip'};
        }

        const scope = this.getTicketScopeRoot(textarea);
        if (!this.isChatHistorySettledScoped(scope)) {
            return {kind: 'pending'};
        }

        const blocks = this.getHistoryBlocks(scope, {force: true});
        const analysisIcons = this.getAnalysisIcons();
        const {
            triggers,
            reason,
            info: infoIcon,
            punishment,
            chatError,
            shield,
            done
        } = analysisIcons;
        const banIcon = analysisIcons.ban || chatError;
        const muteIcon = analysisIcons.mute || chatError;
        const warningIcon = analysisIcons.warning || chatError;
        const doneIcon = done || shield || chatError;

        const muteHistoryBlock = blocks.mute;
        const banHistoryBlock = blocks.ban;
        const chatHistoryBlock = blocks.chat;
        const warningHistoryBlock = blocks.warning;
        const cacheKey = this.getChatCacheKey(textarea);
        const pathname = window.location.pathname;

        // Pipeline: ban → mute → chat → covering warning → verdict.
        // Active ban/mute short-circuit — do not scan chat or warnings.

        const activeBanRow = this.findActivePunishmentRow(banHistoryBlock);
        if (activeBanRow) {
            const signature = `${pathname}|ban:${this.getPunishmentRowFingerprint(activeBanRow)}`;
            if (this.chatSignatureByKey.get(cacheKey) === signature) {
                return {kind: 'unchanged'};
            }
            this.chatSignatureByKey.set(cacheKey, signature);
            this.clearSuggestedMuteReason();
            if (!this.shouldSkipActivePunishmentBadge('ban', activeBanRow, textarea)) {
                this.badgeService.updateInfoBadge(
                    'helper-suggest-badge',
                    'accent',
                    this.buildActivePunishmentBadge(banIcon, ' ЗАБАНЕН', activeBanRow),
                    textarea
                );
            }
            return {kind: 'skip'};
        }

        const activeMuteRow = this.findActivePunishmentRow(muteHistoryBlock);
        if (activeMuteRow) {
            const signature = `${pathname}|mute:${this.getPunishmentRowFingerprint(activeMuteRow)}`;
            if (this.chatSignatureByKey.get(cacheKey) === signature) {
                return {kind: 'unchanged'};
            }
            this.chatSignatureByKey.set(cacheKey, signature);
            this.clearSuggestedMuteReason();
            if (!this.shouldSkipActivePunishmentBadge('mute', activeMuteRow, textarea)) {
                this.badgeService.updateInfoBadge(
                    'helper-suggest-badge',
                    'warning',
                    this.buildActivePunishmentBadge(muteIcon, ' АКТИВНЫЙ МУТ', activeMuteRow),
                    textarea
                );
            }
            return {kind: 'skip'};
        }

        this.activePunishmentBadgeByKey.delete(cacheKey);

        const rows = Array.from(chatHistoryBlock?.querySelectorAll('tbody tr, tr') || [])
            .filter(row => row.querySelector('td'));
        const lastRow = rows[rows.length - 1];
        const chatEmpty = this.isChatHistoryEmptyScoped(scope) || rows.length === 0;
        const warnPart = this.getWarningHistorySignaturePart(warningHistoryBlock);
        const signature = chatEmpty
            ? `${pathname}|empty|${warnPart}`
            : `${pathname}|${rows.length}|${(lastRow.innerText || '').trim().slice(0, 220)}|${warnPart}`;

        if (this.chatSignatureByKey.get(cacheKey) === signature) {
            return {kind: 'unchanged'};
        }
        this.chatSignatureByKey.set(cacheKey, signature);

        if (chatEmpty) {
            this.clearSuggestedMuteReason();
            this.badgeService.updateInfoBadge(
                'helper-suggest-badge',
                'muted',
                `<div class="ioh-badge-row"><span class="ioh-icon-box">${chatError}</span><span>ЧАТ ПУСТ</span></div>`,
                textarea
            );
            return {kind: 'none'};
        }

        const lastMuteDate = this.findLastMuteWithin24h(muteHistoryBlock);
        const analysis = this.analyzeChatRows(rows, lastMuteDate);
        let {allViolations, ruleCounters} = analysis;

        // Covering warning needs chat triggers. Runs before dropSoloTrolling so a
        // solo «завали» still matches «Не провоцируйте» in warning history.
        const coveringWarning = this.getCoveringWarningWithoutNewTriggers(warningHistoryBlock, allViolations);
        if (coveringWarning) {
            this.clearSuggestedMuteReason();
            this.badgeService.updateInfoBadge(
                'helper-suggest-badge',
                'warning',
                `<div class="ioh-badge-row ioh-warning-text-tooltip" data-full-msg="${this.utils.escapeHtml(coveringWarning.text)}" title=""><span class="ioh-icon-box">${warningIcon}</span><span><b> Игроку уже выдано предупреждение!</b></span></div>`,
                textarea
            );
            return {kind: 'skip'};
        }

        ({allViolations, ruleCounters} = this.dropSoloTrollingViolation(allViolations, ruleCounters));

        const activeStats = Object.entries(ruleCounters)
            .filter(([, count]) => count > 0);
        const activeStatsSummary = activeStats
            .map(([name, count]) => `${name}: ${count}`)
            .join(' | ');
        const activityHTML = activeStatsSummary
            ? ` <span class="ioh-activity-text">(${this.utils.escapeHtml(activeStatsSummary)})</span>`
            : '';

        if (allViolations.length === 0) {
            this.clearSuggestedMuteReason();
            this.badgeService.updateInfoBadge(
                'helper-suggest-badge',
                'success',
                `<div class="ioh-badge-row">${doneIcon}<span>НЕТ НАРУШЕНИЙ ${activityHTML}</span></div>`,
                textarea
            );
            return {kind: 'none'};
        }

        const mostSevere = this.findMostSeverePunishment(ruleCounters);
        if (!mostSevere) {
            this.clearSuggestedMuteReason();
            return {kind: 'skip'};
        }

        const {
            finalName,
            finalDuration,
            finalDurationStr
        } = this.calculateFinalPunishment(mostSevere.rule, mostSevere.count, ruleCounters);

        const sortedTriggers = allViolations
            .sort((a, b) => b.severity - a.severity || b.duration - a.duration || a.keyword.localeCompare(b.keyword));

        const topTriggersHTML = sortedTriggers.map(t => `
    <span
        class="ioh-trigger-tooltip ioh-trigger-link"
        data-trigger-id="${t.id}"
        data-full-msg="${this.utils.escapeHtml(t.fullMessage)}">
        ${this.utils.escapeHtml(t.keyword)}
    </span>`).join('<span class="ioh-trigger-separator">,</span> ');

        let finalDurationForDisplay = finalDurationStr;
        if (finalDuration > 0) {
            // X2 only for the final verdict reason — not mostSevere.rule.name
            // (e.g. insult+trolling → «Троллинг/провокация» must not use an insult mute).
            const recentSameReasonMute = this.findRecentMuteForReasons(muteHistoryBlock, [finalName]);
            if (recentSameReasonMute) {
                finalDurationForDisplay = this.utils.formatDuration(recentSameReasonMute.duration * 2);
            }
        }

        const isWarning = finalDurationStr === 'Предупреждение';
        const punishmentText = isWarning ? finalDurationStr : `мут на ${finalDurationForDisplay}`;
        const offenderId = blocks.offenderSteamId === 'unknown' ? '' : blocks.offenderSteamId;
        if (isWarning) {
            this.clearSuggestedMuteReason();
        } else {
            this.setSuggestedMuteReason(offenderId, finalName);
        }

        const severityByRule = {};
        const durationByRule = {};
        for (const v of allViolations) {
            if ((v.severity ?? -1) > (severityByRule[v.ruleName] ?? -1)) {
                severityByRule[v.ruleName] = v.severity;
            }
            if ((v.duration ?? -1) > (durationByRule[v.ruleName] ?? -1)) {
                durationByRule[v.ruleName] = v.duration;
            }
        }
        const sortedStats = [...activeStats].sort((a, b) =>
            (severityByRule[b[0]] ?? 0) - (severityByRule[a[0]] ?? 0) ||
            (durationByRule[b[0]] ?? 0) - (durationByRule[a[0]] ?? 0) ||
            a[0].localeCompare(b[0])
        );
        const statsTooltip =
            sortedStats.length > 1 && infoIcon
                ? `<span class="ioh-analysis-stats-tooltip" title="">${infoIcon}<span class="ioh-analysis-stats-tooltip__panel" role="tooltip">${sortedStats
                    .map(([name, count]) =>
                        `<span class="ioh-analysis-stats-tooltip__row"><span class="ioh-analysis-stats-tooltip__name">${this.utils.escapeHtml(name)}</span><span class="ioh-analysis-stats-tooltip__count">${count}</span></span>`
                    )
                    .join('')}</span></span>`
                : '';

        const htmlResponse = `
                <div class="ioh-analysis-grid">
                    <div class="ioh-analysis-row">
                        <div class="ioh-analysis-label">${triggers}<span></span></div>
                        <div class="ioh-analysis-value ioh-analysis-triggers">${topTriggersHTML}</div>
                    </div>
                    <div class="ioh-analysis-row">
                        <div class="ioh-analysis-label">${reason}<span></span></div>
                        <div class="ioh-analysis-value ioh-analysis-value--reason">
                            <strong>${this.utils.escapeHtml(finalName)}</strong>${statsTooltip}
                        </div>
                    </div>
                    <div class="ioh-analysis-row ioh-analysis-row--verdict">
                        <div class="ioh-analysis-label">${punishment}<span></span></div>
                        <div class="ioh-analysis-value"><strong>${this.utils.escapeHtml(punishmentText)}</strong></div>
                    </div>
                </div>
            </div>
        `;

        const badgeVariant = isWarning ? 'warning' : 'accent';
        this.badgeService.updateInfoBadge('helper-suggest-badge', badgeVariant, htmlResponse, textarea);

        const badge = this.document.getElementById('helper-suggest-badge');
        if (badge) {
            badge.removeEventListener('click', this.handleTriggerClick);
            badge.addEventListener('click', this.handleTriggerClick);
        }

        return {kind: isWarning ? 'warning' : 'mute'};
    }

    findLastMuteWithin24h(muteHistoryBlock) {
        if (!muteHistoryBlock) {
            return null;
        }

        let lastMuteDate = null;
        const now = Date.now();
        muteHistoryBlock.querySelectorAll('tbody tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) {
                return;
            }
            const muteDate = this.parseDateCell(cells[1]);
            if (!muteDate) {
                return;
            }
            const hoursDiff = (now - muteDate.getTime()) / (1000 * 60 * 60);
            if (hoursDiff <= 24 && (!lastMuteDate || muteDate > lastMuteDate)) {
                lastMuteDate = muteDate;
            }
        });
        return lastMuteDate;
    }

    analyzeChatRows(rows, lastMuteDate) {
        this.triggerRows.clear();
        const allViolations = [];
        const ruleCounters = {};
        (this.rules || []).forEach(rule => {
            ruleCounters[rule.name] = 0;
        });
        const playerChatLog = {};
        const matcher = this._ruleMatcher;
        const getSeverity = rule => this.getRuleSeverity(rule);

        for (const row of rows) {
            const chatRow = this.getChatRowData(row);
            if (!chatRow || !chatRow.messageText) {
                continue;
            }
            if (!this.utils.isMessageWithin24Hours(chatRow.timeText)) {
                continue;
            }

            const msgTimeMs = this.utils.parseTimeToMs(chatRow.timeText);
            if (lastMuteDate && msgTimeMs && msgTimeMs <= lastMuteDate.getTime()) {
                continue;
            }

            const {authorText, messageText} = chatRow;
            const textLower = messageText.toLowerCase().trim();
            if (msgTimeMs && textLower.length > 0) {
                if (!playerChatLog[authorText]) {
                    playerChatLog[authorText] = [];
                }
                playerChatLog[authorText].push({time: msgTimeMs, text: textLower, raw: messageText, row});
            }

            const strongest = matcher.matchStrongest(textLower, messageText, getSeverity);
            if (!strongest) {
                continue;
            }

            ruleCounters[strongest.rule.name] += 1;
            const triggerId = crypto.randomUUID();
            this.triggerRows.set(triggerId, row);
            allViolations.push({
                id: triggerId,
                ruleName: strongest.rule.name,
                keyword: strongest.displayKeyword,
                fullMessage: messageText,
                severity: getSeverity(strongest.rule),
                duration: strongest.rule.duration,
                timeMs: msgTimeMs || null
            });
        }

        const spamRule = (this.rules || []).find(r => r.name === 'Спам в микрофон/чат');
        for (const spam of detectSpamLinear(playerChatLog, spamRule, getSeverity)) {
            const triggerId = crypto.randomUUID();
            this.triggerRows.set(triggerId, spam.rows);
            allViolations.push({
                id: triggerId,
                ruleName: 'Спам в микрофон/чат',
                keyword: `${spam.raw} (x${spam.dupes})`,
                fullMessage: spam.raw,
                severity: spam.severity,
                duration: spam.duration,
                timeMs: spam.timeMs || null
            });
            ruleCounters['Спам в микрофон/чат'] = (ruleCounters['Спам в микрофон/чат'] || 0) + spam.dupes;
        }

        return {allViolations, ruleCounters};
    }

    dropSoloTrollingViolation(allViolations, ruleCounters) {
        if (ruleCounters['Троллинг/провокация'] !== 1 ||
            (ruleCounters['Спам в микрофон/чат'] || 0) !== 0 ||
            (ruleCounters['Оскорбление'] || 0) !== 0 ||
            (ruleCounters['Токсичность'] || 0) !== 0 ||
            (ruleCounters['Расизм / дискриминация'] || 0) !== 0) {
            return {allViolations, ruleCounters};
        }

        return {
            allViolations: allViolations.filter(v => v.ruleName !== 'Троллинг/провокация'),
            ruleCounters: {
                ...ruleCounters,
                'Троллинг/провокация': 0
            }
        };
    }
}

Object.assign(
    TicketService.prototype,
    TicketScopeMethods,
    ChatAnalyzerMethods,
    VerdictMethods,
    AnalysisBadgeMethods,
    ActivePunishmentMethods,
    AutoConnectMethods,
    QueueCardsMethods,
    PunishmentPanelMethods,
    OffenderProfileMethods,
    OffenderTrackingMethods
);
