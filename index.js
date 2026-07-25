const express = require('express')
const { ChecklistStore, isComplete } = require('./lib/store')
const { RunHistoryStore } = require('./lib/run-history')
const { buildStateDelta, buildSummaryDeltas } = require('./lib/delta')
const { renderChecklistMarkdown } = require('./lib/markdown')
const { computeThemeRecommendation } = require('./lib/theme')

module.exports = function (app) {
  const plugin = {}

  plugin.id = 'signalk-checklist'
  plugin.name = 'Checklist'
  plugin.description = 'Generic, user-defined checklists with a touch-friendly webapp and live cross-device sync'

  plugin.schema = {
    type: 'object',
    properties: {
      publishSummary: {
        type: 'boolean',
        title: 'Publish checklist summary (checked/total counts, complete flag) to the wider SignalK data tree',
        description: 'Internal live-sync between webapp clients always happens regardless of this setting.',
        default: false
      },
      autoTheme: {
        type: 'boolean',
        title: 'Automatically switch light/dark theme based on sun position',
        description: 'Webapp follows vessels.self.environment.sun (preferred — dawn/sunrise/day/sunset/dusk/night) or vessels.self.environment.mode (simpler day/night fallback) instead of the manual light/dark toggle. Needs a plugin like signalk-derived-data publishing one of those paths.',
        default: false
      }
    }
  }

  let store
  let runHistory
  let currentOptions = {}

  function broadcast (list) {
    app.handleMessage(plugin.id, buildStateDelta(plugin.id, list))
    if (currentOptions && currentOptions.publishSummary) {
      app.handleMessage(plugin.id, buildSummaryDeltas(plugin.id, list))
    }
  }

  // If a run-state change (check/value) just pushed the list from incomplete
  // to fully complete, archive a snapshot into that list's run history, then
  // sweep out anything past that list's configured retention window.
  async function maybeArchive (wasComplete, list) {
    if (!wasComplete && isComplete(list)) {
      await runHistory.archiveRun(list)
      await runHistory.pruneExpiredRuns(list.id, list.retentionDays)
    }
  }

  plugin.start = function (options) {
    currentOptions = options || {}
    const dataDir = app.getDataDirPath ? app.getDataDirPath() : './data'
    store = new ChecklistStore(dataDir)
    runHistory = new RunHistoryStore(dataDir)

    store.init()
      .then(() => store.needsSeeding())
      .then((needsSeeding) => {
        if (needsSeeding) return store.seedExampleChecklist()
      })
      .then(() => store.listAll())
      .then((lists) => Promise.all(lists.map(async (summary) => {
        const list = await store.get(summary.id)
        if (list) await runHistory.pruneExpiredRuns(list.id, list.retentionDays)
      })))
      .catch((err) => {
        app.error(`signalk-checklist: failed to initialize storage: ${err.message}`)
      })
  }

  // The server creates a router mounted at /plugins/<plugin.id> and hands it
  // to us here — we add routes onto it directly, we don't create our own.
  plugin.registerWithRouter = function (router) {
    router.use(express.json({ limit: '2mb' }))

    const asyncHandler = (fn) => (req, res) => {
      Promise.resolve(fn(req, res)).catch((err) => {
        app.debug(`signalk-checklist error: ${err.message}`)
        res.status(400).json({ error: err.message })
      })
    }

    router.get('/lists', asyncHandler(async (req, res) => {
      res.json(await store.listAll())
    }))

    router.post('/lists', asyncHandler(async (req, res) => {
      const list = await store.create({ name: req.body && req.body.name })
      res.status(201).json(list)
    }))

    router.get('/lists/:id', asyncHandler(async (req, res) => {
      const list = await store.get(req.params.id)
      if (!list) return res.status(404).json({ error: 'not found' })
      res.json(list)
    }))

    // Replace list structure (name/items, including each item's optional
    // valueType, and the list's run-history retention window). Last-write-wins, no locking.
    router.put('/lists/:id', asyncHandler(async (req, res) => {
      const list = await store.saveStructure(req.params.id, {
        name: req.body && req.body.name,
        items: req.body && req.body.items,
        retentionDays: req.body && req.body.retentionDays
      })
      broadcast(list)
      res.json(list)
    }))

    router.delete('/lists/:id', asyncHandler(async (req, res) => {
      await store.remove(req.params.id)
      res.status(204).end()
    }))

    router.post('/lists/:id/reset', asyncHandler(async (req, res) => {
      const list = await store.reset(req.params.id)
      broadcast(list)
      res.json(list)
    }))

    router.post('/lists/:id/items/:itemId/check', asyncHandler(async (req, res) => {
      const before = await store.get(req.params.id)
      if (!before) return res.status(404).json({ error: 'not found' })
      const wasComplete = isComplete(before)
      const checked = Boolean(req.body && req.body.checked)
      const list = await store.setItemChecked(req.params.id, req.params.itemId, checked)
      await maybeArchive(wasComplete, list)
      broadcast(list)
      res.json(list)
    }))

    // Record a per-item value (free-text note or number) while running a
    // list. Only valid for items whose structure defines a valueType.
    router.post('/lists/:id/items/:itemId/value', asyncHandler(async (req, res) => {
      const before = await store.get(req.params.id)
      if (!before) return res.status(404).json({ error: 'not found' })
      const wasComplete = isComplete(before)
      const list = await store.setItemValue(req.params.id, req.params.itemId, req.body && req.body.value)
      await maybeArchive(wasComplete, list)
      broadcast(list)
      res.json(list)
    }))

    router.get('/lists/:id/export', asyncHandler(async (req, res) => {
      const list = await store.get(req.params.id)
      if (!list) return res.status(404).json({ error: 'not found' })
      res.setHeader('Content-Disposition', `attachment; filename="${list.id}.json"`)
      res.json(list)
    }))

    // Manual Markdown export of the list's current (live) state.
    router.get('/lists/:id/export/markdown', asyncHandler(async (req, res) => {
      const list = await store.get(req.params.id)
      if (!list) return res.status(404).json({ error: 'not found' })
      const markdown = renderChecklistMarkdown(list, { timestampLabel: 'Exported', timestamp: new Date().toISOString() })
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${list.id}.md"`)
      res.send(markdown)
    }))

    router.post('/lists/import', asyncHandler(async (req, res) => {
      const list = await store.importList(req.body)
      broadcast(list)
      res.status(201).json(list)
    }))

    // Run history: completed snapshots, auto-archived whenever a list hits 100%.
    router.get('/lists/:id/runs', asyncHandler(async (req, res) => {
      const list = await store.get(req.params.id)
      if (list) await runHistory.pruneExpiredRuns(list.id, list.retentionDays)
      res.json(await runHistory.listRuns(req.params.id))
    }))

    router.get('/lists/:id/runs/:runId', asyncHandler(async (req, res) => {
      const run = await runHistory.getRun(req.params.id, req.params.runId)
      if (!run) return res.status(404).json({ error: 'not found' })
      res.json(run)
    }))

    router.get('/lists/:id/runs/:runId/export/markdown', asyncHandler(async (req, res) => {
      const run = await runHistory.getRun(req.params.id, req.params.runId)
      if (!run) return res.status(404).json({ error: 'not found' })
      const markdown = renderChecklistMarkdown(
        { name: run.listName, items: run.items },
        { timestampLabel: 'Completed', timestamp: run.completedAt }
      )
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${run.listId}-${run.id}.md"`)
      res.send(markdown)
    }))

    // Sun-position-based theme recommendation for the webapp's optional
    // "Automatically switch theme" setting. Read fresh on every call rather
    // than pushed via delta — the webapp only polls this every ~60s, so a
    // separate push mechanism would add complexity without adding
    // responsiveness that matters for something as slow-changing as sun
    // position.
    router.get('/theme', (req, res) => {
      res.set('Cache-Control', 'no-store')
      res.json({
        autoTheme: Boolean(currentOptions.autoTheme),
        recommendation: computeThemeRecommendation(app, currentOptions)
      })
    })
  }

  plugin.stop = function () {
    store = undefined
    runHistory = undefined
  }

  return plugin
}
