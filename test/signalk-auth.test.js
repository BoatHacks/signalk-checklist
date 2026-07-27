const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { getSignalKToken, isSecurityEnabled } = require('../lib/signalk-auth')

function tempDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-checklist-auth-'))
}

function appWithSecurity (enabled) {
  return { securityStrategy: { isDummy: () => !enabled }, config: { settings: { port: 3000 } } }
}

function jsonResponse (body) {
  return { json: async () => body }
}

test('isSecurityEnabled() reflects securityStrategy.isDummy()', () => {
  assert.equal(isSecurityEnabled(appWithSecurity(true)), true)
  assert.equal(isSecurityEnabled(appWithSecurity(false)), false)
  assert.equal(isSecurityEnabled({}), false)
})

test('returns null immediately when security is disabled, without making any request', async () => {
  let called = false
  const fetchImpl = async () => { called = true; return jsonResponse({}) }
  const token = await getSignalKToken(appWithSecurity(false), tempDir(), fetchImpl)
  assert.equal(token, null)
  assert.equal(called, false)
})

test('kicks off a new access request on first call, and persists the requestId', async () => {
  const dir = tempDir()
  let capturedUrl, capturedBody
  const fetchImpl = async (url, init) => {
    capturedUrl = url
    capturedBody = JSON.parse(init.body)
    return jsonResponse({ requestId: 'req-123', state: 'PENDING', href: '/signalk/v1/requests/req-123' })
  }
  const token = await getSignalKToken(appWithSecurity(true), dir, fetchImpl)
  assert.equal(token, null) // still pending — no token yet
  assert.match(capturedUrl, /\/signalk\/v1\/access\/requests$/)
  assert.equal(capturedBody.description, 'signalk-checklist item actions')
  assert.ok(capturedBody.clientId)

  const state = JSON.parse(fs.readFileSync(path.join(dir, 'signalk-auth.json'), 'utf8'))
  assert.equal(state.requestId, 'req-123')
  assert.ok(state.clientId)
})

test('polls an existing pending request rather than creating a new one', async () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'signalk-auth.json'), JSON.stringify({ clientId: 'abc', requestId: 'req-123' }))
  let capturedUrl
  const fetchImpl = async (url) => {
    capturedUrl = url
    return jsonResponse({ state: 'PENDING', requestId: 'req-123' })
  }
  const token = await getSignalKToken(appWithSecurity(true), dir, fetchImpl)
  assert.equal(token, null)
  assert.match(capturedUrl, /\/signalk\/v1\/requests\/req-123$/)
})

test('stores and returns the token once the request is approved', async () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'signalk-auth.json'), JSON.stringify({ clientId: 'abc', requestId: 'req-123' }))
  const fetchImpl = async () => jsonResponse({
    state: 'COMPLETED',
    requestId: 'req-123',
    accessRequest: { permission: 'APPROVED', token: 'jwt-token-value' }
  })
  const token = await getSignalKToken(appWithSecurity(true), dir, fetchImpl)
  assert.equal(token, 'jwt-token-value')

  const state = JSON.parse(fs.readFileSync(path.join(dir, 'signalk-auth.json'), 'utf8'))
  assert.equal(state.token, 'jwt-token-value')
})

test('a stored token is reused without any network call', async () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'signalk-auth.json'), JSON.stringify({ clientId: 'abc', token: 'already-have-one' }))
  let called = false
  const fetchImpl = async () => { called = true; return jsonResponse({}) }
  const token = await getSignalKToken(appWithSecurity(true), dir, fetchImpl)
  assert.equal(token, 'already-have-one')
  assert.equal(called, false)
})

test('a denied request stops polling and returns null on subsequent calls', async () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'signalk-auth.json'), JSON.stringify({ clientId: 'abc', requestId: 'req-123' }))
  const fetchImpl = async () => jsonResponse({
    state: 'COMPLETED',
    requestId: 'req-123',
    accessRequest: { permission: 'DENIED' }
  })
  const first = await getSignalKToken(appWithSecurity(true), dir, fetchImpl)
  assert.equal(first, null)

  let calledAgain = false
  const secondFetch = async () => { calledAgain = true; return jsonResponse({}) }
  const second = await getSignalKToken(appWithSecurity(true), dir, secondFetch)
  assert.equal(second, null)
  assert.equal(calledAgain, false) // denied is sticky — no more polling
})

test('a network failure while requesting access is swallowed, returning null', async () => {
  const dir = tempDir()
  const fetchImpl = async () => { throw new Error('ECONNREFUSED') }
  const token = await getSignalKToken(appWithSecurity(true), dir, fetchImpl)
  assert.equal(token, null)
})
