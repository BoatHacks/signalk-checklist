const test = require('node:test')
const assert = require('node:assert/strict')
const { triggerAction } = require('../lib/actions')

function fakeApp () {
  const messages = []
  return { app: { handleMessage: (id, delta) => messages.push({ id, delta }) }, messages }
}

test('throws when there is no action to run', async () => {
  await assert.rejects(() => triggerAction(null, {}), /no configured action/)
})

test('throws for an unrecognized action type', async () => {
  await assert.rejects(() => triggerAction({ type: 'carrier-pigeon' }, {}), /unknown action type/)
})

test('delta action publishes via app.handleMessage with the configured path/value', async () => {
  const { app, messages } = fakeApp()
  const result = await triggerAction(
    { type: 'delta', path: 'electrical.switches.anchorLight.state', value: true },
    { app, pluginId: 'signalk-checklist' }
  )
  assert.deepEqual(result, { ok: true, type: 'delta', path: 'electrical.switches.anchorLight.state' })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].id, 'signalk-checklist')
  assert.deepEqual(messages[0].delta.updates[0].values[0], {
    path: 'electrical.switches.anchorLight.state',
    value: true
  })
})

test('rest action calls fetch with method/url/body and reports the remote status', async () => {
  let capturedUrl, capturedInit
  const fetchImpl = async (url, init) => {
    capturedUrl = url
    capturedInit = init
    return { ok: true, status: 200, statusText: 'OK' }
  }
  const result = await triggerAction(
    { type: 'rest', method: 'POST', url: 'http://192.168.1.50/api/relay', body: '{"on":true}' },
    { fetchImpl }
  )
  assert.equal(capturedUrl, 'http://192.168.1.50/api/relay')
  assert.equal(capturedInit.method, 'POST')
  assert.equal(capturedInit.body, '{"on":true}')
  assert.equal(capturedInit.headers['Content-Type'], 'application/json')
  assert.deepEqual(result, { ok: true, type: 'rest', status: 200, statusText: 'OK' })
})

test('rest action reports ok:false on a non-2xx response rather than throwing', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' })
  const result = await triggerAction({ type: 'rest', method: 'PUT', url: 'http://x', body: null }, { fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.status, 500)
})

test('rest action with a non-JSON body sends it as text/plain', async () => {
  let capturedInit
  const fetchImpl = async (url, init) => { capturedInit = init; return { ok: true, status: 200, statusText: 'OK' } }
  await triggerAction({ type: 'rest', method: 'PUT', url: 'http://x', body: 'plain text, not json' }, { fetchImpl })
  assert.equal(capturedInit.headers['Content-Type'], 'text/plain')
})

test('rest action with no body sends no Content-Type header', async () => {
  let capturedInit
  const fetchImpl = async (url, init) => { capturedInit = init; return { ok: true, status: 200, statusText: 'OK' } }
  await triggerAction({ type: 'rest', method: 'PUT', url: 'http://x', body: null }, { fetchImpl })
  assert.deepEqual(capturedInit.headers, {})
  assert.equal(capturedInit.body, undefined)
})

test('rest action propagates a fetch/network failure as a rejection', async () => {
  const fetchImpl = async () => { throw new Error('connect ECONNREFUSED') }
  await assert.rejects(
    () => triggerAction({ type: 'rest', method: 'PUT', url: 'http://x', body: null }, { fetchImpl }),
    /ECONNREFUSED/
  )
})
