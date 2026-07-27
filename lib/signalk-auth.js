const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

const STATE_FILE = 'signalk-auth.json'

/** SignalK server always exposes a real strategy (a dummy one when
 *  security is off) — isDummy() is the server's own canonical check. */
function isSecurityEnabled (app) {
  return Boolean(
    app.securityStrategy &&
    typeof app.securityStrategy.isDummy === 'function' &&
    !app.securityStrategy.isDummy()
  )
}

function serverBaseUrl (app) {
  const port = (app.config && app.config.settings && app.config.settings.port) || 3000
  return `http://127.0.0.1:${port}`
}

async function readState (dataDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dataDir, STATE_FILE), 'utf8'))
  } catch (err) {
    return {}
  }
}

async function writeState (dataDir, state) {
  await fsp.writeFile(path.join(dataDir, STATE_FILE), JSON.stringify(state, null, 2), 'utf8')
}

/**
 * Returns a bearer token this plugin can use to authenticate its own
 * outbound calls back into this SignalK server's REST API (e.g. an item
 * action's REST call that targets one of the server's own endpoints under
 * /signalk/v1/), or null when none is available — either because security
 * is off (nothing to authenticate) or because a device access request is
 * still waiting on approval in the admin UI (Security > Access Requests).
 * That approval step is a deliberate one-time human gate in SignalK's
 * security model, not something this function can or should skip.
 *
 * Safe to call frequently — cheap once a token is stored, and otherwise
 * makes at most one lightweight HTTP call per invocation.
 */
async function getSignalKToken (app, dataDir, fetchImpl = fetch) {
  if (!isSecurityEnabled(app)) return null

  const state = await readState(dataDir)
  if (state.token) return state.token
  if (state.denied) return null

  if (state.requestId) {
    try {
      const res = await fetchImpl(`${serverBaseUrl(app)}/signalk/v1/requests/${state.requestId}`)
      const reply = await res.json()
      if (reply.state !== 'COMPLETED') return null // still pending approval
      if (reply.accessRequest && reply.accessRequest.permission === 'APPROVED' && reply.accessRequest.token) {
        await writeState(dataDir, { ...state, token: reply.accessRequest.token })
        return reply.accessRequest.token
      }
      // Denied (or an unexpected shape) — stop polling; a human would need
      // to delete this plugin's stored state to try pairing again.
      await writeState(dataDir, { ...state, denied: true })
      return null
    } catch (err) {
      return null // couldn't reach the server this cycle — try again next time
    }
  }

  // No token, no request in flight yet — kick one off. Still needs the
  // one-time admin approval above before a token actually becomes available.
  const clientId = state.clientId || crypto.randomUUID()
  try {
    const res = await fetchImpl(`${serverBaseUrl(app)}/signalk/v1/access/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, description: 'signalk-checklist item actions' })
    })
    const reply = await res.json()
    if (reply.requestId) {
      await writeState(dataDir, { clientId, requestId: reply.requestId })
    }
  } catch (err) {
    // Couldn't reach the server's own API right now — try again next time.
  }
  return null
}

module.exports = { getSignalKToken, isSecurityEnabled }
