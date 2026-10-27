import test from 'node:test';
import assert from 'node:assert/strict';
import {PunishmentPanelMethods as panel} from '../modules/ticket/PunishmentPanel.js';
import {SitePunishmentBridge} from '../modules/SitePunishmentBridge.js';

// Minimal DOM fixture: both pages share main, with global and tab titles before content.
class Element {
    constructor(tag, text = '', attrs = {}, children = []) {
        Object.assign(this, {tagName: tag.toUpperCase(), text, attrs, children, isConnected: true});
        children.forEach(child => {child.parentElement = this;});
    }
    get textContent() {return this.text + this.children.map(child => child.textContent).join('');}
    getAttribute(key) {return this.attrs[key] ?? null;}
    hasAttribute(key) {return key in this.attrs;}
    matches(selector) {
        return selector.split(',').some(part => {
            const value = part.trim();
            if (value.includes('>')) {
                const [parent, child] = value.split('>').map(s => s.trim());
                return this.matches(child) && Boolean(this.parentElement?.matches(parent));
            }
            if (value.startsWith('#')) return this.attrs.id === value.slice(1);
            if (value.startsWith('[')) {
                const [, key, content] = value.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/) || [];
                return key && (content === undefined ? this.hasAttribute(key) : this.getAttribute(key) === content);
            }
            return this.tagName === value.toUpperCase();
        });
    }
    closest(selector) {return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;}
    contains(target) {return this === target || this.children.some(child => child.contains(target));}
    querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
    getClientRects() {return this.closest('[aria-hidden="true"]') ? [] : [{}];}
}
const el = (...args) => new Element(...args);

function fixture(t, {standalone = false, content = true} = {}) {
    const title = type => type === 'ban' ? 'Управление банами' : 'Управление мутами';
    const issue = type => {
        const button = el('button', 'Выдать блокировку');
        button.__reactProps$test = {onClick: () => type};
        return button;
    };
    const ban = issue('ban'), mute = issue('mute');
    const page = (type, button) => el('div', '', standalone ? {} : {'aria-hidden': type === 'mute' ? 'false' : 'true'}, [
        el('div', '', {}, [el('span', title(type)), button])
    ]);
    const main = el('main', '', {}, [el('header', '', {}, [el('span', title('mute'))]),
        el('nav', '', {}, ['ban', 'mute'].map(type => el('button', '', {}, [el('span', title(type))]))),
        ...(content ? [page('ban', ban), page('mute', mute)] : [])]);
    const body = el('body', '', {}, [main]);
    const document = {body, querySelectorAll: selector => body.querySelectorAll(selector)};
    const prior = globalThis.window;
    globalThis.window = {location: {pathname: '/comms/list'}};
    t.after(() => {if (prior === undefined) delete globalThis.window; else globalThis.window = prior;});
    const service = {...panel, document, MUTE_MANAGEMENT_ROUTE: '/comms/list', BAN_MANAGEMENT_ROUTE: '/bans/list',
        TICKET_MUTE_BUTTON_ID: 'ioh-ticket-issue-mute', TICKET_BAN_BUTTON_ID: 'ioh-ticket-issue-ban',
        TICKET_PUNISHMENT_ACTIONS_ID: 'ioh-ticket-punishment-actions',
        isExtensionUiElement: () => false};
    return {service, document, ban, mute};
}

test('Punishment panels: SPA chrome cannot make Mute select the first (Ban) issue button', t => {
    const {service, ban, mute} = fixture(t);
    assert.equal(service.findSiteIssueMuteButton(), mute);
    assert.equal(service.findSiteIssueBanButton(), null, 'hidden Ban panel is not an active issue target');
    assert.equal(service.findSiteIssueButtonForType('ban', {requireVisible: false}), ban);
    assert.equal(service._isButtonInSection(ban, 'Управление мутами'), false);
    service._cacheIssueHandlerFromButton(ban, 'mute');
    assert.equal(service.getCachedIssueHandler('mute'), null);
    service._cachedMuteIssueButton = ban;
    assert.equal(service.resolveIssueButtonForType('mute'), mute, 'invalid cache falls back to the correct panel');
});

test('Punishment panels: standalone action containers stay separate even without aria-hidden', t => {
    const {service, ban, mute} = fixture(t, {standalone: true});
    assert.equal(service.findSiteIssueMuteButton(), mute);
    assert.equal(service.findSiteIssueButtonForType('ban', {requireVisible: false}), ban);
    assert.equal(service._isButtonInSection(ban, 'Управление мутами'), false);
    assert.equal(service.isMuteManagementPanelActive(), true);
});

test('Punishment panels: navigation titles alone do not identify a loaded management page', t => {
    const {service} = fixture(t, {content: false});
    assert.equal(service.isMuteManagementPanelActive(), false);
    assert.equal(service.findSiteIssueMuteButton(), null);
});

test('Punishment bridge: a wrong cached handler is never invoked and the correct live button opens', async t => {
    const {service, document, ban, mute} = fixture(t);
    let opened = null;
    service.mutePanelReady = true;
    service._cachedMuteIssueButton = ban;
    service._cachedOpenMuteHandler = ban.__reactProps$test.onClick;
    service.invokeCachedSiteHandler = () => {assert.fail('wrong cached Ban handler invoked');};
    service.dispatchElementClick = button => {assert.equal(button, mute); opened = 'mute'; return true;};
    const bridge = new SitePunishmentBridge({document, ticketService: service});
    bridge._waitForDialogOpen = async type => opened === type;
    assert.equal(await bridge._trySilentOpen('mute'), true);
    assert.equal(opened, 'mute');
});
