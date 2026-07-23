// background.js

async function fetchOffenderProfileJson(steamId) {
    const response = await fetch('https://mobile.fastmm.win/api/page/v1/faceit-service/player/find', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            target: steamId,
            game: 'cs2'
        }),
        redirect: 'follow'
    });

    if (!response.ok) {
        throw new Error(`Ошибка сети: статус ${response.status}`);
    }

    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw new Error('Некорректный JSON-ответ сервера');
    }

    if (!data || data.status !== 'success') {
        throw new Error(data?.status ? `Статус ответа: ${data.status}` : 'Профиль не найден');
    }

    return data;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchOffenderProfile' || request.action === 'fetchSteamDate') {
        const steamId = request.steamId;

        (async () => {
            try {
                const data = await fetchOffenderProfileJson(steamId);
                sendResponse({
                    success: true,
                    data,
                    source: 'fastmm'
                });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message || 'Не удалось загрузить профиль'
                });
            }
        })();

        return true;
    }
});
