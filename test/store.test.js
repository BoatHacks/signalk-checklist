const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ChecklistStore, isComplete, normalizeRetentionDays, normalizeAction } = require('../lib/store')

function tempStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-checklist-'))
  return new ChecklistStore(dir)
}

test('create() makes a new list with a slugified id', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Pre Departure' })
  assert.equal(list.name, 'Pre Departure')
  assert.equal(list.id, 'pre-departure')
  assert.deepEqual(list.items, [])
})

test('create() dedupes ids for lists with the same name', async () => {
  const store = tempStore()
  await store.init()
  const a = await store.create({ name: 'Engine' })
  const b = await store.create({ name: 'Engine' })
  assert.notEqual(a.id, b.id)
})

test('saveStructure() normalizes items and is last-write-wins', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Departure' })
  const updated = await store.saveStructure(list.id, {
    name: 'Departure',
    items: [
      { type: 'section', label: 'Engine Room' },
      { type: 'item', label: 'Check oil', checked: false },
      { type: 'item', label: 'Check bilge', checked: true }
    ]
  })
  assert.equal(updated.items.length, 3)
  assert.equal(updated.items[0].type, 'section')
  assert.equal(updated.items[1].checked, false)
  assert.equal(updated.items[2].checked, true)
  assert.ok(updated.items.every((i) => typeof i.id === 'string' && i.id.length > 0))

  // A later save fully overwrites — no merge, no locking.
  const overwritten = await store.saveStructure(list.id, { name: 'Departure', items: [] })
  assert.equal(overwritten.items.length, 0)
})

test('setItemChecked() toggles run-state without touching structure', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Docking' })
  const withItem = await store.saveStructure(list.id, {
    name: 'Docking',
    items: [{ type: 'item', label: 'Fenders out', checked: false }]
  })
  const itemId = withItem.items[0].id
  const updated = await store.setItemChecked(list.id, itemId, true)
  assert.equal(updated.items[0].checked, true)
  assert.equal(updated.items[0].label, 'Fenders out')
})

test('reset() unchecks all items but keeps structure', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Winter Layup' })
  const withItems = await store.saveStructure(list.id, {
    name: 'Winter Layup',
    items: [
      { type: 'item', label: 'Drain water tank', checked: true },
      { type: 'item', label: 'Cover sails', checked: true }
    ]
  })
  assert.equal(withItems.items.filter((i) => i.checked).length, 2)
  const reset = await store.reset(list.id)
  assert.equal(reset.items.filter((i) => i.checked).length, 0)
  assert.equal(reset.items.length, 2)
})

test('listAll() returns progress summaries sorted by name', async () => {
  const store = tempStore()
  await store.init()
  await store.create({ name: 'Zulu List' })
  const alpha = await store.create({ name: 'Alpha List' })
  await store.saveStructure(alpha.id, {
    name: 'Alpha List',
    items: [
      { type: 'item', label: 'A', checked: true },
      { type: 'item', label: 'B', checked: false }
    ]
  })
  const all = await store.listAll()
  assert.equal(all[0].name, 'Alpha List')
  assert.equal(all[0].checked, 1)
  assert.equal(all[0].total, 2)
  assert.equal(all[1].name, 'Zulu List')
})

test('remove() deletes a list; get() then returns null', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Temp' })
  await store.remove(list.id)
  assert.equal(await store.get(list.id), null)
})

test('importList() assigns a fresh id when the imported id already exists', async () => {
  const store = tempStore()
  await store.init()
  const original = await store.create({ name: 'Shared Name' })
  const imported = await store.importList({
    id: original.id,
    name: 'Shared Name',
    items: [{ type: 'item', label: 'Imported item', checked: false }]
  })
  assert.notEqual(imported.id, original.id)
  assert.equal(imported.items[0].label, 'Imported item')
})

test('rejects path-traversal-style list ids', async () => {
  const store = tempStore()
  await store.init()
  await assert.rejects(() => store.get('../../etc/passwd'))
})

test('needsSeeding() is true until the example checklist has been seeded once', async () => {
  const store = tempStore()
  await store.init()
  assert.equal(await store.needsSeeding(), true)
  await store.seedExampleChecklist()
  assert.equal(await store.needsSeeding(), false)
})

test('needsSeeding() stays false even if the seeded example list is later deleted', async () => {
  const store = tempStore()
  await store.init()
  const seeded = await store.seedExampleChecklist()
  await store.remove(seeded.id)
  assert.equal(await store.needsSeeding(), false)
})

test('saveStructure() normalizes valueType and coerces value to match it', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Engine Checks' })
  const updated = await store.saveStructure(list.id, {
    name: 'Engine Checks',
    items: [
      { type: 'item', label: 'Fuel level', valueType: 'number', value: '42.5' },
      { type: 'item', label: 'Notes', valueType: 'text', value: 123 },
      { type: 'item', label: 'Plain checkbox' }
    ]
  })
  assert.equal(updated.items[0].valueType, 'number')
  assert.equal(updated.items[0].value, 42.5)
  assert.equal(updated.items[1].valueType, 'text')
  assert.equal(updated.items[1].value, '123')
  assert.equal(updated.items[2].valueType, null)
  assert.equal(updated.items[2].value, null)
})

test('setItemValue() updates a value field and rejects items without one', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Departure' })
  const withItem = await store.saveStructure(list.id, {
    name: 'Departure',
    items: [
      { type: 'item', label: 'Fuel', valueType: 'number' },
      { type: 'item', label: 'Plain' }
    ]
  })
  const [fuelItem, plainItem] = withItem.items
  const updated = await store.setItemValue(list.id, fuelItem.id, '88')
  assert.equal(updated.items[0].value, 88)
  await assert.rejects(() => store.setItemValue(list.id, plainItem.id, 'x'))
})

test('reset() clears recorded values as well as checked state', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Winter Layup' })
  const withItem = await store.saveStructure(list.id, {
    name: 'Winter Layup',
    items: [{ type: 'item', label: 'Coolant note', valueType: 'text', checked: true, value: 'topped up' }]
  })
  const reset = await store.reset(withItem.id)
  assert.equal(reset.items[0].checked, false)
  assert.equal(reset.items[0].value, null)
})

test('isComplete() is true only when every checkbox item is checked and there is at least one', async () => {
  const store = tempStore()
  await store.init()
  const empty = await store.create({ name: 'Empty' })
  assert.equal(isComplete(empty), false)

  const list = await store.create({ name: 'Two Items' })
  const structured = await store.saveStructure(list.id, {
    name: 'Two Items',
    items: [
      { type: 'item', label: 'A', checked: true },
      { type: 'item', label: 'B', checked: false }
    ]
  })
  assert.equal(isComplete(structured), false)
  const bothChecked = await store.setItemChecked(list.id, structured.items[1].id, true)
  assert.equal(isComplete(bothChecked), true)
})

test('normalizeRetentionDays() treats null/0/empty/negative as "keep forever"', () => {
  assert.equal(normalizeRetentionDays(null), null)
  assert.equal(normalizeRetentionDays(undefined), null)
  assert.equal(normalizeRetentionDays(''), null)
  assert.equal(normalizeRetentionDays(0), null)
  assert.equal(normalizeRetentionDays(-5), null)
  assert.equal(normalizeRetentionDays('not a number'), null)
  assert.equal(normalizeRetentionDays('30'), 30)
  assert.equal(normalizeRetentionDays(14.9), 14)
})

test('create() defaults retentionDays to null (keep forever)', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Departure' })
  assert.equal(list.retentionDays, null)
})

test('saveStructure() sets retentionDays and preserves it when omitted from a later save', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Departure' })
  const withRetention = await store.saveStructure(list.id, { name: 'Departure', items: [], retentionDays: 30 })
  assert.equal(withRetention.retentionDays, 30)

  // A later save that doesn't mention retentionDays keeps the existing value.
  const untouched = await store.saveStructure(list.id, { name: 'Departure', items: [] })
  assert.equal(untouched.retentionDays, 30)

  // Explicitly passing null clears it back to "keep forever".
  const cleared = await store.saveStructure(list.id, { name: 'Departure', items: [], retentionDays: null })
  assert.equal(cleared.retentionDays, null)
})

test('normalizeAction() accepts a well-formed rest action and defaults method to PUT', () => {
  assert.deepEqual(
    normalizeAction({ type: 'rest', url: ' http://192.168.1.50/api/relay ' }),
    { type: 'rest', method: 'PUT', url: 'http://192.168.1.50/api/relay', body: null }
  )
  assert.deepEqual(
    normalizeAction({ type: 'rest', method: 'POST', url: 'http://x', body: '{"on":true}' }),
    { type: 'rest', method: 'POST', url: 'http://x', body: '{"on":true}' }
  )
})

test('normalizeAction() rejects a rest action with no url', () => {
  assert.equal(normalizeAction({ type: 'rest', url: '' }), null)
  assert.equal(normalizeAction({ type: 'rest' }), null)
})

test('normalizeAction() ignores an unrecognized method and falls back to PUT', () => {
  assert.equal(normalizeAction({ type: 'rest', method: 'DELETE', url: 'http://x' }).method, 'PUT')
})

test('normalizeAction() accepts a well-formed delta action, preserving the value\'s JSON type', () => {
  assert.deepEqual(
    normalizeAction({ type: 'delta', path: 'electrical.switches.anchorLight.state', value: true }),
    { type: 'delta', path: 'electrical.switches.anchorLight.state', value: true }
  )
  assert.equal(normalizeAction({ type: 'delta', path: 'a.b', value: 42 }).value, 42)
})

test('normalizeAction() rejects a delta action with a missing or malformed path', () => {
  assert.equal(normalizeAction({ type: 'delta', path: '', value: 1 }), null)
  assert.equal(normalizeAction({ type: 'delta', path: 'has spaces', value: 1 }), null)
  assert.equal(normalizeAction({ type: 'delta', path: '..double.dot', value: 1 }), null)
})

test('normalizeAction() returns null for anything else (missing/unknown type, non-object)', () => {
  assert.equal(normalizeAction(null), null)
  assert.equal(normalizeAction(undefined), null)
  assert.equal(normalizeAction({}), null)
  assert.equal(normalizeAction({ type: 'nonsense' }), null)
})

test('saveStructure() carries a normalized action through on the item, and sections never get one', async () => {
  const store = tempStore()
  await store.init()
  const list = await store.create({ name: 'Engine Checks' })
  const updated = await store.saveStructure(list.id, {
    name: 'Engine Checks',
    items: [
      { type: 'section', label: 'Pre-start', action: { type: 'delta', path: 'a.b', value: 1 } },
      { type: 'item', label: 'Start blower', action: { type: 'delta', path: 'electrical.switches.blower.state', value: true } },
      { type: 'item', label: 'No action here' }
    ]
  })
  assert.equal(updated.items[0].action, undefined)
  assert.deepEqual(updated.items[1].action, { type: 'delta', path: 'electrical.switches.blower.state', value: true })
  assert.equal(updated.items[2].action, null)
})

test('seedExampleChecklist() writes a readable example list', async () => {
  const store = tempStore()
  await store.init()
  const seeded = await store.seedExampleChecklist()
  assert.equal(seeded.id, 'familiarizing-yourself-with-the-checklist-plugin')
  const fromDisk = await store.get(seeded.id)
  assert.equal(fromDisk.name, 'Familiarizing yourself with the checklist plugin')
  assert.ok(fromDisk.items.length > 0)
  assert.ok(fromDisk.items.some((i) => i.type === 'section'))
  assert.ok(fromDisk.items.every((i) => i.type !== 'item' || i.checked === false))
})
