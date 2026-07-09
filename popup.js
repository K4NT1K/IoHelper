const featureTogglesEl = document.getElementById('featureToggles');
const hoursInput = document.getElementById('newAccountHours');
const refreshIntervalInput = document.getElementById('serverRefreshInterval');
const triggersContainer = document.getElementById('triggersContainer');
const triggerInput = document.getElementById('triggerInput');
const trackIntervalInput = document.getElementById('trackOffenderInterval');
const autoConnectReasonsContainer = document.getElementById('autoConnectReasonsContainer');
const autoConnectTriggersContainer = document.getElementById('autoConnectTriggersContainer');
const autoConnectTriggerInput = document.getElementById('autoConnectTriggerInput');
const addAutoConnectTriggerBtn = document.getElementById('addAutoConnectTriggerBtn');
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
            key: 'processTicketRules',
            label: 'Анализ чата',
            desc: '',
            help: 'Анализирует историю чата в тикете и показывает подсказку по нарушению и наказанию.'
        },
        {
            key: 'showSteamAccountCreationDate',
            label: 'Дата создания Steam-аккаунта',
            desc: '',
            help: 'Показывает дату создания Steam-аккаунта нарушителя в открытом тикете.'
        },
        {
            key: 'manageEmptyBlocks',
            label: 'Скрывать пустые блоки',
            desc: '',
            help: 'Скрывает пустые блоки истории тикетов, банов, мутов.'
        },
        {
            key: 'translateText',
            label: 'Перевод сообщений',
            desc: '',
            help: 'Добавляет перевод нерусских сообщений в истории чата при наведении на них курсором.'
        },
        {
            key: 'autoConnectServer',
            label: 'Автоподключение к серверу',
            desc: '',
            help: 'Автоматически нажимает на ссылку подключения при принятии тикета.'
        },
        {
            key: 'squareTickets',
            label: 'Квадратные тикеты',
            desc: 'BETA TEST',
            help: 'Позволяет пользоваться сайтом мониторам с книжной ориентацией.'
        },
        {
            key: 'trackOffenderServer',
            label: 'Трекер серверов нарушителей',
            desc: '',
            help: 'Включает отслеживание текущего сервера игрока.'
        },
        {
            key: 'highlightDuplicateServers',
            label: 'Дубликаты серверов',
            desc: '',
            help: 'Выделяет жалобы, пришедшие с одного сервера.'
        },
        {
            key: 'highlightComplaintTriggers',
            label: 'Подсветка триггеров жалоб',
            desc: '',
            help: 'Подсвечивает слова из списка триггеров в причине жалобы.'
        },
        {
            key: 'highlightNewAccounts',
            label: 'Подсветка новых аккаунтов',
            desc: '',
            help: 'Подсвечивает часы CYBERSHOKE меньше указанного порога.'
        },
        {
            key: 'scanSchedulePage',
            label: 'Сканировать расписание',
            desc: '',
            help: 'Обновляет базу модераторов при открытии страницы "Таймлайн" для подсветки в тикетах.'
        },
        {
            key: 'optimizeSpaTabs',
            label: 'Оптимизация SPA вкладок',
            desc: 'BETA TEST',
            help: 'Блокирует фоновые загрузки данных для неактивных вкладок SPA.'
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

function renderAutoConnectReasons(options, selectedReasons) {
    autoConnectReasonsContainer.innerHTML = '';

    options.forEach(reason => {
        const label = document.createElement('label');
        label.className = 'reason-checkbox';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = reason;
        input.checked = selectedReasons.includes(reason);
        input.addEventListener('change', saveCurrentSettings);

        const text = document.createElement('span');
        text.textContent = reason;

        label.appendChild(input);
        label.appendChild(text);
        autoConnectReasonsContainer.appendChild(label);
    });
}

function renderAutoConnectTriggers(triggers) {
    autoConnectTriggersContainer.innerHTML = '';
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
            currentSettings.reasonTriggersAutoconnect.splice(idx, 1);
            renderAutoConnectTriggers(currentSettings.reasonTriggersAutoconnect);
            saveCurrentSettings();
        });
        tag.appendChild(removeBtn);
        autoConnectTriggersContainer.appendChild(tag);
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
    currentSettings.reasonTriggersAutoconnect = [...(settings.reasonTriggersAutoconnect || [])];
    trackIntervalInput.value = settings.trackOffenderInterval;
    // ticketAgeInput.value = settings.ticketAgeLimit;

    renderAutoConnectReasons(
        defaultSettings.complaintReasonOptions || [],
        settings.autoConnectReasons || defaultSettings.autoConnectReasons || []
    );
    renderAutoConnectTriggers(
        settings.reasonTriggersAutoconnect || defaultSettings.reasonTriggersAutoconnect || []
    );
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

        autoConnectReasons: Array.from(
            autoConnectReasonsContainer.querySelectorAll('input[type="checkbox"]:checked')
        ).map(input => input.value),

        reasonTriggers: [...currentSettings.reasonTriggers],
        reasonTriggersAutoconnect: [...currentSettings.reasonTriggersAutoconnect]

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
            currentSettings.autoConnectReasons =
                helperSettings.autoConnectReasons ??
                currentSettings.autoConnectReasons;
            currentSettings.reasonTriggersAutoconnect =
                helperSettings.reasonTriggersAutoconnect ??
                currentSettings.reasonTriggersAutoconnect;
        }

        loadSettingsToUI(currentSettings);
    });

}

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

addAutoConnectTriggerBtn.addEventListener('click', () => {
    const text = autoConnectTriggerInput.value.trim();
    if (!text) return;
    if (!currentSettings.reasonTriggersAutoconnect) {
        currentSettings.reasonTriggersAutoconnect = [];
    }
    if (currentSettings.reasonTriggersAutoconnect.includes(text)) {
        showToast('Такой триггер уже есть', 1500);
        return;
    }
    currentSettings.reasonTriggersAutoconnect.push(text);
    renderAutoConnectTriggers(currentSettings.reasonTriggersAutoconnect);
    saveCurrentSettings();
    autoConnectTriggerInput.value = '';
    autoConnectTriggerInput.focus();
});

autoConnectTriggerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        addAutoConnectTriggerBtn.click();
    }
});

hoursInput.addEventListener('change', saveCurrentSettings);
refreshIntervalInput.addEventListener('change', saveCurrentSettings);
trackIntervalInput.addEventListener('input', saveCurrentSettings);
// ticketAgeInput.addEventListener('input', saveCurrentSettings);

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

    document.querySelector(".header-version").textContent =
        `v${chrome.runtime.getManifest().version}`;

    const icons = await (await fetch(chrome.runtime.getURL("icons/icons.json"))).json();
    document.querySelector(".telegram-icon").innerHTML = icons.telegram;
    document.getElementById("telegramBtn").addEventListener("click", () => {
        chrome.tabs.create({
            url: "https://t.me/K4NT1K?text=Привет!%20Есть%20идея%20для%20IO%20HELPER.%20Суть:%20"
        });
    });
});
