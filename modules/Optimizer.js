class Optimizer {
    constructor({window, disabledTabKeys = ['reports']}) {
        this.window = window;
        this.enabled = false;
        this.disabledTabKeys = new Set(disabledTabKeys);

        this._originalFetch = null;
        this._originalXHROpen = null;
        this._originalXHRSend = null;

        this._fetchPatched = false;
        this._xhrPatched = false;

        // Tabs config is based on SPA route (location.href) and the API endpoints to block.
        // Extend this list to support more pages/endpoints later.
        this.tabs = [
            {
                key: 'tickets',
                activeUrlMatchers: [/\/support\/tickets\b|\/support\/ticket\b/],
                blockedRequestMatchers: []
            },
            {
                key: 'reports',
                activeUrlMatchers: [/\/support\/reports\b/],
                // "All requests" for this tab can be approximated by blocking the reports API namespace.
                blockedRequestMatchers: [/\/api\/reports\//],
                // Blocked responses (per matcher or per tab). For now we cover the example endpoint.
                blockedResponses: [
                    {
                        matcher: /\/api\/reports\/list\b/,
                        responseType: 'json',
                        payload: []
                    }
                ]
            }
        ];
    }

    setDisabledTabs(tabKeys) {
        this.disabledTabKeys = new Set(tabKeys || []);
    }

    setEnabled(enabled) {
        const nextEnabled = Boolean(enabled);
        if (nextEnabled === this.enabled) return;

        this.enabled = nextEnabled;
        if (!this.enabled) {
            this._restoreFetch();
            this._restoreXHR();
            return;
        }

        this._patchFetch();
        this._patchXHR();
    }

    _normalizeUrl(urlLike) {
        try {
            if (urlLike instanceof URL) return urlLike.href;
            if (typeof urlLike === 'string' && /^(https?:)?\/\//i.test(urlLike)) {
                return new URL(urlLike).href;
            }
            // Handles relative URLs too
            return new URL(String(urlLike), this.window.location.href).href;
        } catch {
            return String(urlLike || '');
        }
    }

    _getActiveTabKey() {
        const href = this.window.location && this.window.location.href ? this.window.location.href : '';
        for (const tab of this.tabs) {
            if (tab.activeUrlMatchers && tab.activeUrlMatchers.some(re => re.test(href))) {
                return tab.key;
            }
        }
        return null;
    }

    _getBlockedTabKeyForUrl(urlAbs) {
        // If the request matches something we block for a disabled tab,
        // return that tab key. Active tab is excluded in shouldBlock().
        for (const tab of this.tabs) {
            if (!this.disabledTabKeys.has(tab.key)) continue;
            if (!tab.blockedRequestMatchers || tab.blockedRequestMatchers.length === 0) continue;

            if (tab.blockedRequestMatchers.some(re => re.test(urlAbs))) {
                return tab.key;
            }
        }
        return null;
    }

    _getBlockedResponseForUrl(urlAbs) {
        for (const tab of this.tabs) {
            if (!this.disabledTabKeys.has(tab.key)) continue;
            if (!tab.blockedRequestMatchers || !tab.blockedRequestMatchers.some(re => re.test(urlAbs))) {
                continue;
            }

            const special = (tab.blockedResponses || []).find(br => br.matcher && br.matcher.test(urlAbs));
            if (special) return special;

            // Default fallback for blocked reports endpoints: empty JSON array.
            return {responseType: 'json', payload: []};
        }

        return {responseType: 'json', payload: []};
    }

    shouldBlock(urlLike) {
        if (!this.enabled) return false;
        const activeKey = this._getActiveTabKey();
        if (!activeKey) return false;

        const urlAbs = this._normalizeUrl(urlLike);
        const blockedTabKey = this._getBlockedTabKeyForUrl(urlAbs);
        return Boolean(blockedTabKey && blockedTabKey !== activeKey);
    }

    _patchFetch() {
        if (this._fetchPatched) return;
        if (typeof this.window.fetch !== 'function') return;

        this._fetchPatched = true;
        this._originalFetch = this.window.fetch;

        const self = this;
        this.window.fetch = async function (input, init) {
            const urlLike = typeof input === 'string' ? input : input && input.url;
            const shouldBlock = self.shouldBlock(urlLike);
            if (!shouldBlock) {
                return self._originalFetch.apply(this, arguments);
            }

            const urlAbs = self._normalizeUrl(urlLike);
            const decision = self._getBlockedResponseForUrl(urlAbs);

            if (decision.responseType === 'text') {
                return new Response(decision.payload || '', {
                    status: 200,
                    headers: {'Content-Type': 'text/plain'}
                });
            }

            return new Response(JSON.stringify(decision.payload || []), {
                status: 200,
                headers: {'Content-Type': 'application/json'}
            });
        };
    }

    _restoreFetch() {
        if (!this._fetchPatched) return;
        if (this._originalFetch) this.window.fetch = this._originalFetch;
        this._originalFetch = null;
        this._fetchPatched = false;
    }

    _patchXHR() {
        if (this._xhrPatched) return;
        if (!this.window.XMLHttpRequest) return;

        this._xhrPatched = true;
        this._originalXHROpen = this.window.XMLHttpRequest.prototype.open;
        this._originalXHRSend = this.window.XMLHttpRequest.prototype.send;

        const self = this;
        this.window.XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
            this.__iohOptimizerUrl = url;
            return self._originalXHROpen.apply(this, arguments);
        };

        this.window.XMLHttpRequest.prototype.send = function (body) {
            try {
                if (self.shouldBlock(this.__iohOptimizerUrl)) {
                    const urlAbs = self._normalizeUrl(this.__iohOptimizerUrl);
                    const decision = self._getBlockedResponseForUrl(urlAbs);
                    const responseText = decision.responseType === 'text'
                        ? (decision.payload || '')
                        : JSON.stringify(decision.payload || []);

                    // Simulate completed XHR with a safe empty payload.
                    // eslint-disable-next-line no-unused-vars
                    this.readyState = 4;
                    this.status = 200;

                    try {
                        this.responseText = responseText;
                    } catch {
                        // Some browsers treat it as read-only; we still dispatch events.
                    }

                    try {
                        this.response = responseText;
                    } catch {
                    }

                    if (typeof this.onreadystatechange === 'function') {
                        this.onreadystatechange();
                    }

                    try {
                        this.dispatchEvent(new Event('readystatechange'));
                        this.dispatchEvent(new Event('load'));
                        this.dispatchEvent(new Event('loadend'));
                    } catch {
                    }
                    return;
                }
            } catch {
                // Fail-open: if anything goes wrong, don't block the request.
            }

            return self._originalXHRSend.apply(this, arguments);
        };
    }

    _restoreXHR() {
        if (!this._xhrPatched) return;
        if (this._originalXHROpen) this.window.XMLHttpRequest.prototype.open = this._originalXHROpen;
        if (this._originalXHRSend) this.window.XMLHttpRequest.prototype.send = this._originalXHRSend;
        this._originalXHROpen = null;
        this._originalXHRSend = null;
        this._xhrPatched = false;
    }
}

window.Optimizer = Optimizer;

