import { h, render, Fragment } from './vendor/preact.mjs'
import { useState, useEffect, useCallback, useRef } from './vendor/hooks.mjs'
import htm from './vendor/htm.mjs'

const html = htm.bind(h)
const API = '/plugins/signalk-checklist'
const THEME_STORAGE_KEY = 'signalk-checklist-theme'
const AUTH_TOKEN_KEY = 'signalk-checklist-auth-token'

// Thrown by apiCall on a 401, so callers can tell "you're not logged in" apart
// from an ordinary error and show the login gate instead of a banner.
class AuthRequiredError extends Error {}

// --- SignalK authentication --------------------------------------------
//
// Primary mechanism: SignalK's documented cookie-based shared session —
// logging in via /signalk/v1/auth/login sets an HttpOnly session cookie,
// and both fetch (with credentials: 'include') and the WebSocket handshake
// send it automatically. That alone is enough on a normal browser.
//
// Belt-and-braces: some MFD/chartplotter browsers restrict cookies more
// aggressively than they restrict Web Storage. The login response also
// hands back the raw JWT, so we additionally stash it in sessionStorage and
// attach it explicitly — as an Authorization header for REST calls, and as
// a ?token= query param for the WebSocket (browsers can't set custom
// headers on a WS handshake). SignalK's own auth middleware already checks
// both sources, so sending both is redundant, never conflicting.
function getStoredToken () {
  try {
    return window.sessionStorage.getItem(AUTH_TOKEN_KEY)
  } catch (err) {
    return null
  }
}
function storeToken (token) {
  try {
    if (token) window.sessionStorage.setItem(AUTH_TOKEN_KEY, token)
    else window.sessionStorage.removeItem(AUTH_TOKEN_KEY)
  } catch (err) {
    // Web Storage unavailable — cookie-based auth still covers us.
  }
}

async function signalKLogin (username, password, rememberMe) {
  const res = await fetch('/signalk/v1/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, rememberMe })
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload.message || payload.error || 'Login failed')
  if (payload.token) storeToken(payload.token)
  return payload
}

async function signalKLogout () {
  await fetch('/signalk/v1/auth/logout', { method: 'PUT', credentials: 'include' }).catch(() => {})
  storeToken(null)
}

async function apiCall (method, path, body) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  const token = getStoredToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(API + path, {
    method,
    credentials: 'include',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    const message = payload.error || `request failed (${res.status})`
    if (res.status === 401) throw new AuthRequiredError(message)
    throw new Error(message)
  }
  if (res.status === 204) return null
  return res.json()
}

function progressOf (list) {
  const items = list.items.filter((i) => i.type === 'item')
  return { checked: items.filter((i) => i.checked).length, total: items.length }
}

function isListComplete (list) {
  const { checked, total } = progressOf(list)
  return total > 0 && checked === total
}

function newDraftItem (type) {
  return { id: `_new_${Math.random().toString(36).slice(2, 10)}`, type, label: '', checked: false, valueType: null, value: null, action: null }
}

/** Best-effort parse for the delta-action value field: keep JSON typing
 *  (true, 42, "text", {..}) when it parses, otherwise fall back to the raw
 *  string as typed. */
function parseActionValue (raw) {
  if (raw == null || raw === '') return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    return raw
  }
}

/** The editor keeps a delta action's value as the raw string the user
 *  typed; convert it to a properly-typed JSON value right before saving. */
function prepareItemsForSave (items) {
  return items.map((item) => {
    if (item.action && item.action.type === 'delta') {
      return { ...item, action: { ...item.action, value: parseActionValue(item.action.value) } }
    }
    return item
  })
}

// --- Live sync -------------------------------------------------------------
//
// The webapp subscribes to SignalK's own delta/WebSocket stream (no separate
// WebSocket server). The plugin always publishes full list state under
// `checklists.<id>.state` regardless of the optional "publish summary"
// setting, and that's the path this app listens to.
function useSignalKSync (onListState) {
  const [connected, setConnected] = useState(false)
  const onListStateRef = useRef(onListState)
  onListStateRef.current = onListState

  useEffect(() => {
    let ws
    let closedByUs = false
    let retryTimer

    function connect () {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const token = getStoredToken()
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : ''
      ws = new WebSocket(`${proto}://${location.host}/signalk/v1/stream?subscribe=none${tokenParam}`)

      ws.addEventListener('open', () => {
        setConnected(true)
        ws.send(JSON.stringify({
          context: 'vessels.self',
          subscribe: [{ path: 'checklists.*', policy: 'instant' }]
        }))
      })

      ws.addEventListener('message', (event) => {
        let msg
        try {
          msg = JSON.parse(event.data)
        } catch (err) {
          return
        }
        if (!msg.updates) return
        for (const update of msg.updates) {
          for (const v of update.values || []) {
            const match = /^checklists\.([^.]+)\.state$/.exec(v.path)
            if (match) onListStateRef.current(v.value)
          }
        }
      })

      ws.addEventListener('close', () => {
        setConnected(false)
        if (!closedByUs) retryTimer = setTimeout(connect, 2000)
      })

      ws.addEventListener('error', () => {
        ws.close()
      })
    }

    connect()
    return () => {
      closedByUs = true
      clearTimeout(retryTimer)
      if (ws) ws.close()
    }
  }, [])

  return connected
}

function SyncIndicator ({ connected }) {
  return html`
    <span class="progress-pill">
      <span class=${`sync-dot ${connected ? 'connected' : 'disconnected'}`}></span>
      ${connected ? 'Live' : 'Reconnecting…'}
    </span>
  `
}

// --- Theme -------------------------------------------------------------
//
// Same convention as signalk-dead-mans-switch: manual light/dark toggle,
// remembered in localStorage, falling back to the OS's prefers-color-scheme
// when nothing's been chosen yet. The plugin's optional "Automatically
// switch theme" setting (autoTheme) additionally follows the boat's sun
// position (vessels.self.environment.sun, falling back to
// environment.mode) via GET /theme — when that's on, the manual toggle is
// hidden, matching dead-mans-switch's behavior exactly.
function getPreferredTheme () {
  let stored = null
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  } catch (err) {
    // localStorage can throw in some restricted/embedded browsers — fall
    // through to the OS preference in that case.
  }
  if (stored === 'light' || stored === 'dark') return stored
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

function SunIcon () {
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" />
  </svg>`
}
function MoonIcon () {
  return html`<svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
  </svg>`
}

function ThemeToggle ({ theme, setTheme }) {
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  return html`
    <button type="button" class="icon-btn theme-toggle" title=${label} aria-label=${label}
      onClick=${() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      ${theme === 'dark' ? html`<${SunIcon} />` : html`<${MoonIcon} />`}
    </button>
  `
}

function LogoutIcon () {
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h9" />
    <path d="M10 12h11m0 0-3.5-3.5M21 12l-3.5 3.5" />
  </svg>`
}

// Shown instead of the normal app whenever an API call comes back 401 —
// SignalK security is enabled and this browser doesn't have (or has lost)
// a valid session. See the AuthRequiredError / signalKLogin block above.
function LoginGate ({ onLoggedIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!username || !password) return
    setBusy(true)
    setError(null)
    try {
      await signalKLogin(username, password, rememberMe)
      onLoggedIn()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return html`
    <div class="login-gate">
      <form class="login-card" onSubmit=${submit}>
        <h1 style="margin:0 0 4px">Sign in</h1>
        <p class="banner" style="margin-bottom:16px">This SignalK server requires you to sign in before using Checklists.</p>
        ${error && html`<div class="banner error">${error}</div>`}
        <div class="field">
          <label>Username</label>
          <input type="text" autocomplete="username" value=${username} onInput=${(e) => setUsername(e.target.value)} />
        </div>
        <div class="field">
          <label>Password</label>
          <input type="password" autocomplete="current-password" value=${password} onInput=${(e) => setPassword(e.target.value)} />
        </div>
        <label class="checkbox-field">
          <input type="checkbox" checked=${rememberMe} onChange=${(e) => setRememberMe(e.target.checked)} />
          Remember me on this device
        </label>
        <button type="submit" class="primary" disabled=${busy} style="width:100%;margin-top:8px">
          ${busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  `
}

function Overview ({ lists, connected, onOpen, onEdit, onCreate, banner }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  return html`
    <header class="bar">
      <h1>Checklists</h1>
      <${SyncIndicator} connected=${connected} />
    </header>
    ${banner && html`<div class=${`banner ${banner.type}`}>${banner.text}</div>`}
    ${lists.length === 0 && !creating && html`<div class="empty">No checklists yet — create your first one.</div>`}
    ${lists.map((list) => html`
      <div class="list-card" key=${list.id}>
        <div class="meta" onClick=${() => onOpen(list.id)}>
          <span class="name">${list.name}</span>
          <span class="progress">${list.checked} / ${list.total} checked</span>
        </div>
        <button class="ghost small" onClick=${() => onEdit(list.id)}>Edit</button>
      </div>
    `)}
    ${!creating && html`<button class="primary" onClick=${() => setCreating(true)}>+ New checklist</button>`}
    ${creating && html`
      <div class="toolbar" style="margin-top:12px">
        <input type="text" placeholder="Checklist name" value=${name}
          onInput=${(e) => setName(e.target.value)} />
        <button class="primary" onClick=${() => { onCreate(name); setName(''); setCreating(false) }}>Create</button>
        <button class="ghost" onClick=${() => { setCreating(false); setName('') }}>Cancel</button>
      </div>
    `}
  `
}

// A per-item value/note field in run mode. Keeps its own local text state so
// typing feels instant, and debounces the actual save — but adopts an
// incoming value from live sync (another device editing the same item)
// unless it's just the echo of what we ourselves just sent.
function ValueInput ({ item, onCommit }) {
  const [value, setValue] = useState(item.value == null ? '' : String(item.value))
  const lastSentRef = useRef(item.value)
  const timerRef = useRef(null)

  useEffect(() => {
    if (item.value !== lastSentRef.current) {
      setValue(item.value == null ? '' : String(item.value))
      lastSentRef.current = item.value
    }
  }, [item.value])

  const commit = (v) => {
    lastSentRef.current = item.valueType === 'number' ? (v === '' ? null : Number(v)) : v
    onCommit(v)
  }

  const handleInput = (e) => {
    const v = e.target.value
    setValue(v)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => commit(v), 600)
  }

  const handleBlur = (e) => {
    clearTimeout(timerRef.current)
    commit(e.target.value)
  }

  return html`
    <input
      class=${`value-input ${item.valueType}`}
      type=${item.valueType === 'number' ? 'number' : 'text'}
      inputmode=${item.valueType === 'number' ? 'decimal' : undefined}
      placeholder=${item.valueType === 'number' ? 'value' : 'note'}
      value=${value}
      onClick=${(e) => e.stopPropagation()}
      onInput=${handleInput}
      onBlur=${handleBlur}
    />
  `
}

// Fires an item's configured action (REST call or SignalK delta) on click,
// entirely independent of the checkbox/value. Shows a brief inline
// busy/success/error state on the button itself rather than relying only
// on the shared banner, since several of these might exist on one screen.
function TriggerButton ({ onTrigger }) {
  const [state, setState] = useState('idle') // idle | busy | ok | error
  const timerRef = useRef(null)

  const handleClick = async (e) => {
    e.stopPropagation()
    if (state === 'busy') return
    setState('busy')
    try {
      await onTrigger()
      setState('ok')
    } catch (err) {
      setState('error')
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setState('idle'), 2500)
  }

  const icon = state === 'busy' ? '…' : state === 'ok' ? '✓' : state === 'error' ? '!' : '⚡'
  const label = state === 'error' ? 'Action failed — tap to retry' : 'Run action'

  return html`
    <button type="button" class=${`icon-btn trigger-btn ${state}`} title=${label} aria-label=${label}
      disabled=${state === 'busy'} onClick=${handleClick}>
      ${icon}
    </button>
  `
}

function Runner ({ list, connected, onToggle, onSetValue, onTrigger, onReset, onEdit, onHistory, onExportMarkdown, onBack }) {
  const { checked, total } = progressOf(list)
  return html`
    <header class="bar">
      <button class="ghost small" onClick=${onBack}>‹ Lists</button>
      <${SyncIndicator} connected=${connected} />
    </header>
    <h1 style="margin:0 0 4px">${list.name}</h1>
    <div class="progress-pill" style="display:inline-block;margin-bottom:10px">${checked} / ${total} done</div>
    <div>
      ${list.items.map((item) => item.type === 'section'
        ? html`<div class="section-header" key=${item.id}>${item.label}</div>`
        : html`
          <div class=${`item-row ${item.checked ? 'checked' : ''}`} key=${item.id}>
            <div class="item-main" onClick=${() => onToggle(item.id, !item.checked)}>
              <span class="checkbox">${item.checked ? '✓' : ''}</span>
              <span class="label">${item.label}</span>
            </div>
            ${item.valueType && html`<${ValueInput} item=${item} onCommit=${(v) => onSetValue(item.id, v)} />`}
            ${item.action && html`<${TriggerButton} onTrigger=${() => onTrigger(item.id)} />`}
          </div>
        `)}
    </div>
    <div class="toolbar">
      <button onClick=${onReset}>Reset</button>
      <button class="ghost" onClick=${onEdit}>Edit list</button>
    </div>
    <div class="toolbar">
      <button class="ghost" onClick=${() => onExportMarkdown(list.id)}>Export Markdown</button>
      <button class="ghost" onClick=${onHistory}>History</button>
    </div>
  `
}

function History ({ list, runs, onExportRunMarkdown, onBack }) {
  return html`
    <header class="bar">
      <button class="ghost small" onClick=${onBack}>‹ Back</button>
      <span></span>
    </header>
    <h1 style="margin:0 0 4px">${list.name}</h1>
    <div class="section-header" style="margin-top:0">Completed runs</div>
    ${list.retentionDays
      ? html`<div class="banner">Runs older than ${list.retentionDays} day${list.retentionDays === 1 ? '' : 's'} are removed automatically.</div>`
      : html`<div class="banner">Runs are kept forever (set a retention limit in Edit list).</div>`}
    ${runs.length === 0 && html`<div class="empty">No completed runs yet — finish every item to archive one.</div>`}
    ${runs.map((run) => html`
      <div class="list-card" key=${run.id}>
        <div class="meta">
          <span class="name">${new Date(run.completedAt).toLocaleString()}</span>
          <span class="progress">${run.checked} / ${run.total} checked</span>
        </div>
        <button class="ghost small" onClick=${() => onExportRunMarkdown(run.listId, run.id)}>Markdown</button>
      </div>
    `)}
  `
}

function Editor ({ list, onSave, onDelete, onExport, onImport, onBack, banner }) {
  const [name, setName] = useState(list.name)
  const [retentionDays, setRetentionDays] = useState(list.retentionDays == null ? '' : String(list.retentionDays))
  const [items, setItems] = useState(list.items.map((i) => ({ ...i })))
  const fileInputRef = useRef(null)

  const move = (idx, dir) => {
    const next = items.slice()
    const swapWith = idx + dir
    if (swapWith < 0 || swapWith >= next.length) return
    ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
    setItems(next)
  }
  const updateLabel = (idx, label) => {
    const next = items.slice()
    next[idx] = { ...next[idx], label }
    setItems(next)
  }
  const updateValueType = (idx, valueType) => {
    const next = items.slice()
    next[idx] = { ...next[idx], valueType: valueType || null, value: null }
    setItems(next)
  }
  const setActionType = (idx, type) => {
    const next = items.slice()
    if (!type) {
      next[idx] = { ...next[idx], action: null }
    } else if (type === 'rest') {
      next[idx] = { ...next[idx], action: { type: 'rest', method: 'PUT', url: '', body: '' } }
    } else {
      next[idx] = { ...next[idx], action: { type: 'delta', path: '', value: '' } }
    }
    setItems(next)
  }
  const updateAction = (idx, patch) => {
    const next = items.slice()
    next[idx] = { ...next[idx], action: { ...next[idx].action, ...patch } }
    setItems(next)
  }
  const removeAt = (idx) => setItems(items.filter((_, i) => i !== idx))
  const addItem = () => setItems([...items, newDraftItem('item')])
  const addSection = () => setItems([...items, newDraftItem('section')])

  return html`
    <header class="bar">
      <button class="ghost small" onClick=${onBack}>‹ Back</button>
      <span></span>
    </header>
    ${banner && html`<div class=${`banner ${banner.type}`}>${banner.text}</div>`}
    <div class="field">
      <label>Checklist name</label>
      <input type="text" value=${name} onInput=${(e) => setName(e.target.value)} />
    </div>

    <div class="field">
      <label>Keep completed runs for (days)</label>
      <input type="number" min="1" placeholder="Forever" value=${retentionDays}
        onInput=${(e) => setRetentionDays(e.target.value)} />
    </div>

    ${items.map((item, idx) => html`
      <${Fragment} key=${item.id}>
        <div class="edit-row">
          <span class="tag">${item.type === 'section' ? 'SECTION' : 'item'}</span>
          <input type="text" placeholder=${item.type === 'section' ? 'Section title' : 'Item label'}
            value=${item.label} onInput=${(e) => updateLabel(idx, e.target.value)} />
          ${item.type === 'item' && html`
            <select class="value-type-select" value=${item.valueType || ''}
              onChange=${(e) => updateValueType(idx, e.target.value)}>
              <option value="">No value</option>
              <option value="text">Text</option>
              <option value="number">Number</option>
            </select>
          `}
          <button class="ghost small" onClick=${() => move(idx, -1)} disabled=${idx === 0}>↑</button>
          <button class="ghost small" onClick=${() => move(idx, 1)} disabled=${idx === items.length - 1}>↓</button>
          <button class="danger small" onClick=${() => removeAt(idx)}>✕</button>
        </div>
        ${item.type === 'item' && html`
          <div class="action-config">
            <select class="value-type-select" value=${item.action ? item.action.type : ''}
              onChange=${(e) => setActionType(idx, e.target.value)}>
              <option value="">No action button</option>
              <option value="rest">REST call</option>
              <option value="delta">SignalK delta</option>
            </select>
            ${item.action && item.action.type === 'rest' && html`
              <select class="value-type-select" value=${item.action.method || 'PUT'}
                onChange=${(e) => updateAction(idx, { method: e.target.value })}>
                <option value="PUT">PUT</option>
                <option value="POST">POST</option>
              </select>
              <input type="text" class="action-input" placeholder="https://192.168.1.50/api/relay"
                value=${item.action.url || ''} onInput=${(e) => updateAction(idx, { url: e.target.value })} />
              <input type="text" class="action-input" placeholder="Body (optional, e.g. JSON)"
                value=${item.action.body || ''} onInput=${(e) => updateAction(idx, { body: e.target.value })} />
            `}
            ${item.action && item.action.type === 'delta' && html`
              <input type="text" class="action-input" placeholder="SignalK path, e.g. electrical.switches.anchorLight.state"
                value=${item.action.path || ''} onInput=${(e) => updateAction(idx, { path: e.target.value })} />
              <input type="text" class="action-input" placeholder="Value, e.g. true or 1 or &quot;text&quot;"
                value=${item.action.value ?? ''} onInput=${(e) => updateAction(idx, { value: e.target.value })} />
            `}
          </div>
        `}
      <//>
    `)}

    <div class="toolbar">
      <button class="ghost" onClick=${addItem}>+ Item</button>
      <button class="ghost" onClick=${addSection}>+ Section</button>
    </div>

    <div class="toolbar">
      <button class="primary" onClick=${() => onSave({ name, items: prepareItemsForSave(items), retentionDays: retentionDays === '' ? null : Number(retentionDays) })}>Save</button>
      <button class="danger" onClick=${onDelete}>Delete checklist</button>
    </div>

    <div class="toolbar">
      <button class="ghost" onClick=${() => onExport(list.id)}>Download JSON</button>
      <button class="ghost" onClick=${() => fileInputRef.current.click()}>Upload JSON…</button>
      <input type="file" accept="application/json" ref=${fileInputRef} style="display:none"
        onChange=${(e) => { onImport(e.target.files[0]); e.target.value = '' }} />
    </div>
  `
}

function App () {
  const [lists, setLists] = useState([])
  const [view, setView] = useState('overview')
  const [current, setCurrent] = useState(null)
  const [runs, setRuns] = useState([])
  const [banner, setBanner] = useState(null)
  const [theme, setTheme] = useState(getPreferredTheme())
  const [themeConfig, setThemeConfig] = useState({ autoTheme: false, recommendation: null })
  const [authRequired, setAuthRequired] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch (err) {
      // Theme just won't persist across reloads on this browser.
    }
  }, [theme])

  // Poll the plugin's sun-based recommendation. Sun position changes slowly,
  // so this doesn't need to be frequent — just often enough to catch dusk/
  // dawn transitions in reasonable time.
  useEffect(() => {
    let cancelled = false
    async function poll () {
      try {
        const cfg = await apiCall('GET', '/theme')
        if (!cancelled) setThemeConfig(cfg)
      } catch (err) {
        // No recommendation this cycle (including "not logged in yet") —
        // leave the current theme as-is; the normal login gate below
        // handles the auth side of things.
      }
    }
    poll()
    const interval = setInterval(poll, 60000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  useEffect(() => {
    if (!themeConfig.autoTheme) return
    const { recommendation } = themeConfig
    if ((recommendation === 'light' || recommendation === 'dark') && recommendation !== theme) {
      setTheme(recommendation)
    }
  }, [themeConfig, theme])

  const flash = (type, text) => {
    setBanner({ type, text })
    setTimeout(() => setBanner((b) => (b && b.text === text ? null : b)), 4000)
  }

  // Central place for handling a failed API call: a 401 means this browser
  // isn't (or is no longer) authenticated, so show the login gate instead
  // of just flashing an error banner the person can't do anything about.
  const handleErr = (err, message) => {
    if (err instanceof AuthRequiredError) {
      setAuthRequired(true)
    } else {
      flash('error', message || err.message)
    }
  }

  const refreshSummaries = useCallback(async () => {
    try {
      setLists(await apiCall('GET', '/lists'))
    } catch (err) {
      handleErr(err)
    }
  }, [])

  useEffect(() => { refreshSummaries() }, [refreshSummaries])

  const connected = useSignalKSync((updatedList) => {
    // Keep overview counts live for every list, and the open list live too.
    setLists((prev) => prev.map((l) => (l.id === updatedList.id
      ? { ...l, ...summaryFrom(updatedList) }
      : l)))
    setCurrent((prevCurrent) => (prevCurrent && prevCurrent.id === updatedList.id ? updatedList : prevCurrent))
  })

  function summaryFrom (list) {
    const { checked, total } = progressOf(list)
    return { name: list.name, checked, total, updatedAt: list.updatedAt }
  }

  const openList = async (id) => {
    try {
      setCurrent(await apiCall('GET', `/lists/${id}`))
      setView('run')
    } catch (err) {
      handleErr(err)
    }
  }

  const editList = async (id) => {
    try {
      setCurrent(await apiCall('GET', `/lists/${id}`))
      setView('edit')
    } catch (err) {
      handleErr(err)
    }
  }

  const backToOverview = () => { setCurrent(null); setView('overview'); refreshSummaries() }

  const createList = async (name) => {
    if (!name || !name.trim()) return
    try {
      const list = await apiCall('POST', '/lists', { name })
      await refreshSummaries()
      setCurrent(list)
      setView('edit')
    } catch (err) {
      handleErr(err)
    }
  }

  const announceIfJustCompleted = (wasComplete, updated) => {
    if (!wasComplete && isListComplete(updated)) {
      flash('ok', 'Checklist complete — saved to history!')
    }
  }

  const toggleItem = async (itemId, checked) => {
    const wasComplete = isListComplete(current)
    setCurrent((c) => ({
      ...c,
      items: c.items.map((i) => (i.id === itemId ? { ...i, checked } : i))
    }))
    try {
      const updated = await apiCall('POST', `/lists/${current.id}/items/${itemId}/check`, { checked })
      setCurrent(updated)
      announceIfJustCompleted(wasComplete, updated)
    } catch (err) {
      handleErr(err)
    }
  }

  const setItemValue = async (itemId, value) => {
    const wasComplete = isListComplete(current)
    setCurrent((c) => ({
      ...c,
      items: c.items.map((i) => (i.id === itemId ? { ...i, value } : i))
    }))
    try {
      const updated = await apiCall('POST', `/lists/${current.id}/items/${itemId}/value`, { value })
      setCurrent(updated)
      announceIfJustCompleted(wasComplete, updated)
    } catch (err) {
      handleErr(err)
    }
  }

  const triggerItem = async (itemId) => {
    try {
      const result = await apiCall('POST', `/lists/${current.id}/items/${itemId}/trigger`)
      if (!result.ok) {
        throw new Error(result.type === 'rest' ? `Remote returned ${result.status} ${result.statusText}` : 'Action failed')
      }
      return result
    } catch (err) {
      // Rethrown so the trigger button itself still shows its own local
      // error state, but a 401 also surfaces the shared login gate.
      if (err instanceof AuthRequiredError) setAuthRequired(true)
      throw err
    }
  }

  const resetList = async () => {
    try {
      setCurrent(await apiCall('POST', `/lists/${current.id}/reset`))
    } catch (err) {
      handleErr(err)
    }
  }

  const saveStructure = async ({ name, items, retentionDays }) => {
    try {
      await apiCall('PUT', `/lists/${current.id}`, { name, items, retentionDays })
      flash('ok', 'Saved')
      backToOverview()
    } catch (err) {
      handleErr(err)
    }
  }

  const deleteList = async () => {
    if (!confirm(`Delete "${current.name}"? This cannot be undone.`)) return
    try {
      await apiCall('DELETE', `/lists/${current.id}`)
      backToOverview()
    } catch (err) {
      handleErr(err)
    }
  }

  const exportList = (id) => {
    window.open(`${API}/lists/${id}/export`, '_blank')
  }

  const exportListMarkdown = (id) => {
    window.open(`${API}/lists/${id}/export/markdown`, '_blank')
  }

  const exportRunMarkdown = (listId, runId) => {
    window.open(`${API}/lists/${listId}/runs/${runId}/export/markdown`, '_blank')
  }

  const openHistory = async () => {
    try {
      setRuns(await apiCall('GET', `/lists/${current.id}/runs`))
      setView('history')
    } catch (err) {
      handleErr(err)
    }
  }

  const importFile = async (file) => {
    if (!file) return
    try {
      const text = await file.text()
      const doc = JSON.parse(text)
      await apiCall('POST', '/lists/import', doc)
      await refreshSummaries()
      flash('ok', `Imported "${doc.name}"`)
    } catch (err) {
      handleErr(err, `Import failed: ${err.message}`)
    }
  }

  if (authRequired) {
    return html`<${LoginGate} onLoggedIn=${() => location.reload()} />`
  }

  let content
  if (view === 'run' && current) {
    content = html`<${Runner} list=${current} connected=${connected}
      onToggle=${toggleItem} onSetValue=${setItemValue} onTrigger=${triggerItem} onReset=${resetList}
      onEdit=${() => setView('edit')} onHistory=${openHistory}
      onExportMarkdown=${exportListMarkdown} onBack=${backToOverview} />`
  } else if (view === 'history' && current) {
    content = html`<${History} list=${current} runs=${runs}
      onExportRunMarkdown=${exportRunMarkdown} onBack=${() => setView('run')} />`
  } else if (view === 'edit' && current) {
    content = html`<${Editor} list=${current} banner=${banner}
      onSave=${saveStructure} onDelete=${deleteList}
      onExport=${exportList} onImport=${importFile} onBack=${backToOverview} />`
  } else {
    content = html`<${Overview} lists=${lists} connected=${connected} banner=${banner}
      onOpen=${openList} onEdit=${editList} onCreate=${createList} />`
  }

  return html`
    <${Fragment}>
      <div class="theme-toolbar">
        ${!themeConfig.autoTheme && html`<${ThemeToggle} theme=${theme} setTheme=${setTheme} />`}
        <button type="button" class="icon-btn" title="Sign out" aria-label="Sign out"
          onClick=${() => signalKLogout().then(() => location.reload())}>
          <${LogoutIcon} />
        </button>
      </div>
      ${content}
    <//>
  `
}

const appContainer = document.getElementById('app')
appContainer.textContent = ''
render(html`<${App} />`, appContainer)
