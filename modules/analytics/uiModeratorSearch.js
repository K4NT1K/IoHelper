import {searchDirectory, resolveModerator} from './directory.js';
export function moderatorSearch(input, getMembers) {
    const wrapper = document.createElement('div'); wrapper.className = 'moderator-search';
    input.parentNode.insertBefore(wrapper, input); wrapper.append(input);
    const list = document.createElement('div'); list.className = 'moderator-suggestions'; list.id = input.id + '-suggestions';
    list.setAttribute('role', 'listbox'); list.hidden = true; wrapper.append(list);
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', list.id);
    input.placeholder = 'Никнейм, SteamID64 или ссылка';
    let selectedId = '', selectedLabel = '', matches = [], active = -1;
    const close = () => {list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1;};
    const select = member => {input.value = member.name; selectedLabel = member.name; selectedId = member.steamId; close();};
    const highlight = () => {
        [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
        if (active >= 0) {input.setAttribute('aria-activedescendant', list.children[active].id); list.children[active].scrollIntoView({block: 'nearest'});}
    };
    const show = () => {
        matches = searchDirectory(getMembers(), input.value); active = -1; input.removeAttribute('aria-activedescendant'); list.replaceChildren();
        for (const [i, member] of matches.entries()) {
            const option = document.createElement('div'); option.id = list.id + '-' + i; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
            option.setAttribute('aria-label', member.name + ' · ' + member.steamId);
            const name = document.createElement('strong'); name.textContent = member.name;
            const detail = document.createElement('small'); detail.textContent = member.steamId + ' · ' + (member.className || 'Должность не указана');
            option.append(name, detail); option.addEventListener('pointerdown', event => {event.preventDefault(); select(member);}); list.append(option);
        }
        list.hidden = !matches.length; input.setAttribute('aria-expanded', String(!!matches.length));
    };
    input.addEventListener('input', () => {selectedId = ''; selectedLabel = ''; show();});
    input.addEventListener('focus', show); input.addEventListener('blur', close);
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') return close();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); if (list.hidden) show();
            if (matches.length) {active = active < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
                : (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; highlight();}
        }
        if (event.key === 'Enter' && !list.hidden && active >= 0) {event.preventDefault(); select(matches[active]);}
    });
    close();
    return {resolve: () => resolveModerator(input.value, input.value === selectedLabel ? selectedId : '', getMembers()),
        set(id) {const member = getMembers().find(m => m.steamId === id); if (member) select(member); else {input.value = id || ''; selectedId = ''; selectedLabel = ''; close();}}};
}
