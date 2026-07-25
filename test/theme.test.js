const test = require('node:test')
const assert = require('node:assert/strict')
const { computeThemeRecommendation } = require('../lib/theme')

function fakeApp (selfPaths) {
  return { getSelfPath: (path) => selfPaths[path] }
}

test('returns null when autoTheme is off', () => {
  const app = fakeApp({ 'environment.sun': 'day' })
  assert.equal(computeThemeRecommendation(app, { autoTheme: false }), null)
  assert.equal(computeThemeRecommendation(app, {}), null)
})

test('returns null when the host has no getSelfPath', () => {
  assert.equal(computeThemeRecommendation({}, { autoTheme: true }), null)
})

test('environment.sun "day" recommends light', () => {
  const app = fakeApp({ 'environment.sun': 'day' })
  assert.equal(computeThemeRecommendation(app, { autoTheme: true }), 'light')
})

for (const phase of ['dawn', 'sunrise', 'sunset', 'dusk', 'night']) {
  test(`environment.sun "${phase}" recommends dark`, () => {
    const app = fakeApp({ 'environment.sun': phase })
    assert.equal(computeThemeRecommendation(app, { autoTheme: true }), 'dark')
  })
}

test('unwraps a {value, timestamp, $source}-shaped node', () => {
  const app = fakeApp({ 'environment.sun': { value: 'night', timestamp: '2026-01-01T00:00:00Z' } })
  assert.equal(computeThemeRecommendation(app, { autoTheme: true }), 'dark')
})

test('falls back to environment.mode when environment.sun has no recognized value', () => {
  const app = fakeApp({ 'environment.sun': undefined, 'environment.mode': 'Night' })
  assert.equal(computeThemeRecommendation(app, { autoTheme: true }), 'dark')
})

test('environment.mode "day" (any case) recommends light', () => {
  const app = fakeApp({ 'environment.mode': 'DAY' })
  assert.equal(computeThemeRecommendation(app, { autoTheme: true }), 'light')
})

test('returns null when neither path has a recognized value', () => {
  const app = fakeApp({})
  assert.equal(computeThemeRecommendation(app, { autoTheme: true }), null)
})

test('a getSelfPath that throws is treated the same as no value', () => {
  const app = { getSelfPath: () => { throw new Error('not ready') } }
  assert.equal(computeThemeRecommendation(app, { autoTheme: true }), null)
})
