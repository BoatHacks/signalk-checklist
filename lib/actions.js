const REQUEST_TIMEOUT_MS = 5000

/**
 * Runs a normalized item action (see lib/store.js normalizeAction).
 *
 * - 'delta' actions publish directly onto the SignalK bus via
 *   app.handleMessage — this is the plugin's own delta, same mechanism as
 *   the live-sync state deltas, just with a path/value the user configured.
 * - 'rest' actions make an outbound HTTP request from the server (not the
 *   browser) — this sidesteps CORS entirely (many boat-local devices'
 *   HTTP APIs don't send CORS headers) and means the action fires
 *   reliably regardless of which device's browser triggered it.
 *
 * @param {object} action - a normalized action from lib/store.js
 * @param {object} deps
 * @param {object} deps.app - the SignalK plugin app object (needs handleMessage)
 * @param {string} deps.pluginId
 * @param {typeof fetch} [deps.fetchImpl] - injectable for tests
 */
async function triggerAction (action, { app, pluginId, fetchImpl = fetch } = {}) {
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

module.exports = { triggerAction }
