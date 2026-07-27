const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

/**
 * Gates every route on this router behind SignalK's own authentication.
 *
 * Belt-and-suspenders, not the primary gate: signalk-server itself already
 * registers `app.use('/plugins', adminAuthenticationMiddleware(false))`
 * during its own bootstrap (in serverroutes.js, wired up in the Server
 * constructor before any plugin is loaded) — so whenever a real security
 * strategy is configured, every request under `/plugins/*` (this plugin's
 * routes included) already has to be a fully-authenticated admin before it
 * ever reaches us. This middleware exists for two reasons anyway: (1) it's
 * the only thing separating a 'readonly' principal's GETs from writes at
 * *our* granularity, since the server's own gate is all-or-nothing per
 * request rather than per-method; (2) defense-in-depth in case that global
 * behavior ever changes in a future server version.
 *
 * The server's global middleware populates `req.skIsAuthenticated` and
 * `req.skPrincipal` (an object like
 * `{ identifier, permissions: 'readonly' | 'readwrite' | 'admin' }`) before
 * our own router ever runs — we just read what it already found:
 *
 * - `req.skIsAuthenticated === undefined` means no security strategy is
 *   configured on this server at all (the framework's own middleware never
 *   ran), so there's nothing to enforce — behave like the rest of an
 *   unsecured server and let the request through.
 * - `false` means a strategy is configured and this specific request
 *   didn't authenticate (no/invalid/expired token) — reject with 401.
 * - `true` with `permissions: 'readonly'` is allowed to read
 *   (GET/HEAD) but not to change anything — reject writes with 403.
 */
function requireAuth (req, res, next) {
  if (req.skIsAuthenticated === undefined) return next()
  if (!req.skIsAuthenticated) return res.status(401).json({ error: 'authentication required' })
  const isWrite = WRITE_METHODS.has(req.method)
  if (isWrite && req.skPrincipal && req.skPrincipal.permissions === 'readonly') {
    return res.status(403).json({ error: 'read-only access — write permission required' })
  }
  next()
}

module.exports = { requireAuth }
