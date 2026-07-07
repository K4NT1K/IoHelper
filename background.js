// background.js

// Слушатель сообщений от контентных скриптов расширения
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchSteamDate") {
        // Делаем фоновый сетевой запрос, не ограниченный правилами CORS страницы
        fetch(`https://steamid.io/lookup/${request.steamId}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Ошибка сети: статус ${response.status}`);
                }
                return response.text(); // Читаем HTML как текст
            })
            .then(html => {
                // Успешно отправляем HTML обратно в TicketService.js
                sendResponse({ success: true, data: html });
            })
            .catch(error => {
                // Ловим и передаем ошибку, если запрос сорвался
                sendResponse({ success: false, error: error.message });
            });

        return true;
    }
});