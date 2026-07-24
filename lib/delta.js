/**
 * Delta builders for signalk-checklist.
 *
 * Two distinct things are published, always kept separate:
 *
 *  - `buildStateDelta`: the full list document under `checklists.<id>.state`.
 *    Always sent (this IS the live-sync mechanism the webapp itself relies
 *    on) regardless of the plugin's optional "publish summary" config.
 *
 *  - `buildSummaryDeltas`: lightweight numeric paths (checked/total counts)
 *    intended for other plugins/automations to react to. Only sent when the
 *    user has opted in via plugin config.
 */

function buildStateDelta (pluginId, list) {
  return {
    updates: [
      {
        source: { label: pluginId },
        timestamp: new Date().toISOString(),
        values: [
          {
            path: `checklists.${list.id}.state`,
            value: list
          }
        ]
      }
    ]
  }
}

function buildSummaryDeltas (pluginId, list) {
  const items = list.items.filter((i) => i.type === 'item')
  const checked = items.filter((i) => i.checked).length
  const total = items.length
  return {
    updates: [
      {
        source: { label: pluginId },
        timestamp: new Date().toISOString(),
        values: [
          { path: `checklists.${list.id}.checkedCount`, value: checked },
          { path: `checklists.${list.id}.totalCount`, value: total },
          { path: `checklists.${list.id}.complete`, value: total > 0 && checked === total }
        ]
      }
    ]
  }
}

module.exports = { buildStateDelta, buildSummaryDeltas }
