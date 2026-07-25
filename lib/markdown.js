/**
 * Render a checklist document to Markdown. Works for both a live list and a
 * historical run snapshot (both have the same `items` shape).
 *
 * @param {{name: string, items: Array}} doc
 * @param {{timestampLabel?: string, timestamp?: string}} [opts]
 */
function renderChecklistMarkdown (doc, opts = {}) {
  const lines = [`# ${doc.name}`, '']
  if (opts.timestamp) {
    lines.push(`_${opts.timestampLabel || 'Exported'}: ${opts.timestamp}_`, '')
  }

  for (const item of doc.items) {
    if (item.type === 'section') {
      lines.push(`## ${item.label}`, '')
      continue
    }
    const box = item.checked ? '[x]' : '[ ]'
    let line = `- ${box} ${item.label}`
    if (item.valueType && item.value != null && item.value !== '') {
      line += ` — ${item.value}`
    }
    lines.push(line)
  }

  lines.push('')
  return lines.join('\n')
}

module.exports = { renderChecklistMarkdown }
