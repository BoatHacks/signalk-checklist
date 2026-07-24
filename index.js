const express = require('express')
const { ChecklistStore } = require('./lib/store')
const { buildStateDelta, buildSummaryDeltas } = require('./lib/delta')

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
      }
    }
  }

  let store

  function broadcast (list, options) {
    app.handleMessage(plugin.id, buildStateDelta(plugin.id, list))
    if (options && options.publishSummary) {
      app.handleMessage(plugin.id, buildSummaryDeltas(plugin.id, list))
    }
  }

  plugin.start = function (options) {
    const dataDir = app.getDataDirPath ? app.getDataDirPath() : './data'
    store = new ChecklistStore(dataDir)

    store.init().catch((err) => {
      app.error(`signalk-checklist: failed to initialize storage: ${err.message}`)
    })

    const router = express.Router()
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

    // Replace list structure (name/items). Last-write-wins, no locking.
    router.put('/lists/:id', asyncHandler(async (req, res) => {
      const list = await store.saveStructure(req.params.id, {
        name: req.body && req.body.name,
        items: req.body && req.body.items
      })
      broadcast(list, options)
      res.json(list)
    }))

    router.delete('/lists/:id', asyncHandler(async (req, res) => {
      await store.remove(req.params.id)
      res.status(204).end()
    }))

    router.post('/lists/:id/reset', asyncHandler(async (req, res) => {
      const list = await store.reset(req.params.id)
      broadcast(list, options)
      res.json(list)
    }))

    router.post('/lists/:id/items/:itemId/check', asyncHandler(async (req, res) => {
      const checked = Boolean(req.body && req.body.checked)
      const list = await store.setItemChecked(req.params.id, req.params.itemId, checked)
      broadcast(list, options)
      res.json(list)
    }))

    router.get('/lists/:id/export', asyncHandler(async (req, res) => {
      const list = await store.get(req.params.id)
      if (!list) return res.status(404).json({ error: 'not found' })
      res.setHeader('Content-Disposition', `attachment; filename="${list.id}.json"`)
      res.json(list)
    }))

    router.post('/lists/import', asyncHandler(async (req, res) => {
      const list = await store.importList(req.body)
      broadcast(list, options)
      res.status(201).json(list)
    }))

    app.registerWithRouter(router)
  }

  plugin.stop = function () {
    store = undefined
  }

  return plugin
}
