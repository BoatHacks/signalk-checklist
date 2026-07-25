const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { RunHistoryStore } = require('../lib/run-history')

function tempRunHistory () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-checklist-runs-'))
  return new RunHistoryStore(dir)
}

const sampleList = {
  id: 'pre-departure',
  name: 'Pre-Departure',
  items: [
    { id: 'a1', type: 'section', label: 'Engine' },
    { id: 'a2', type: 'item', label: 'Check oil', checked: true, valueType: null, value: null },
    { id: 'a3', type: 'item', label: 'Fuel level', checked: true, valueType: 'number', value: 88 }
  ]
}

test('archiveRun() writes a run with a fresh id and full item snapshot', async () => {
  const history = tempRunHistory()
  const run = await history.archiveRun(sampleList)
  assert.equal(run.listId, 'pre-departure')
  assert.equal(run.listName, 'Pre-Departure')
  assert.ok(run.id)
  assert.ok(run.completedAt)
  assert.equal(run.items.length, 3)
  assert.equal(run.items[2].value, 88)
})

test('listRuns() returns summaries sorted most-recent-first', async () => {
  const history = tempRunHistory()
  const first = await history.archiveRun(sampleList)
  await new Promise((resolve) => setTimeout(resolve, 5))
  const second = await history.archiveRun(sampleList)
  const runs = await history.listRuns('pre-departure')
  assert.equal(runs.length, 2)
  assert.equal(runs[0].id, second.id)
  assert.equal(runs[1].id, first.id)
  assert.equal(runs[0].total, 2)
  assert.equal(runs[0].checked, 2)
})

test('listRuns() returns an empty array for a list with no history yet', async () => {
  const history = tempRunHistory()
  assert.deepEqual(await history.listRuns('never-run'), [])
})

test('getRun() returns null for an unknown run id', async () => {
  const history = tempRunHistory()
  await history.archiveRun(sampleList)
  assert.equal(await history.getRun('pre-departure', '20260101T000000-abcdef'), null)
})

test('getRun()/_dirFor() reject path-traversal-style ids', async () => {
  const history = tempRunHistory()
  await assert.rejects(() => history.getRun('../../etc', 'x'))
  await assert.rejects(() => history.getRun('pre-departure', '../../etc/passwd'))
})
