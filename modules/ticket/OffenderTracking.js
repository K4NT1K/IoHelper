import { markIoh } from '../shared/dom.js';

export const OffenderTrackingMethods = {
    extractServerLabel(result) {
        const server = result?.server;
        if (!server) {
            return null;
        }

        const parts = [];
        if (server.mode) {
            parts.push(String(server.mode));
        }
        if (server.category) {
            parts.push(String(server.category));
        }
        if (server.num != null && server.num !== '') {
            parts.push(`#${server.num}`);
        }

        return parts.length ? parts.join(' ') : null;
    },

    extractBansList(result) {
        const candidates = [
            result?.basic?.bans_list,
            result?.bans_list,
            result?.cybershoke?.bans_list
        ];

        for (const list of candidates) {
            if (Array.isArray(list) && list.length) {
                return list;
            }
        }

        return [];
    },

    isPunishmentActive(entry, type) {
        if (Number(entry?.type) !== type) {
            return false;
        }

        const now = Math.floor(Date.now() / 1000);
        const end = Number(entry?.end);
        const created = Number(entry?.created);
        const length = Number(entry?.length);

        if (Number.isFinite(end) && end > now) {
            return true;
        }

        if (Number.isFinite(created) && Number.isFinite(length) && length > 0 && created + length > now) {
            return true;
        }

        return false;
    },

    isBanActive(ban) {
        return this.isPunishmentActive(ban, 4);
    },

    isMuteActive(mute) {
        return this.isPunishmentActive(mute, 3);
    },

    extractActiveBan(result) {
        const bans = this.extractBansList(result);
        if (!bans.length) {
            return false;
        }

        return bans.some(ban => this.isBanActive(ban));
    },

    extractActiveMute(result) {
        const bans = this.extractBansList(result);
        if (!bans.length) {
            return false;
        }

        return bans.some(entry => this.isMuteActive(entry));
    },

    extractServerIpFromUserData(result) {
        if (result?.server?.server_ip && result?.server?.server_port) {
            return `${result.server.server_ip}:${result.server.server_port}`.toLowerCase();
        }

        return null;
    },

    extractLastConnect(result) {
        const raw = result?.cybershoke?.global?.lastconnect;
        if (raw == null || raw === '') {
            return null;
        }

        const seconds = Number(raw);
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    },

    normalizeVipName(raw) {
        if (raw == null) {
            return null;
        }

        const value = String(raw).trim();
        if (!value || /^null$/i.test(value) || /^none$/i.test(value)) {
            return null;
        }

        return value;
    },

    extractVipName(result) {
        return this.normalizeVipName(result?.basic?.vip_name);
    },

    extractProfileVerified(result) {
        return Boolean(result?.verification?.profile);
    },

    parseUserDataResult(result) {
        return {
            serverIp: this.extractServerIpFromUserData(result),
            lastconnect: this.extractLastConnect(result),
            serverLabel: this.extractServerLabel(result),
            isBanned: this.extractActiveBan(result),
            isMuted: this.extractActiveMute(result),
            vipName: this.extractVipName(result),
            profileVerified: this.extractProfileVerified(result)
        };
    },

    getCachedUserData(steamId, ttlMs = 5000) {
        const entry = this.userDataCache.get(steamId);
        if (!entry) {
            return null;
        }

        if (Date.now() - entry.fetchedAt >= ttlMs) {
            this.userDataCache.delete(steamId);
            return null;
        }

        return entry;
    },

    setCachedUserData(steamId, data) {
        this.userDataCache.set(steamId, {
            serverIp: data.serverIp ?? null,
            lastconnect: data.lastconnect ?? null,
            serverLabel: data.serverLabel ?? null,
            isBanned: Boolean(data.isBanned),
            isMuted: Boolean(data.isMuted),
            vipName: data.vipName ?? null,
            profileVerified: Boolean(data.profileVerified),
            fetchedAt: Date.now()
        });
    },

    getServerLinkLabelElement(link) {
        return link.querySelector(':scope > span') || link.querySelector('span');
    },

    ensureServerLinkOriginalIp(link) {
        if (link.dataset.iohOriginalServerIp) {
            return link.dataset.iohOriginalServerIp;
        }

        const ip = link.href.replace(/^steam:\/\/connect\//i, '').trim().toLowerCase();
        link.dataset.iohOriginalServerIp = ip;
        return ip;
    },

    ensureServerLinkOriginalText(link) {
        if (link.dataset.iohOriginalServerText) {
            return link.dataset.iohOriginalServerText;
        }

        const labelEl = this.getServerLinkLabelElement(link);
        const originalText = labelEl?.textContent?.trim() || link.textContent?.trim() || '';
        link.dataset.iohOriginalServerText = originalText;
        return originalText;
    },

    updateServerLinkDisplay(link, {status, lastconnect = null, currentIp = null, serverLabel = null}) {
        if (!link) {
            return;
        }

        link.classList.remove('ioh-server-online', 'ioh-server-offline', 'ioh-server-other');
        const originalText = this.ensureServerLinkOriginalText(link);
        const labelEl = this.getServerLinkLabelElement(link);

        const setLabelText = (text) => {
            if (labelEl) {
                labelEl.textContent = text;
            } else {
                link.textContent = text;
            }
        };

        if (status === 'offline') {
            link.classList.add('ioh-server-offline');
            setLabelText(this.utils.formatLastConnectStatus(lastconnect));
            return;
        }

        if (status === 'online') {
            link.classList.add('ioh-server-online');
            setLabelText(originalText);
            const originalIp = link.dataset.iohOriginalServerIp;
            if (originalIp) {
                link.href = `steam://connect/${originalIp}`;
            }
            return;
        }

        if (status === 'other') {
            link.classList.add('ioh-server-other');
            const displayText = serverLabel || currentIp || originalText;
            setLabelText(displayText);
            if (currentIp) {
                link.href = `steam://connect/${currentIp}`;
            }
        }
    },

    getComplaintReasonFromRow(row) {
        if (!row) {
            return '';
        }

        const cells = row.querySelectorAll('td');
        if (!cells.length) {
            return '';
        }

        const reasonIndex = this.getColumnIndex(row, ['причина'], 5);
        const reasonCell = cells[reasonIndex];
        if (!reasonCell) {
            return '';
        }

        const parsedCategory = this.utils.parseComplaintCell(reasonCell).category;
        if (parsedCategory) {
            return parsedCategory;
        }

        const firstDiv = reasonCell.querySelector(':scope > div > div, :scope > div');
        if (firstDiv?.textContent?.trim()) {
            return firstDiv.textContent.trim();
        }

        const rawText = reasonCell.innerText?.trim() || '';
        return rawText.split('\n')[0]?.trim() || rawText;
    },

    isMuteHighlightComplaintReason(reason) {
        const normalized = this.normalizeReason(reason);
        if (!normalized) {
            return false;
        }

        const allowedReasons = [
            'Нарушение правил',
            'Спам',
            'Мониторинг',
            'Попрошайничество'
        ];

        return allowedReasons.some(item => this.normalizeReason(item) === normalized);
    },

    applyOffenderPunishmentHighlight(row, userData) {
        if (!row) {
            return;
        }

        const highlightBan = Boolean(userData?.isBanned);
        let highlightMute = false;

        if (!highlightBan && userData?.isMuted) {
            highlightMute = this.isMuteHighlightComplaintReason(
                this.getComplaintReasonFromRow(row)
            );
        }

        row.classList.toggle('ioh-highlighted-banned', highlightBan);
        row.classList.toggle('ioh-highlighted-muted', highlightMute);
    },

    applyOffenderBanHighlight(row, isBanned) {
        this.applyOffenderPunishmentHighlight(row, {isBanned: Boolean(isBanned)});
    },

    getOffenderPunishmentIconType(row, userData) {
        if (userData?.isBanned) {
            return 'ban';
        }

        if (userData?.isMuted && this.isMuteHighlightComplaintReason(this.getComplaintReasonFromRow(row))) {
            return 'mute';
        }

        return null;
    },

    removeOffenderPunishmentIcons(offenderLink) {
        const cell = offenderLink?.closest('td');
        const ctx = this.resolveOffenderVipContext(offenderLink);
        const scope = cell || ctx?.textColumn || offenderLink?.parentElement;

        scope?.querySelectorAll('.ioh-punishment-icon').forEach(el => el.remove());

        if (offenderLink) {
            delete offenderLink.dataset.iohPunishmentIcon;
        }
    },

    getRowActionControl(row) {
        if (!row) {
            return null;
        }

        const existing = row.querySelector('.ioh-punishment-action');
        if (existing) {
            return existing;
        }

        const acceptLabels = ['Принять репорт', 'Принять тикет'];
        const candidates = Array.from(row.querySelectorAll('button, [role="button"], a, span'));
        for (const el of candidates) {
            if (el.closest('.ioh-punishment-action__inner, .ioh-icon-box, .ioh-vip-badge, .ioh-admin-icon')) {
                continue;
            }
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!acceptLabels.some(label => text === label || text.includes(label))) {
                continue;
            }

            const nested = Array.from(el.querySelectorAll('button, [role="button"], a, span'))
                .find(child => {
                    if (child.closest('.ioh-punishment-action__inner')) {
                        return false;
                    }
                    const childText = (child.textContent || '').replace(/\s+/g, ' ').trim();
                    return acceptLabels.some(label => childText === label);
                });
            return nested || el;
        }

        return null;
    },

    rowActionIsInReview(row) {
        if (!row) {
            return false;
        }

        return Array.from(row.querySelectorAll('button, [role="button"], a, span'))
            .some(el => {
                if (el.closest('.ioh-punishment-action__inner, .ioh-icon-box, .ioh-vip-badge')) {
                    return false;
                }
                const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                return text === 'На рассмотрении' || text.includes('На рассмотрении');
            });
    },

    restoreOffenderPunishmentActionLabel(control) {
        if (!control) {
            return;
        }

        if (control.dataset.iohOriginalActionHtml != null) {
            control.innerHTML = control.dataset.iohOriginalActionHtml;
            delete control.dataset.iohOriginalActionHtml;
        }

        control.classList.remove(
            'ioh-punishment-action',
            'ioh-punishment-action--ban',
            'ioh-punishment-action--mute'
        );
        delete control.dataset.iohPunishmentAction;
    },

    restoreAllOffenderPunishmentActionLabels(row) {
        if (!row) {
            return;
        }

        row.querySelectorAll('.ioh-punishment-action').forEach(control => {
            this.restoreOffenderPunishmentActionLabel(control);
        });
    },

    applyOffenderPunishmentActionLabel(row, userData) {
        const type = this.getOffenderPunishmentIconType(row, userData);

        // Once a moderator takes the ticket ("На рассмотрении"), keep only row tint/border.
        if (!type || this.rowActionIsInReview(row)) {
            this.restoreAllOffenderPunishmentActionLabels(row);
            return;
        }

        const control = this.getRowActionControl(row);
        if (!control) {
            this.restoreAllOffenderPunishmentActionLabels(row);
            return;
        }

        if (control.dataset.iohPunishmentAction === type
            && control.classList.contains('ioh-punishment-action')) {
            return;
        }

        if (control.dataset.iohOriginalActionHtml == null) {
            control.dataset.iohOriginalActionHtml = control.innerHTML;
        }

        const iconSvg = window.Icons?.[type] || '';
        const label = type === 'ban' ? 'ЗАБАНЕН' : 'АКТИВНЫЙ МУТ';
        control.classList.remove('ioh-punishment-action--ban', 'ioh-punishment-action--mute');
        control.classList.add('ioh-punishment-action', `ioh-punishment-action--${type}`);
        control.dataset.iohPunishmentAction = type;
        control.innerHTML = `<span class="ioh-punishment-action__inner" data-ioh="1"><span class="ioh-icon-box">${iconSvg}</span><span class="ioh-punishment-action__text">${label}</span></span>`;
    },

    applyOffenderMuteBanIcons(offenderLink, row, userData) {
        // Nickname mute/ban icons removed; status is shown on the action control instead.
        this.removeOffenderPunishmentIcons(offenderLink);
        this.applyOffenderPunishmentActionLabel(row, userData);
    },

    getVipBadgeMeta(vipName) {
        const normalized = this.normalizeVipName(vipName);
        if (!normalized) {
            return null;
        }

        const isLite = normalized.toLowerCase() === 'lite';
        return {
            label: normalized,
            variant: isLite ? 'lite' : 'gold',
            iconUrl: isLite
                ? 'https://cloud.cybershoke.net/img/icons/blue-corona.svg'
                : 'https://cloud.cybershoke.net/img/icons/corona.svg'
        };
    },

    isVipStatusAllowed(vipName) {
        const normalized = this.normalizeVipName(vipName);
        if (!normalized) {
            return false;
        }

        const allowed = this.settings.offenderVipStatuses
            || ['prospect', 'coach', 'talent', 'pro', 'legend'];
        const statusKey = normalized.toLowerCase();
        return allowed.some(status => String(status).toLowerCase() === statusKey);
    },

    clearVipNickColor(nameButton) {
        if (!nameButton) {
            return;
        }

        nameButton.style.removeProperty('color');
        nameButton.querySelectorAll('*').forEach(node => {
            if (node.style) {
                node.style.removeProperty('color');
            }
        });
    },

    applyVipNickColor(nameButton, color) {
        if (!nameButton || !color) {
            return;
        }

        nameButton.style.setProperty('color', color, 'important');
        nameButton.querySelectorAll('*').forEach(node => {
            if (node.style) {
                node.style.setProperty('color', color, 'important');
            }
        });
    },

    removeOffenderVipBadge(offenderLink) {
        const cell = offenderLink?.closest('td');
        const ctx = this.resolveOffenderVipContext(offenderLink);
        const scope = cell || ctx?.textColumn || offenderLink?.parentElement;

        scope?.querySelectorAll('.ioh-vip-badge').forEach(badge => badge.remove());

        // Clean every name-row in the cell (also recovers from older wrong avatar wraps).
        cell?.querySelectorAll('.ioh-vip-name-row').forEach(row => {
            row.classList.remove('ioh-vip-nick--gold', 'ioh-vip-nick--lite');
            row.style.removeProperty('--ioh-vip-color');
            this.clearVipNickColor(row.querySelector(':scope > button'));
            this.unwrapVipNameRow(row);
        });

        // Restore icons if an older build relocated them.
        this.restoreLegacyMovedVipIcons(scope);
        cell?.querySelectorAll('.ioh-vip-steamid-row').forEach(row => this.unwrapSteamIdRow(row));

        ctx?.textColumn?.classList.remove('ioh-has-vip-badge');
        ctx?.offenderRoot?.classList.remove('ioh-offender-with-vip');
        cell?.querySelectorAll('.ioh-offender-icons-empty').forEach(el => {
            el.classList.remove('ioh-offender-icons-empty');
        });
        cell?.classList.remove('ioh-offender-vip-cell');

        if (offenderLink) {
            delete offenderLink.dataset.iohVipName;
        }
    },

    clearOffenderVipBadges() {
        const links = this.document.querySelectorAll(
            'a[href*="cybershoke.net/"][data-ioh-vip-name], a[href*="cybershoke.net/"][data-ioh-vip-source]'
        );
        links.forEach(link => {
            this.removeOffenderVipBadge(link);
        });
        this.document.querySelectorAll('.ioh-vip-badge').forEach(badge => badge.remove());
        this.document.querySelectorAll('.ioh-vip-name-row').forEach(row => {
            row.classList.remove('ioh-vip-nick--gold', 'ioh-vip-nick--lite');
            row.style.removeProperty('--ioh-vip-color');
            this.clearVipNickColor(row.querySelector(':scope > button'));
            this.unwrapVipNameRow(row);
        });
        this.restoreLegacyMovedVipIcons(this.document);
        this.document.querySelectorAll('.ioh-vip-steamid-row').forEach(row => this.unwrapSteamIdRow(row));
        this.document.querySelectorAll('.ioh-has-vip-badge').forEach(el => el.classList.remove('ioh-has-vip-badge'));
        this.document.querySelectorAll('.ioh-offender-with-vip').forEach(el => el.classList.remove('ioh-offender-with-vip'));
        this.document.querySelectorAll('.ioh-offender-icons-empty').forEach(el => el.classList.remove('ioh-offender-icons-empty'));
        this.document.querySelectorAll('.ioh-offender-vip-cell').forEach(el => el.classList.remove('ioh-offender-vip-cell'));
    },

    refreshOffenderVipBadges() {
        const links = this.document.querySelectorAll('a[href*="cybershoke.net/"][data-ioh-vip-source]');
        links.forEach(link => {
            this.applyOffenderVipBadge(link, link.dataset.iohVipSource);
        });
    },

    removeOffenderProfileVerification(offenderLink) {
        const cell = offenderLink?.closest('td');
        const ctx = this.resolveOffenderVipContext(offenderLink);
        const scope = cell || ctx?.textColumn || offenderLink?.parentElement;

        scope?.querySelectorAll('.ioh-profile-verified').forEach(el => el.remove());

        if (offenderLink) {
            delete offenderLink.dataset.iohProfileVerified;
        }
    },

    clearOffenderProfileVerification() {
        this.document.querySelectorAll(
            'a[href*="cybershoke.net/"][data-ioh-profile-verified], a[href*="cybershoke.net/"][data-ioh-profile-verified-source]'
        ).forEach(link => {
            this.removeOffenderProfileVerification(link);
        });
        this.document.querySelectorAll('.ioh-profile-verified').forEach(el => el.remove());
    },

    refreshOffenderProfileVerification() {
        this.document.querySelectorAll('a[href*="cybershoke.net/"][data-ioh-profile-verified-source]').forEach(link => {
            this.applyOffenderProfileVerification(link, true);
        });
    },

    applyOffenderProfileVerification(offenderLink, profileVerified) {
        if (!offenderLink) {
            return;
        }

        if (profileVerified) {
            offenderLink.dataset.iohProfileVerifiedSource = '1';
        } else {
            delete offenderLink.dataset.iohProfileVerifiedSource;
        }

        const show = this.settings.features?.trackOffenderServer
            && Boolean(profileVerified);

        if (!show) {
            this.removeOffenderProfileVerification(offenderLink);
            return;
        }

        const ctx = this.resolveOffenderVipContext(offenderLink);
        const nameButton = ctx?.nameButton;
        if (!nameButton?.parentNode) {
            return;
        }

        const nameRow = nameButton.closest('.ioh-vip-name-row');
        const insertParent = nameRow || nameButton.parentElement;
        const existingOurs = insertParent?.querySelector(':scope > .ioh-profile-verified')
            || ctx?.textColumn?.querySelector('.ioh-profile-verified');
        if (existingOurs) {
            offenderLink.dataset.iohProfileVerified = '1';
            return;
        }

        // Do not stack on top of moderator/verification icons already next to the nick.
        // Punishment mute/ban icons are allowed alongside verification.
        const existingAdminCandidate = insertParent?.querySelector(':scope > .ioh-admin-icon:not(.ioh-punishment-icon)')
            || (nameButton.nextElementSibling?.classList?.contains('ioh-admin-icon')
                && !nameButton.nextElementSibling.classList.contains('ioh-punishment-icon')
                ? nameButton.nextElementSibling
                : null);
        if (existingAdminCandidate) {
            offenderLink.dataset.iohProfileVerified = '1';
            return;
        }

        const iconSvg = window.Icons?.verification;
        if (!iconSvg) {
            return;
        }

        const template = this.document.createElement('template');
        template.innerHTML = iconSvg.trim();
        const badge = template.content.firstElementChild;
        if (!badge) {
            return;
        }

        badge.classList.add('ioh-admin-icon', 'ioh-profile-verified');
        markIoh(badge);
        nameButton.parentNode.insertBefore(badge, nameButton.nextSibling);
        offenderLink.dataset.iohProfileVerified = '1';
    },

    resolveOffenderVipContext(offenderLink) {
        if (!offenderLink) {
            return null;
        }

        // Same starting point as ModeratorService.insertModeratorBadge
        let idContainer = offenderLink.closest('div');
        if (idContainer?.classList.contains('ioh-vip-steamid-row')) {
            idContainer = idContainer.parentElement;
        }
        if (idContainer?.classList.contains('ioh-vip-name-row')) {
            idContainer = idContainer.parentElement;
        }

        const textColumn = idContainer?.parentElement;
        if (!textColumn || !idContainer) {
            return null;
        }

        const offenderRoot = textColumn.parentElement;
        const nameRow = textColumn.querySelector(':scope > .ioh-vip-name-row')
            || idContainer.parentElement?.querySelector(':scope > .ioh-vip-name-row');

        // Prefer nick button inside text column, but never inside the steamid container.
        let nameButton = nameRow?.querySelector('button') || null;
        if (!nameButton) {
            nameButton = Array.from(textColumn.querySelectorAll('button')).find(btn => (
                !idContainer.contains(btn)
                && textColumn.contains(btn)
            )) || null;
        }

        const iconsColumn = this.resolveOffenderIconsColumn(offenderRoot, textColumn);

        return {
            idContainer,
            textColumn,
            offenderRoot,
            nameButton,
            nameRow: nameButton?.closest('.ioh-vip-name-row') || nameRow || null,
            iconsColumn
        };
    },

    resolveOffenderIconsColumn(offenderRoot, textColumn) {
        if (!offenderRoot || !textColumn) {
            return null;
        }

        const siblings = Array.from(offenderRoot.children).filter(child => child !== textColumn);
        if (!siblings.length) {
            return null;
        }

        const withIcons = siblings.find(child => (
            child.querySelector('img[alt*="Prime" i]')
            || child.querySelector('button use[href*="lc-copy"], button use[href*="copy"]')
        ));
        if (withIcons) {
            return withIcons;
        }

        // Avatar + icons: take last non-text sibling only when there are ≥2.
        if (siblings.length >= 2) {
            return siblings[siblings.length - 1];
        }

        return null;
    },

    findOffenderNameButton(offenderLink) {
        return this.resolveOffenderVipContext(offenderLink)?.nameButton || null;
    },

    isPrimeStatusImg(img) {
        if (!img || img.tagName !== 'IMG') {
            return false;
        }
        if (img.closest('.ioh-vip-badge')) {
            return false;
        }
        return /prime/i.test(img.getAttribute('alt') || '');
    },

    isCopyControl(el) {
        if (!el || el.tagName !== 'BUTTON') {
            return false;
        }
        return Boolean(
            el.querySelector('use[href*="lc-copy"], use[href*="copy"], use[xlink\\:href*="lc-copy"]')
        );
    },

    liftToChildOf(node, stopParent) {
        if (!node || !stopParent) {
            return node;
        }

        let el = node;
        while (el.parentElement && el.parentElement !== stopParent) {
            el = el.parentElement;
        }
        return el;
    },

    findOffenderPrimeIcon(ctx) {
        if (!ctx) {
            return null;
        }

        const slotted = ctx.nameRow?.querySelector(':scope > .ioh-vip-prime-slot')
            || ctx.textColumn?.querySelector('.ioh-vip-prime-slot');
        if (slotted) {
            return slotted;
        }

        if (ctx.iconsColumn) {
            const fromCol = Array.from(ctx.iconsColumn.children).find(child => (
                this.isPrimeStatusImg(child)
                || child.querySelector?.('img[alt*="Prime" i]')
            ));
            return fromCol || ctx.iconsColumn.firstElementChild || null;
        }

        const nickParent = ctx.nameRow?.parentElement
            || ctx.nameButton?.parentElement
            || ctx.textColumn;
        if (!nickParent) {
            return null;
        }

        const img = Array.from(nickParent.querySelectorAll('img[alt*="Prime" i]'))
            .find(candidate => this.isPrimeStatusImg(candidate));
        if (!img) {
            return null;
        }

        // Prefer the wrapper that sits beside the nick row / nick button.
        if (ctx.nameRow && img.parentElement === nickParent) {
            return img;
        }
        return this.liftToChildOf(img, nickParent);
    },

    findOffenderCopyControl(ctx, offenderLink, primeEl = null) {
        if (!ctx) {
            return null;
        }

        const slotted = ctx.idContainer?.querySelector('.ioh-vip-copy-slot')
            || ctx.textColumn?.querySelector('.ioh-vip-copy-slot')
            || offenderLink?.closest('td')?.querySelector('.ioh-vip-copy-slot');
        if (slotted) {
            return slotted;
        }

        const searchRoots = [
            ctx.idContainer,
            offenderLink?.parentElement,
            ctx.textColumn,
            ctx.iconsColumn
        ].filter(Boolean);

        for (const root of searchRoots) {
            const btn = Array.from(root.querySelectorAll('button')).find(candidate => (
                this.isCopyControl(candidate)
                && candidate !== ctx.nameButton
            ));
            if (btn) {
                // Move the button itself (or its direct icons-col wrapper if that is only the button).
                if (ctx.iconsColumn?.contains(btn) && btn.parentElement === ctx.iconsColumn) {
                    return btn;
                }
                if (ctx.idContainer?.contains(btn) || offenderLink?.parentElement?.contains(btn)) {
                    return btn;
                }
                return btn;
            }
        }

        if (ctx.iconsColumn) {
            const last = ctx.iconsColumn.lastElementChild;
            if (last && last !== primeEl) {
                return last;
            }
        }

        return null;
    },

    storeVipIconRestore(el) {
        if (!el || el.__iohVipIconRestore) {
            return;
        }

        el.__iohVipIconRestore = {
            parent: el.parentElement,
            next: el.nextSibling
        };
    },

    restoreLegacyMovedVipIcons(scope) {
        const roots = [];
        if (scope) {
            roots.push(scope);
        }
        roots.push(this.document);

        roots.forEach(root => {
            root.querySelectorAll?.('.ioh-vip-prime-slot, .ioh-vip-copy-slot').forEach(el => {
                const restore = el.__iohVipIconRestore || el.__iohVipPrimeRestore;
                el.classList.remove('ioh-vip-prime-slot', 'ioh-vip-copy-slot');
                if (restore?.parent?.isConnected) {
                    restore.parent.insertBefore(el, restore.next);
                }
                delete el.__iohVipIconRestore;
                delete el.__iohVipPrimeRestore;
            });
        });
    },

    ensureSteamIdRow(offenderLink) {
        if (!offenderLink?.parentElement) {
            return null;
        }

        if (offenderLink.parentElement.classList.contains('ioh-vip-steamid-row')) {
            return offenderLink.parentElement;
        }

        const parent = offenderLink.parentElement;
        const row = this.document.createElement('div');
        row.className = 'ioh-vip-steamid-row';
        parent.insertBefore(row, offenderLink);
        row.appendChild(offenderLink);
        return row;
    },

    unwrapSteamIdRow(node) {
        const row = node?.classList?.contains('ioh-vip-steamid-row') ? node : null;
        if (!row?.parentNode) {
            return;
        }

        const parent = row.parentNode;
        while (row.firstChild) {
            parent.insertBefore(row.firstChild, row);
        }
        row.remove();
    },

    arrangeVipRowIcons(nameRow, offenderLink, ctx) {
        if (!nameRow || !offenderLink || !ctx) {
            return;
        }

        // Undo older builds that relocated Prime next to the nick.
        nameRow.querySelectorAll('.ioh-vip-prime-slot').forEach(el => {
            const restore = el.__iohVipIconRestore || el.__iohVipPrimeRestore;
            el.classList.remove('ioh-vip-prime-slot');
            if (restore?.parent?.isConnected) {
                restore.parent.insertBefore(el, restore.next);
            }
            delete el.__iohVipIconRestore;
            delete el.__iohVipPrimeRestore;
        });

        const prime = this.findOffenderPrimeIcon({...ctx, nameRow});
        const copy = this.findOffenderCopyControl({...ctx, nameRow}, offenderLink, prime);

        if (copy && copy !== prime) {
            const steamRow = this.ensureSteamIdRow(offenderLink);
            if (steamRow && !steamRow.contains(copy)) {
                this.storeVipIconRestore(copy);
                copy.classList.add('ioh-vip-copy-slot');
                steamRow.appendChild(copy);
            } else if (steamRow?.contains(copy)) {
                copy.classList.add('ioh-vip-copy-slot');
            }
        }

        const iconsColumn = ctx.iconsColumn;
        if (iconsColumn && !iconsColumn.childElementCount) {
            iconsColumn.classList.add('ioh-offender-icons-empty');
        } else {
            iconsColumn?.classList.remove('ioh-offender-icons-empty');
        }
    },

    ensureVipNameRow(nameButton, textColumn) {
        if (!nameButton?.parentNode) {
            return null;
        }

        if (textColumn && !textColumn.contains(nameButton)) {
            return null;
        }

        if (nameButton.parentElement.classList.contains('ioh-vip-name-row')) {
            return nameButton.parentElement;
        }

        const parent = nameButton.parentNode;
        const row = this.document.createElement('div');
        row.className = 'ioh-vip-name-row';
        parent.insertBefore(row, nameButton);
        row.appendChild(nameButton);

        while (
            row.nextSibling?.classList?.contains('ioh-admin-icon')
            || row.nextSibling?.classList?.contains('ioh-profile-verified')
        ) {
            row.appendChild(row.nextSibling);
        }

        return row;
    },

    unwrapVipNameRow(row) {
        if (!row?.classList?.contains('ioh-vip-name-row') || !row.parentNode) {
            return;
        }

        this.restoreLegacyMovedVipIcons(row);

        const parent = row.parentNode;
        while (row.firstChild) {
            parent.insertBefore(row.firstChild, row);
        }
        row.remove();
    },

    applyOffenderVipBadge(offenderLink, vipName) {
        if (!offenderLink) {
            return;
        }

        const normalized = this.normalizeVipName(vipName);
        if (normalized) {
            offenderLink.dataset.iohVipSource = normalized;
        } else {
            delete offenderLink.dataset.iohVipSource;
        }

        const showBadge = this.settings.features?.showOffenderVipBadge !== false
            && this.settings.features?.trackOffenderServer
            && this.isVipStatusAllowed(normalized);
        const meta = showBadge ? this.getVipBadgeMeta(normalized) : null;

        if (!meta) {
            this.removeOffenderVipBadge(offenderLink);
            return;
        }

        if (offenderLink.dataset.iohVipName === meta.label) {
            const cell = offenderLink.closest('td');
            const existing = cell?.querySelector('.ioh-vip-badge');
            if (existing) {
                const ctx = this.resolveOffenderVipContext(offenderLink);
                const nameRow = ctx?.nameRow
                    || existing.closest('.ioh-vip-name-row')
                    || null;
                // Restore icons if an older build relocated Prime/copy; do not rearrange.
                if (nameRow && ctx) {
                    this.restoreLegacyMovedVipIcons(nameRow);
                    this.restoreLegacyMovedVipIcons(cell);
                    cell?.querySelectorAll('.ioh-vip-steamid-row').forEach(row => this.unwrapSteamIdRow(row));
                    cell?.querySelectorAll('.ioh-offender-icons-empty').forEach(el => {
                        el.classList.remove('ioh-offender-icons-empty');
                    });
                }
                return;
            }
        }

        this.removeOffenderVipBadge(offenderLink);

        const ctx = this.resolveOffenderVipContext(offenderLink);
        if (!ctx?.textColumn) {
            return;
        }

        const badge = this.document.createElement('span');
        badge.className = `ioh-vip-badge ioh-vip-badge--${meta.variant}`;
        markIoh(badge);

        const icon = this.document.createElement('img');
        icon.src = meta.iconUrl;
        icon.alt = '';

        const label = this.document.createElement('span');
        label.textContent = meta.label;

        badge.appendChild(icon);
        badge.appendChild(label);

        const vipColor = meta.variant === 'lite' ? '#32a0ef' : '#feb611';
        const nameButton = ctx.nameButton;
        let nameRow = null;

        if (nameButton) {
            nameRow = this.ensureVipNameRow(nameButton, ctx.textColumn);
            if (nameRow) {
                nameRow.classList.remove('ioh-vip-nick--gold', 'ioh-vip-nick--lite');
                nameRow.classList.add(`ioh-vip-nick--${meta.variant}`);
                nameRow.style.setProperty('--ioh-vip-color', vipColor);
                this.applyVipNickColor(nameButton, vipColor);
                nameRow.insertBefore(badge, nameRow.firstChild);
            } else {
                this.applyVipNickColor(nameButton, vipColor);
                nameButton.parentNode.insertBefore(badge, nameButton.nextSibling);
                nameRow = nameButton.closest('.ioh-vip-name-row');
            }
        } else {
            ctx.idContainer?.appendChild(badge);
        }

        if (nameRow) {
            // Undo older builds that moved Prime/copy; keep site icon layout untouched.
            this.restoreLegacyMovedVipIcons(nameRow);
            this.restoreLegacyMovedVipIcons(ctx.textColumn);
            ctx.textColumn?.querySelectorAll('.ioh-vip-steamid-row').forEach(row => this.unwrapSteamIdRow(row));
            ctx.iconsColumn?.classList.remove('ioh-offender-icons-empty');
            offenderLink.closest('td')?.querySelectorAll('.ioh-offender-icons-empty').forEach(el => {
                el.classList.remove('ioh-offender-icons-empty');
            });
        }

        ctx.textColumn.classList.add('ioh-has-vip-badge');
        ctx.offenderRoot?.classList.add('ioh-offender-with-vip');
        offenderLink.closest('td')?.classList.add('ioh-offender-vip-cell');
        offenderLink.dataset.iohVipName = meta.label;
    },

    async fetchUserData(steamId) {
        const response = await fetch('https://cybershoke.net/api/user/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'include',
            body: new URLSearchParams({steamid64: steamId}).toString()
        });

        return response;
    },

    applyOffenderServerStatus(linkToUpdate, targetSteamId, targetIp, userData) {
        if (!linkToUpdate) {
            return;
        }

        const currentIp = userData.serverIp;
        const lastconnect = userData.lastconnect;

        if (!currentIp) {
            this.updateServerLinkDisplay(linkToUpdate, {status: 'offline', lastconnect});
            this.markOffenderOffline(targetSteamId);
            this.clearOffenderRelocated(targetSteamId);
            return;
        }

        if (currentIp === targetIp) {
            this.updateServerLinkDisplay(linkToUpdate, {status: 'online', currentIp});
            this.clearOffenderOffline(targetSteamId);
            this.clearOffenderRelocated(targetSteamId);
            return;
        }

        this.updateServerLinkDisplay(linkToUpdate, {
            status: 'other',
            currentIp,
            serverLabel: userData.serverLabel
        });
        this.markOffenderRelocated(targetSteamId, currentIp);
        this.clearOffenderOffline(targetSteamId);
    },

    async trackOpenTicketOffenderServer(cacheIntervalMs = null) {
        if (!this.settings?.features?.trackOffenderServer) {
            return;
        }

        const scope = this.getAutoConnectScope();
        if (!scope || !this.isActiveComplaintScope(scope)) {
            return;
        }

        if (!this.scopeHasInProgressStatus(scope)) {
            return;
        }

        const offenderField = this.findInfoFieldScoped('Нарушитель', scope);
        const offenderSteamId = this.extractSteamIdFromField(offenderField);
        if (!offenderSteamId) {
            console.log('[Helper] Трекер открытого тикета: skip — steamId нарушителя не найден');
            return;
        }

        const ticketConnectLink = this.findTicketServerConnectLink(scope);
        const ticketServerIp = this.extractServerIpFromConnectLink(ticketConnectLink);
        const CACHE_INTERVAL = Math.max(
            Number(cacheIntervalMs) || ((this.settings.trackOffenderIntervalWhileReviewing || 30) * 1000),
            1000
        );

        const now = Date.now();
        if (now - this._openTicketOffenderLastCheck < CACHE_INTERVAL) {
            return;
        }

        if (this.globalServerCooldown && now < this.globalServerCooldown) {
            return;
        }

        let userData = this.getCachedUserData(offenderSteamId, CACHE_INTERVAL);
        if (!userData) {
            try {
                const response = await this.fetchUserData(offenderSteamId);
                if (response.status === 429) {
                    this.globalServerCooldown = Date.now() + 660;
                    console.log('[Helper] Трекер открытого тикета: skip — 429 cooldown');
                    return;
                }
                if (!response.ok) {
                    console.log('[Helper] Трекер открытого тикета: skip — fetch failed', response.status);
                    return;
                }
                const result = await response.json();
                userData = this.parseUserDataResult(result);
                this.setCachedUserData(offenderSteamId, userData);
            } catch (err) {
                console.log('[Helper] Трекер открытого тикета: skip — ошибка fetch', err);
                return;
            }
        }

        this._openTicketOffenderLastCheck = Date.now();

        const currentIp = userData?.serverIp ? String(userData.serverIp).trim().toLowerCase() : null;
        if (!currentIp) {
            this.markOffenderOffline(offenderSteamId);
            this.clearOffenderRelocated(offenderSteamId);
            console.log('[Helper] Трекер открытого тикета: нарушитель offline');
            return;
        }

        this.clearOffenderOffline(offenderSteamId);

        if (ticketServerIp && currentIp === ticketServerIp) {
            this.clearOffenderRelocated(offenderSteamId);
            return;
        }

        const previousRelocated = this.getOffenderRelocatedServer(offenderSteamId);
        this.markOffenderRelocated(offenderSteamId, currentIp);

        if (previousRelocated === currentIp) {
            return;
        }

        console.log('[Helper] Трекер открытого тикета: переезд обнаружен', {
            offenderSteamId,
            ticketServerIp,
            currentIp,
            previousRelocated
        });

        if (this.settings?.features?.autoConnectServer) {
            this.connectToCurrentServer({forceRelocate: true});
        }
    },

    async checkOffendersServers(cacheIntervalMs = null, { singleRowPerPass = false } = {}) {
        const path = window.location.pathname || '';
        const href = window.location.href || '';
        const isQueuePage = href.includes('/support/reports') || href.includes('/support/tickets');
        const isDetailPage = !/\/support\/(tickets|reports)\b/i.test(path)
            && /\/ticket\/|\/reports?\//i.test(path);

        if (!isQueuePage && !isDetailPage) {
            return;
        }

        if (this.isCheckingServer) return;

        if (this.globalServerCooldown && Date.now() < this.globalServerCooldown) {
            return;
        }

        this.isCheckingServer = true;
        const CACHE_INTERVAL = Math.max(
            Number(cacheIntervalMs) || ((this.settings.trackOffenderInterval || 5) * 1000),
            1000
        );
        const TICKET_AGE_LIMIT = (this.settings.ticketAgeLimit || 0) * 1000;

        try {
            while (this.settings.features.trackOffenderServer) {
                if (this.globalServerCooldown && Date.now() < this.globalServerCooldown) {
                    const waitMs = this.globalServerCooldown - Date.now();
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    continue;
                }

                const rows = this.document.querySelectorAll('table tbody tr');
                if (!rows.length) {
                    break;
                }

                let targetRow = null;
                let targetIp = null;
                let targetSteamId = null;
                let oldestCheck = Infinity;
                const now = Date.now();

                for (let i = rows.length - 1; i >= 0; i--) {
                    const row = rows[i];

                    const timeCell = row.querySelector('.ticket-time, td:nth-child(1), td:nth-child(2)');
                    if (timeCell) {
                        const ticketTimeMs = this.utils.parseTimeToMs(timeCell.innerText) || new Date(timeCell.textContent.trim()).getTime();
                        if (ticketTimeMs && (now - ticketTimeMs) < TICKET_AGE_LIMIT) {
                            continue;
                        }
                    }

                    const offenderLink = row.querySelector('td:nth-child(4) a[href*="cybershoke.net/"]');
                    const serverIpLink = row.querySelector('td:nth-child(2) a[href^="steam://connect/"]');

                    if (!offenderLink || !serverIpLink) continue;

                    const ticketServerIp = this.ensureServerLinkOriginalIp(serverIpLink);

                    const steamIdMatch = offenderLink.href.match(/\d{17,18}/);
                    if (!steamIdMatch) continue;

                    const lastCheck = parseInt(row.dataset.lastIpCheck || '0');

                    if (now - lastCheck < CACHE_INTERVAL) continue;

                    if (lastCheck === 0) {
                        targetRow = row;
                        targetIp = ticketServerIp;
                        targetSteamId = steamIdMatch[0];
                        break;
                    }

                    if (lastCheck < oldestCheck) {
                        oldestCheck = lastCheck;
                        targetRow = row;
                        targetIp = ticketServerIp;
                        targetSteamId = steamIdMatch[0];
                    }
                }

                if (!targetRow) {
                    break;
                }

                let userData = this.getCachedUserData(targetSteamId, CACHE_INTERVAL);
                if (!userData) {
                    await new Promise(resolve => setTimeout(resolve, 340));

                    const response = await this.fetchUserData(targetSteamId);

                    if (response.status === 429) {
                        this.globalServerCooldown = Date.now() + 660;
                        await new Promise(resolve => setTimeout(resolve, 660));
                        continue;
                    }

                    if (!response.ok) {
                        continue;
                    }

                    const result = await response.json();
                    userData = this.parseUserDataResult(result);
                    this.setCachedUserData(targetSteamId, userData);
                }

                const actionState = this.rowActionIsInReview(targetRow)
                    ? 'review'
                    : (targetRow.querySelector('.ioh-punishment-action') ? 'custom' : 'accept');
                const snapshotKey = `${targetSteamId}|${userData.serverIp || ''}|${userData.vipName || ''}|${userData.profileVerified ? 1 : 0}|${userData.isBanned ? 1 : 0}|${userData.isMuted ? 1 : 0}|${actionState}`;
                if (!this._offenderRowSnapshots) {
                    this._offenderRowSnapshots = new WeakMap();
                }
                if (this._offenderRowSnapshots.get(targetRow) === snapshotKey) {
                    targetRow.dataset.lastIpCheck = Date.now().toString();
                    if (singleRowPerPass) {
                        break;
                    }
                    continue;
                }
                this._offenderRowSnapshots.set(targetRow, snapshotKey);

                const linkToUpdate = targetRow.querySelector('td:nth-child(2) a[href^="steam://connect/"]');
                const offenderLinkToUpdate = targetRow.querySelector('td:nth-child(4) a[href*="cybershoke.net/"]');
                this.scheduleOffenderUi(() => {
                    this.applyOffenderServerStatus(linkToUpdate, targetSteamId, targetIp, userData);
                    this.applyOffenderPunishmentHighlight(targetRow, userData);
                    this.applyOffenderVipBadge(offenderLinkToUpdate, userData.vipName);
                    this.applyOffenderProfileVerification(offenderLinkToUpdate, userData.profileVerified);
                    this.applyOffenderMuteBanIcons(offenderLinkToUpdate, targetRow, userData);
                });
                targetRow.dataset.lastIpCheck = Date.now().toString();

                if (singleRowPerPass) {
                    break;
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            this.isCheckingServer = false;
        }
    },

    scheduleOffenderUi(job) {
        if (!this._vipPending) {
            this._vipPending = new Set();
        }
        this._vipPending.add(job);
        if (this._vipRafId) {
            return;
        }
        this._vipRafId = requestAnimationFrame(() => {
            this._vipRafId = null;
            const jobs = [...this._vipPending];
            this._vipPending.clear();
            jobs.forEach(fn => fn());
        });
    },
};
