import { h, render } from './vendor/preact.mjs'
import { useState, useEffect, useCallback, useRef } from './vendor/hooks.mjs'
import htm from './vendor/htm.mjs'

const html = htm.bind(h)
const API = '/plugins/signalk-checklist'

async function apiCall (method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload.error || `request failed (${res.status})`)
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
  return { id: `_new_${Math.random().toString(36).slice(2, 10)}`, type, label: '', checked: false, valueType: null, value: null }
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
      ws = new WebSocket(`${proto}://${location.host}/signalk/v1/stream?subscribe=none`)

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

function Runner ({ list, connected, onToggle, onSetValue, onReset, onEdit, onHistory, onExportMarkdown, onBack }) {
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

    ${items.map((item, idx) => html`
      <div class="edit-row" key=${item.id}>
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
    `)}

    <div class="toolbar">
      <button class="ghost" onClick=${addItem}>+ Item</button>
      <button class="ghost" onClick=${addSection}>+ Section</button>
    </div>

    <div class="toolbar">
      <button class="primary" onClick=${() => onSave({ name, items })}>Save</button>
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

  const flash = (type, text) => {
    setBanner({ type, text })
    setTimeout(() => setBanner((b) => (b && b.text === text ? null : b)), 4000)
  }

  const refreshSummaries = useCallback(async () => {
    try {
      setLists(await apiCall('GET', '/lists'))
    } catch (err) {
      flash('error', err.message)
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
      flash('error', err.message)
    }
  }

  const editList = async (id) => {
    try {
      setCurrent(await apiCall('GET', `/lists/${id}`))
      setView('edit')
    } catch (err) {
      flash('error', err.message)
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
      flash('error', err.message)
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
      flash('error', err.message)
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
      flash('error', err.message)
    }
  }

  const resetList = async () => {
    try {
      setCurrent(await apiCall('POST', `/lists/${current.id}/reset`))
    } catch (err) {
      flash('error', err.message)
    }
  }

  const saveStructure = async ({ name, items }) => {
    try {
      await apiCall('PUT', `/lists/${current.id}`, { name, items })
      flash('ok', 'Saved')
      backToOverview()
    } catch (err) {
      flash('error', err.message)
    }
  }

  const deleteList = async () => {
    if (!confirm(`Delete "${current.name}"? This cannot be undone.`)) return
    try {
      await apiCall('DELETE', `/lists/${current.id}`)
      backToOverview()
    } catch (err) {
      flash('error', err.message)
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
      flash('error', err.message)
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
      flash('error', `Import failed: ${err.message}`)
    }
  }

  if (view === 'run' && current) {
    return html`<${Runner} list=${current} connected=${connected}
      onToggle=${toggleItem} onSetValue=${setItemValue} onReset=${resetList}
      onEdit=${() => setView('edit')} onHistory=${openHistory}
      onExportMarkdown=${exportListMarkdown} onBack=${backToOverview} />`
  }
  if (view === 'history' && current) {
    return html`<${History} list=${current} runs=${runs}
      onExportRunMarkdown=${exportRunMarkdown} onBack=${() => setView('run')} />`
  }
  if (view === 'edit' && current) {
    return html`<${Editor} list=${current} banner=${banner}
      onSave=${saveStructure} onDelete=${deleteList}
      onExport=${exportList} onImport=${importFile} onBack=${backToOverview} />`
  }
  return html`<${Overview} lists=${lists} connected=${connected} banner=${banner}
    onOpen=${openList} onEdit=${editList} onCreate=${createList} />`
}

const appContainer = document.getElementById('app')
appContainer.textContent = ''
render(html`<${App} />`, appContainer)
