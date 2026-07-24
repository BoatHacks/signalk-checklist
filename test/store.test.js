const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ChecklistStore } = require('../lib/store')

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
