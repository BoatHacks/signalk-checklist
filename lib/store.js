const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const { exampleChecklist } = require('./example-checklist')
const { atomicWriteJSON } = require('./atomic-write')

// Only allow safe, filesystem-friendly list ids (no path traversal, no slashes).
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const VALUE_TYPES = new Set(['text', 'number'])

function slugify (name) {
  const base = String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return base || 'list'
}

function isValidId (id) {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

function newItemId () {
  return crypto.randomBytes(6).toString('hex')
}

/** True once every checkbox item in the list is checked (and there's at least one). */
function isComplete (list) {
  const items = list.items.filter((i) => i.type === 'item')
  return items.length > 0 && items.every((i) => i.checked)
}

/** null/0/empty means "keep forever"; otherwise a positive whole number of days. */
function normalizeRetentionDays (value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

const REST_METHODS = new Set(['PUT', 'POST'])
// Loosely matches SignalK's dotted path convention (e.g.
// electrical.switches.anchorLight.state) — just enough to reject garbage,
// not a full spec validator.
const DELTA_PATH_PATTERN = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/

/**
 * Normalizes a per-item action (the optional REST call or SignalK delta a
 * trigger button next to the item can fire). Returns null for anything
 * that isn't a well-formed action, so a half-filled-out config in the
 * editor just doesn't get saved as an action rather than crashing.
 */
function normalizeAction (action) {
  if (!action || typeof action !== 'object') return null

  if (action.type === 'rest') {
    const url = typeof action.url === 'string' ? action.url.trim() : ''
    if (!url) return null
    const method = REST_METHODS.has(action.method) ? action.method : 'PUT'
    const body = typeof action.body === 'string' && action.body.trim() !== '' ? action.body : null
    return { type: 'rest', method, url, body }
  }

  if (action.type === 'delta') {
    const path = typeof action.path === 'string' ? action.path.trim() : ''
    if (!path || !DELTA_PATH_PATTERN.test(path)) return null
    return { type: 'delta', path, value: action.value === undefined ? null : action.value }
  }

  return null
}

/**
 * Normalizes an item's optional live-input SignalK path (subscribed to
 * while running the list, to auto-fill the value field). Only meaningful
 * for items that actually have a value field — null otherwise, even if a
 * path string was supplied, since there'd be nowhere to put the value.
 */
function normalizeInputPath (inputPath, valueType) {
  if (!valueType) return null
  if (typeof inputPath !== 'string') return null
  const trimmed = inputPath.trim()
  if (!trimmed || !DELTA_PATH_PATTERN.test(trimmed)) return null
  return trimmed
}

class ChecklistStore {
  /**
   * @param {string} dataDir directory the plugin is allowed to write to
   */
  constructor (dataDir) {
    this.dataDir = dataDir
  }

  async init () {
    await fsp.mkdir(this.dataDir, { recursive: true })
  }

  _fileFor (id) {
    if (!isValidId(id)) {
      throw new Error(`invalid list id: ${id}`)
    }
    return path.join(this.dataDir, `${id}.json`)
  }

  async listAll () {
    let entries
    try {
      entries = await fsp.readdir(this.dataDir)
    } catch (err) {
      if (err.code === 'ENOENT') return []
      throw err
    }
    const lists = []
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.endsWith('.tmp')) continue
      const id = entry.slice(0, -'.json'.length)
      if (!isValidId(id)) continue
      try {
        const list = await this.get(id)
        if (list) lists.push(summarize(list))
      } catch (err) {
        // Skip unreadable/corrupt files rather than failing the whole listing.
      }
    }
    lists.sort((a, b) => a.name.localeCompare(b.name))
    return lists
  }

  async get (id) {
    const filePath = this._fileFor(id)
    let raw
    try {
      raw = await fsp.readFile(filePath, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return null
      throw err
    }
    return JSON.parse(raw)
  }

  async create ({ name }) {
    if (!name || !String(name).trim()) {
      throw new Error('name is required')
    }
    let id = slugify(name)
    let suffix = 1
    while (await this.get(id)) {
      suffix += 1
      id = `${slugify(name)}-${suffix}`
    }
    const list = {
      id,
      name: String(name).trim(),
      items: [],
      retentionDays: null,
      updatedAt: new Date().toISOString()
    }
    await atomicWriteJSON(this._fileFor(id), list)
    return list
  }

  /**
   * Replace a list's structure (name + items + retention setting).
   * Last-write-wins: no locking, no merge — whatever is saved last simply
   * overwrites what was there.
   */
  async saveStructure (id, { name, items, retentionDays }) {
    const existing = await this.get(id)
    if (!existing) throw new Error(`list not found: ${id}`)
    const normalizedItems = (items || []).map((item) => normalizeItem(item))
    const updated = {
      id,
      name: name != null ? String(name).trim() : existing.name,
      items: normalizedItems,
      retentionDays: retentionDays !== undefined
        ? normalizeRetentionDays(retentionDays)
        : (existing.retentionDays != null ? existing.retentionDays : null),
      updatedAt: new Date().toISOString()
    }
    await atomicWriteJSON(this._fileFor(id), updated)
    return updated
  }

  _markerFile () {
    return path.join(this.dataDir, '.seeded')
  }

  /**
   * True only before the example checklist has ever been seeded. Uses a
   * marker file rather than "is the data dir empty", because the SignalK
   * server itself pre-creates the plugin's data directory before init()
   * runs, and because a user who deletes every list later shouldn't get
   * the example checklist injected back.
   */
  async needsSeeding () {
    try {
      await fsp.access(this._markerFile())
      return false
    } catch (err) {
      return true
    }
  }

  /** Write the example checklist directly (used only on a fresh install). */
  async seedExampleChecklist () {
    const list = exampleChecklist()
    await atomicWriteJSON(this._fileFor(list.id), list)
    await fsp.writeFile(this._markerFile(), new Date().toISOString(), 'utf8')
    return list
  }

  async remove (id) {
    const filePath = this._fileFor(id)
    try {
      await fsp.unlink(filePath)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  /**
   * Toggle/set a single item's checked state (run-state only, not
   * structure). When `value` is provided (the webapp includes the item's
   * live-subscribed SignalK reading at the moment the box is checked),
   * it's recorded onto the item too, in the same write — this is the
   * "note the current value... for later use in export/history" snapshot
   * for items with an inputPath, taken once at check-time rather than on
   * every live update.
   */
  async setItemChecked (id, itemId, checked, value) {
    const list = await this.get(id)
    if (!list) throw new Error(`list not found: ${id}`)
    const item = list.items.find((i) => i.id === itemId)
    if (!item) throw new Error(`item not found: ${itemId}`)
    if (item.type !== 'item') throw new Error('cannot check a section header')
    item.checked = Boolean(checked)
    if (value !== undefined && item.valueType) {
      item.value = coerceValue(item.valueType, value)
    }
    list.updatedAt = new Date().toISOString()
    await atomicWriteJSON(this._fileFor(id), list)
    return list
  }

  /**
   * Set a single item's recorded value (run-state, e.g. a fuel reading or a
   * free-text note jotted down while running the list). Only allowed for
   * items whose structure defines a valueType.
   */
  async setItemValue (id, itemId, value) {
    const list = await this.get(id)
    if (!list) throw new Error(`list not found: ${id}`)
    const item = list.items.find((i) => i.id === itemId)
    if (!item) throw new Error(`item not found: ${itemId}`)
    if (item.type !== 'item') throw new Error('cannot set a value on a section header')
    if (!item.valueType) throw new Error('item has no value field')
    item.value = coerceValue(item.valueType, value)
    list.updatedAt = new Date().toISOString()
    await atomicWriteJSON(this._fileFor(id), list)
    return list
  }

  /** Manual reset: uncheck every item and clear any recorded values. */
  async reset (id) {
    const list = await this.get(id)
    if (!list) throw new Error(`list not found: ${id}`)
    for (const item of list.items) {
      if (item.type === 'item') {
        item.checked = false
        if (item.valueType) item.value = null
      }
    }
    list.updatedAt = new Date().toISOString()
    await atomicWriteJSON(this._fileFor(id), list)
    return list
  }

  /** Import a full list document (from an uploaded file). Assigns a fresh id if needed. */
  async importList (doc) {
    if (!doc || typeof doc !== 'object') throw new Error('invalid list document')
    if (!doc.name || !String(doc.name).trim()) throw new Error('list document missing name')
    const items = Array.isArray(doc.items) ? doc.items.map((item) => normalizeItem(item)) : []

    let id = isValidId(doc.id) ? doc.id : slugify(doc.name)
    if (await this.get(id)) {
      // Don't silently overwrite an existing list on import — pick a fresh id.
      let suffix = 1
      const base = id
      while (await this.get(id)) {
        suffix += 1
        id = `${base}-${suffix}`
      }
    }

    const list = {
      id,
      name: String(doc.name).trim(),
      items,
      retentionDays: normalizeRetentionDays(doc.retentionDays),
      updatedAt: new Date().toISOString()
    }
    await atomicWriteJSON(this._fileFor(id), list)
    return list
  }
}

function normalizeItem (item) {
  const type = item.type === 'section' ? 'section' : 'item'
  const normalized = {
    id: isValidItemId(item.id) ? item.id : newItemId(),
    type,
    label: String(item.label || '').trim()
  }
  if (type === 'item') {
    normalized.checked = Boolean(item.checked)
    const valueType = VALUE_TYPES.has(item.valueType) ? item.valueType : null
    normalized.valueType = valueType
    normalized.value = valueType ? coerceValue(valueType, item.value) : null
    normalized.action = normalizeAction(item.action)
    normalized.inputPath = normalizeInputPath(item.inputPath, valueType)
  }
  return normalized
}

function coerceValue (valueType, value) {
  if (value == null || value === '') return valueType === 'number' ? null : ''
  if (valueType === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return String(value)
}

function isValidItemId (id) {
  return typeof id === 'string' && /^[a-z0-9]{4,32}$/.test(id)
}

function summarize (list) {
  const items = list.items.filter((i) => i.type === 'item')
  return {
    id: list.id,
    name: list.name,
    total: items.length,
    checked: items.filter((i) => i.checked).length,
    updatedAt: list.updatedAt
  }
}

module.exports = { ChecklistStore, slugify, isValidId, summarize, isComplete, normalizeRetentionDays, normalizeAction, normalizeInputPath }
