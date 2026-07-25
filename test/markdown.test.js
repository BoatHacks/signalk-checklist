const test = require('node:test')
const assert = require('node:assert/strict')
const { renderChecklistMarkdown } = require('../lib/markdown')

test('renders sections, checked/unchecked items, and values', () => {
  const md = renderChecklistMarkdown({
    name: 'Pre-Departure',
    items: [
      { type: 'section', label: 'Engine Room' },
      { type: 'item', label: 'Check oil', checked: true, valueType: null, value: null },
      { type: 'item', label: 'Fuel level', checked: true, valueType: 'number', value: 88 },
      { type: 'item', label: 'Check bilge', checked: false, valueType: null, value: null }
    ]
  })

  assert.match(md, /^# Pre-Departure/)
  assert.match(md, /## Engine Room/)
  assert.match(md, /- \[x\] Check oil/)
  assert.match(md, /- \[x\] Fuel level — 88/)
  assert.match(md, /- \[ \] Check bilge/)
})

test('includes an optional timestamp line', () => {
  const md = renderChecklistMarkdown(
    { name: 'Departure', items: [] },
    { timestampLabel: 'Completed', timestamp: '2026-07-24T19:00:00.000Z' }
  )
  assert.match(md, /_Completed: 2026-07-24T19:00:00\.000Z_/)
})

test('omits empty text values from the line', () => {
  const md = renderChecklistMarkdown({
    name: 'List',
    items: [{ type: 'item', label: 'Note', checked: false, valueType: 'text', value: '' }]
  })
  assert.match(md, /- \[ \] Note\n/)
  assert.doesNotMatch(md, /—/)
})
