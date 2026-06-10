/* Runtime configuration shim.
   Web build: leave TIME_ARCHITECT_API_BASE empty — APIs are same-origin.
   Android (Capacitor) build: scripts/build-www.mjs rewrites this file so the
   bundled app talks to the cloud backend (shared accounts with the web app).
   Power users can also override the backend per device via localStorage:
     localStorage.setItem('ta_api_base_v1', 'https://your-deployment.example') */
(function () {
    try {
        const stored = localStorage.getItem('ta_api_base_v1');
        if (stored) {
            window.TIME_ARCHITECT_API_BASE = String(stored).replace(/\/+$/, '');
            return;
        }
    } catch (e) { /* storage unavailable */ }
    window.TIME_ARCHITECT_API_BASE = window.TIME_ARCHITECT_API_BASE || '';
})();
