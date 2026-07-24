// Seeded once, on a genuinely fresh install (see ChecklistStore.init()'s
// freshInstall flag) — walks a new user through the plugin's own features
// using the checklist itself.

const crypto = require('crypto')

const EXAMPLE_LIST_ID = 'familiarizing-yourself-with-the-checklist-plugin'

function newItemId () {
  return crypto.randomBytes(6).toString('hex')
}

function exampleChecklist () {
  const item = (label) => ({ id: newItemId(), type: 'item', label, checked: false })
  const section = (label) => ({ id: newItemId(), type: 'section', label })

  return {
    id: EXAMPLE_LIST_ID,
    name: 'Familiarizing yourself with the checklist plugin',
    items: [
      section('Running a checklist'),
      item('Tap an item to check it off — try this one'),
      item('Checked items stay in place, just dimmed and struck through'),
      item('Tap "Reset" below the list to uncheck everything and start over'),

      section('Editing'),
      item('Tap "Edit list" to rename this checklist or add, remove, and reorder items'),
      item('Add a section header to group related items together'),

      section('Sharing across devices'),
      item('Open this checklist on another device — checking an item here updates it there live'),
      item('In edit mode, use "Download JSON" to export a list and "Upload JSON" to import one'),

      section("You're all set"),
      item('Delete this example checklist from edit mode whenever you\u2019re ready, or keep it as a template for new lists')
    ],
    updatedAt: new Date().toISOString()
  }
}

module.exports = { EXAMPLE_LIST_ID, exampleChecklist }
