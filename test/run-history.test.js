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

test('pruneExpiredRuns() is a no-op when retentionDays is null/0/undefined', async () => {
  const history = tempRunHistory()
  await history.archiveRun(sampleList)
  await history.pruneExpiredRuns('pre-departure', null)
  await history.pruneExpiredRuns('pre-departure', 0)
  await history.pruneExpiredRuns('pre-departure', undefined)
  assert.equal((await history.listRuns('pre-departure')).length, 1)
})

test('pruneExpiredRuns() deletes only runs older than the retention window', async () => {
  const history = tempRunHistory()
  const dir = history._dirFor('pre-departure')
  const fresh = await history.archiveRun(sampleList)
  const old = await history.archiveRun(sampleList)

  // Backdate the "old" run's completedAt and rewrite it directly on disk,
  // simulating a run archived well outside a short retention window.
  const oldRun = await history.getRun('pre-departure', old.id)
  oldRun.completedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  fs.writeFileSync(path.join(dir, `${old.id}.json`), JSON.stringify(oldRun))

  await history.pruneExpiredRuns('pre-departure', 5)

  const remaining = await history.listRuns('pre-departure')
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, fresh.id)
})

test('pruneExpiredRuns() on a list with no run history yet does not throw', async () => {
  const history = tempRunHistory()
  await history.pruneExpiredRuns('never-run', 7)
})
