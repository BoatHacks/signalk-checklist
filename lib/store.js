const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

// Only allow safe, filesystem-friendly list ids (no path traversal, no slashes).
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

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

  async _atomicWrite (filePath, data) {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
    await fsp.rename(tmpPath, filePath)
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
      updatedAt: new Date().toISOString()
    }
    await this._atomicWrite(this._fileFor(id), list)
    return list
  }

  /**
   * Replace a list's structure (name + items). Last-write-wins: no locking,
   * no merge — whatever is saved last simply overwrites what was there.
   */
  async saveStructure (id, { name, items }) {
    const existing = await this.get(id)
    if (!existing) throw new Error(`list not found: ${id}`)
    const normalizedItems = (items || []).map((item) => normalizeItem(item))
    const updated = {
      id,
      name: name != null ? String(name).trim() : existing.name,
      items: normalizedItems,
      updatedAt: new Date().toISOString()
    }
    await this._atomicWrite(this._fileFor(id), updated)
    return updated
  }

  async remove (id) {
    const filePath = this._fileFor(id)
    try {
      await fsp.unlink(filePath)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  /** Toggle/set a single item's checked state (run-state only, not structure). */
  async setItemChecked (id, itemId, checked) {
    const list = await this.get(id)
    if (!list) throw new Error(`list not found: ${id}`)
    const item = list.items.find((i) => i.id === itemId)
    if (!item) throw new Error(`item not found: ${itemId}`)
    if (item.type !== 'item') throw new Error('cannot check a section header')
    item.checked = Boolean(checked)
    list.updatedAt = new Date().toISOString()
    await this._atomicWrite(this._fileFor(id), list)
    return list
  }

  /** Manual reset: uncheck every item in the list. */
  async reset (id) {
    const list = await this.get(id)
    if (!list) throw new Error(`list not found: ${id}`)
    for (const item of list.items) {
      if (item.type === 'item') item.checked = false
    }
    list.updatedAt = new Date().toISOString()
    await this._atomicWrite(this._fileFor(id), list)
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
      updatedAt: new Date().toISOString()
    }
    await this._atomicWrite(this._fileFor(id), list)
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
  }
  return normalized
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

module.exports = { ChecklistStore, slugify, isValidId, summarize }
