const featureTogglesEl = document.getElementById('featureToggles');
const hoursInput = document.getElementById('newAccountHours');
const refreshIntervalInput = document.getElementById('serverRefreshInterval');
const triggersContainer = document.getElementById('triggersContainer');
const triggerInput = document.getElementById('triggerInput');
const trackIntervalInput = document.getElementById('trackOffenderInterval');
// const ticketAgeInput = document.getElementById('ticketAgeLimit');
const addBtn = document.getElementById('addTriggerBtn');
const resetBtn = document.getElementById('resetDefaultsBtn');
const toast = document.getElementById('toastMsg');

let currentSettings = {};
let defaultSettings = {};

const storage = {
    get(keys, callback) {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.get(keys, callback);
            return;
        }

        const result = {};
        keys.forEach(key => {
            const value = localStorage.getItem(key);
            try {
                result[key] = JSON.parse(value);
            } catch {
                result[key] = undefined;
            }
        });
        callback(result);
    },
    set(data, callback) {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set(data, callback);
            return;
        }

        Object.entries(data).forEach(([key, value]) => {
            localStorage.setItem(key, JSON.stringify(value));
        });
        callback?.();
    }
};

function showToast(message, duration = 2000) {
    toast.textContent = message || 'Настройки сохранены';
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function renderToggles(features) {
    featureTogglesEl.innerHTML = '';
    const entries = [
        {
            key: 'highlightComplaintTriggers',
            label: 'Подсветка триггеров жалоб',
            desc: 'highlightComplaintTriggers',
            help: 'Подсвечивает слова из списка триггеров в причине жалобы.'
        },
        {
            key: 'highlightNewAccounts',
            label: 'Подсветка новых аккаунтов',
            desc: 'highlightNewAccounts',
            help: 'Подсвечивает часы CYBERSHOKE меньше указанного порога.'
        },
        {
            key: 'highlightDuplicateServers',
            label: 'Дубликаты серверов',
            desc: 'highlightDuplicateServers',
            help: 'Выделяет жалобы, пришедшие с одного сервера.'
        },
        {
            key: 'processTicketRules',
            label: 'Анализ тикетов',
            desc: 'processTicketRules',
            help: 'Анализирует историю чата в тикете и показывает подсказку по нарушению и наказанию.'
        },
        {
            key: 'manageEmptyBlocks',
            label: 'Скрывать пустые блоки',
            desc: 'manageEmptyBlocks',
            help: 'Скрывает пустые блоки истории тикетов, банов, мутов.'
        },
        {
            key: 'translateText',
            label: 'Перевод сообщений',
            desc: 'translateText',
            help: 'Добавляет перевод нерусских сообщений в истории чата при наведении на них курсором.'
        },
        {
            key: 'autoConnectServer',
            label: 'Автоподключение к серверу',
            desc: 'autoConnectServer',
            help: 'Автоматически нажимает на ссылку подключения при открытии тикета "В работе".'
        },
        {
            key: 'trackOffenderServer',
            label: 'Трекер серверов нарушителей',
            desc: 'trackOffenderServer',
            help: 'Включает отслеживание текущего сервера игрока.'
        },
        {
            key: 'scanSchedulePage',
            label: 'Сканировать расписание',
            desc: 'scanSchedulePage',
            help: 'Обновляет базу модераторов при открытии страницы "Таймлайн" для подсветки в тикетах.'
        }
    ];

    entries.forEach(({key, label, desc, help}) => {
        const item = document.createElement('div');
        item.className = 'toggle-item';

        const copyWrap = document.createElement('div');
        copyWrap.className = 'toggle-copy';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'toggle-label';
        labelSpan.textContent = label;
        const descEl = document.createElement('small');
        descEl.textContent = desc;
        labelSpan.appendChild(descEl);

        const helpDot = document.createElement('span');
        helpDot.className = 'info-dot';
        helpDot.tabIndex = 0;
        helpDot.setAttribute('aria-label', help);
        helpDot.textContent = 'i';

        const tooltip = document.createElement('span');
        tooltip.className = 'info-tooltip';
        tooltip.textContent = help;
        helpDot.appendChild(tooltip);

        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch-ios';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', saveCurrentSettings);
        input.checked = features[key] !== undefined ? features[key] : true;
        input.dataset.feature = key;
        const slider = document.createElement('span');
        slider.className = 'slider';

        switchLabel.appendChild(input);
        switchLabel.appendChild(slider);
        copyWrap.appendChild(labelSpan);
        copyWrap.appendChild(helpDot);
        item.appendChild(copyWrap);
        item.appendChild(switchLabel);
        featureTogglesEl.appendChild(item);
    });
}

function renderTriggers(triggers) {
    triggersContainer.innerHTML = '';
    triggers.forEach((trigger, index) => {
        const tag = document.createElement('span');
        tag.className = 'trigger-tag';
        tag.textContent = trigger;
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-trigger';
        removeBtn.textContent = 'x';
        removeBtn.dataset.index = index;
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(removeBtn.dataset.index, 10);
            currentSettings.reasonTriggers.splice(idx, 1);
            renderTriggers(currentSettings.reasonTriggers);
            saveCurrentSettings();
        });
        tag.appendChild(removeBtn);
        triggersContainer.appendChild(tag);
    });
}

function loadSettingsToUI(settings) {
    const checkboxes = featureTogglesEl.querySelectorAll('input[type="checkbox"]');

    checkboxes.forEach(cb => {
        cb.checked = settings.features[cb.dataset.feature] ??
            defaultSettings.features[cb.dataset.feature];
    });

    hoursInput.value = settings.newAccountHours;
    refreshIntervalInput.value = settings.serverRefreshInterval;
    currentSettings.reasonTriggers = [...settings.reasonTriggers];
    trackIntervalInput.value = settings.trackOffenderInterval;
    // ticketAgeInput.value = settings.ticketAgeLimit;

    renderTriggers(currentSettings.reasonTriggers);
}

function collectSettingsFromUI() {

    const features = {};

    featureTogglesEl
        .querySelectorAll('input[type="checkbox"]')
        .forEach(cb => {
            features[cb.dataset.feature] = cb.checked;
        });

    return {

        features,

        newAccountHours: Math.max(
            parseInt(hoursInput.value, 10) || 1,
            1
        ),
        serverRefreshInterval: Math.max(
            parseInt(refreshIntervalInput.value, 10) || 0,
            0
        ),
        trackOffenderInterval: Math.max(parseInt(trackIntervalInput.value, 10) || 1, 1),
        // ticketAgeLimit: Math.max(parseInt(ticketAgeInput.value, 10) || 0, 0),

        reasonTriggers: [...currentSettings.reasonTriggers]

    };

}

function saveSettings(settings) {
    storage.set({helperSettings: settings}, () => {
        showToast('Сохранено', 1000);
        console.log('[Popup] Settings saved:', settings);
    });
}

function saveCurrentSettings() {
    currentSettings = collectSettingsFromUI();
    saveSettings(currentSettings);
}

async function loadSettings() {
    const config = await ConfigService.load(chrome);

    defaultSettings = structuredClone(config.settings);
    renderToggles(defaultSettings.features);

    storage.get(["helperSettings"], ({helperSettings}) => {
        currentSettings = structuredClone(defaultSettings);

        if (helperSettings) {
            currentSettings = {
                ...currentSettings,
                ...helperSettings
            };
            currentSettings.features = {
                ...defaultSettings.features,
                ...(helperSettings.features || {})
            };
            currentSettings.reasonTriggers =
                helperSettings.reasonTriggers ??
                currentSettings.reasonTriggers;
        }

        loadSettingsToUI(currentSettings);
    });

}

// Добавление триггера
addBtn.addEventListener('click', () => {
    const text = triggerInput.value.trim();
    if (!text) return;
    if (currentSettings.reasonTriggers.includes(text)) {
        showToast('Такой триггер уже есть', 1500);
        return;
    }
    currentSettings.reasonTriggers.push(text);
    renderTriggers(currentSettings.reasonTriggers);
    saveCurrentSettings();
    triggerInput.value = '';
    triggerInput.focus();
});

// Добавление по Enter
triggerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
    }
});

hoursInput.addEventListener('change', saveCurrentSettings);
refreshIntervalInput.addEventListener('change', saveCurrentSettings);
trackIntervalInput.addEventListener('change', saveCurrentSettings);
// ticketAgeInput.addEventListener('change', saveCurrentSettings);

// Сброс к дефолтам
resetBtn.addEventListener("click", () => {
    if (!confirm("Сбросить все настройки?"))
        return;

    currentSettings = structuredClone(defaultSettings);
    loadSettingsToUI(currentSettings);

    storage.set({
        helperSettings: {}
    });

    showToast("Настройки сброшены");
});

document.addEventListener("DOMContentLoaded", async () => {

    await loadSettings();

    const version = await (await fetch(chrome.runtime.getURL("manifest.json"))).json();
    document.querySelector(".header-version").textContent = `v${version.version}`;

    const icons = await (await fetch(chrome.runtime.getURL("icons/icons.json"))).json();
    document.querySelector(".telegram-icon").innerHTML = icons.telegram;
    document
        .getElementById("telegramBtn")
        .addEventListener("click", () => {
            chrome.tabs.create({
                url: "https://t.me/K4NT1K?text=Привет!%20Есть%20идея%20для%20IO%20HELPER.%20Суть:%20"
            });
        });

});
