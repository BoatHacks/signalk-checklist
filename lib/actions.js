const { getSignalKToken } = require('./signalk-auth')

const REQUEST_TIMEOUT_MS = 5000

/** True for URLs whose path is under SignalK's own REST API, regardless of
 *  which host/IP the user configured (a boat's LAN IP is just as valid a
 *  way to reach the server as localhost) — used to decide whether it's
 *  appropriate to attach this plugin's own SignalK bearer token. Never
 *  attached to calls that don't match this, since leaking our own
 *  server token to some unrelated third-party device's API would be a
 *  real security mistake, not just an unnecessary header. */
function isSignalKApiUrl (url) {
  try {
    return new URL(url).pathname.startsWith('/signalk/v1/')
  } catch (err) {
    return false
  }
}

/**
 * Runs a normalized item action (see lib/store.js normalizeAction).
 *
 * - 'delta' actions publish directly onto the SignalK bus via
 *   app.handleMessage — this is the plugin's own delta, same mechanism as
 *   the live-sync state deltas, just with a path/value the user configured.
 *   No authentication token is needed or relevant here: this is an
 *   in-process call into the server, not an HTTP request, so there's
 *   nothing to authenticate.
 * - 'rest' actions make an outbound HTTP request from the server (not the
 *   browser) — this sidesteps CORS entirely (many boat-local devices'
 *   HTTP APIs don't send CORS headers) and means the action fires
 *   reliably regardless of which device's browser triggered it. When the
 *   URL targets the SignalK server's own REST API, this plugin's own
 *   SignalK bearer token is attached automatically (see lib/signalk-auth.js)
 *   so the call still works if the server has security enabled.
 *
 * @param {object} action - a normalized action from lib/store.js
 * @param {object} deps
 * @param {object} deps.app - the SignalK plugin app object (needs handleMessage)
 * @param {string} deps.pluginId
 * @param {string} [deps.dataDir] - plugin data dir, for persisting the auth token; skips auth if omitted
 * @param {typeof fetch} [deps.fetchImpl] - injectable for tests
 */
async function triggerAction (action, { app, pluginId, dataDir, fetchImpl = fetch } = {}) {
  if (!action) throw new Error('item has no configured action')

  if (action.type === 'delta') {
    app.handleMessage(pluginId, {
      updates: [{ values: [{ path: action.path, value: action.value }] }]
    })
    return { ok: true, type: 'delta', path: action.path }
  }

  if (action.type === 'rest') {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const headers = {}
    if (action.body) {
      try {
        JSON.parse(action.body)
        headers['Content-Type'] = 'application/json'
      } catch (err) {
        headers['Content-Type'] = 'text/plain'
      }
    }
    if (app && dataDir && isSignalKApiUrl(action.url)) {
      const token = await getSignalKToken(app, dataDir, fetchImpl)
      if (token) headers.Authorization = `Bearer ${token}`
    }
    try {
      const res = await fetchImpl(action.url, {
        method: action.method,
        headers,
        body: action.body || undefined,
        signal: controller.signal
      })
      return { ok: res.ok, type: 'rest', status: res.status, statusText: res.statusText }
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error(`unknown action type: ${action.type}`)
}

module.exports = { triggerAction, isSignalKApiUrl }
