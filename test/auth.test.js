const test = require('node:test')
const assert = require('node:assert/strict')
const { requireAuth } = require('../lib/auth')

function fakeReqRes (method, skIsAuthenticated, skPrincipal) {
  const req = { method, skIsAuthenticated, skPrincipal }
  const res = {
    statusCode: null,
    body: null,
    status (code) { this.statusCode = code; return this },
    json (body) { this.body = body; return this }
  }
  return { req, res }
}

test('passes through untouched when no security strategy is configured (skIsAuthenticated undefined)', () => {
  const { req, res } = fakeReqRes('GET', undefined, undefined)
  let called = false
  requireAuth(req, res, () => { called = true })
  assert.equal(called, true)
  assert.equal(res.statusCode, null)
})

test('rejects with 401 when a strategy is configured but the request is not authenticated', () => {
  const { req, res } = fakeReqRes('GET', false, undefined)
  let called = false
  requireAuth(req, res, () => { called = true })
  assert.equal(called, false)
  assert.equal(res.statusCode, 401)
  assert.match(res.body.error, /authentication required/)
})

test('allows an authenticated readonly principal to make a GET request', () => {
  const { req, res } = fakeReqRes('GET', true, { identifier: 'x', permissions: 'readonly' })
  let called = false
  requireAuth(req, res, () => { called = true })
  assert.equal(called, true)
  assert.equal(res.statusCode, null)
})

for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
  test(`rejects a readonly principal's ${method} with 403`, () => {
    const { req, res } = fakeReqRes(method, true, { identifier: 'x', permissions: 'readonly' })
    let called = false
    requireAuth(req, res, () => { called = true })
    assert.equal(called, false)
    assert.equal(res.statusCode, 403)
    assert.match(res.body.error, /read-only/)
  })
}

for (const permissions of ['readwrite', 'admin']) {
  test(`allows a ${permissions} principal to make a POST request`, () => {
    const { req, res } = fakeReqRes('POST', true, { identifier: 'x', permissions })
    let called = false
    requireAuth(req, res, () => { called = true })
    assert.equal(called, true)
    assert.equal(res.statusCode, null)
  })
}

test('treats a missing principal on an authenticated request as not readonly (allows the write)', () => {
  // Shouldn't normally happen upstream, but don't crash if it does.
  const { req, res } = fakeReqRes('POST', true, undefined)
  let called = false
  requireAuth(req, res, () => { called = true })
  assert.equal(called, true)
})
