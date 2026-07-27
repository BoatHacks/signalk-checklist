# Handover: signalk-checklist

This document exists so work on this plugin can continue seamlessly in a
different environment (e.g. a Claude Code session working directly on a
clone of this repo) without losing context from the chat session where it
was designed and built. It captures the "why," not just the "what" — most
of it wouldn't be recoverable from the code or CHANGELOG alone.

Current state: **v0.2.0 released**, tagged, GitHub release published, CI
green. Not yet published to npm (see "Not yet done" below).

## What this is

A SignalK server plugin + webapp for generic, user-defined checklists —
explicitly *not* scoped to one use case (like pre-departure checks). Users
define their own named lists with their own items. Built for Tobias
Rosenstock (GitHub: `humppafreak`) under the `BoatHacks` GitHub org,
following conventions established across his other SignalK plugins
(`signalk-stowage-mgmt`, `signalk-dead-mans-switch`, `signalk-ships-bells`,
`signalk-imo-alerts`, `signalk-notification-dispatcher`, etc.).

Repo: `https://github.com/BoatHacks/signalk-checklist` (branch: `main`).

## Architecture

- **`index.js`** — plugin entry point. Exposes a REST API and, critically,
  implements `plugin.registerWithRouter(router)` — see "Gotchas" below,
  this is the single easiest thing to get backwards.
- **`lib/store.js`** — `ChecklistStore`: one JSON file per list under the
  plugin's data dir, atomic writes (temp file + rename). Owns the list
  schema, structure validation/normalization, and `isComplete()`.
- **`lib/run-history.js`** — `RunHistoryStore`: append-only archive of
  completed runs, one JSON file per run under `runs/<listId>/`. Owns
  retention pruning.
- **`lib/theme.js`** — `computeThemeRecommendation()`: sun-position-based
  light/dark recommendation, ported from `signalk-dead-mans-switch`'s
  identical logic.
- **`lib/delta.js`** — builds the two SignalK delta payloads (always-on
  internal sync vs. optional wider-publish summary).
- **`lib/markdown.js`** — renders a list or a historical run to Markdown.
- **`lib/example-checklist.js`** — the "Familiarizing yourself..." seed
  content used on a fresh install.
- **`lib/atomic-write.js`** — shared `atomicWriteJSON()` used by both
  stores.
- **`public/`** — the webapp. Preact + htm, vendored as ES modules under
  `public/vendor/` (see `public/vendor/VERSIONS.md` for how to refresh
  them) — **never loaded from a CDN**, per standing practice, because the
  boat's network (and the browser hitting it) may have no internet access.
  Single file: `public/app.js`. No build step, no bundler.
- **`test/`** — Node's built-in test runner (`node --test`), one file per
  `lib/` module. 43 tests as of v0.2.0, all passing.

## Data model

```
List {
  id: string              // slug, filename-safe
  name: string
  items: Item[]
  retentionDays: number | null   // null = keep completed-run history forever
  updatedAt: ISO string
}

Item {
  id: string
  type: 'item' | 'section'
  label: string
  // 'item' only:
  checked: boolean
  valueType: 'text' | 'number' | null   // chosen per item, in edit mode
  value: string | number | null          // run-state, like `checked`
  action: null | RestAction | DeltaAction  // optional trigger button, structure-level
}

RestAction {
  type: 'rest'
  method: 'PUT' | 'POST'
  url: string
  body: string | null      // sent as-is; Content-Type inferred (JSON if it parses, else text/plain)
}

DeltaAction {
  type: 'delta'
  path: string             // dotted SignalK path, e.g. electrical.switches.anchorLight.state
  value: any                // JSON-typed value to publish
}

Run (in runs/<listId>/<runId>.json) {
  id: string           // e.g. 20260725T133049-db0b19
  listId: string
  listName: string
  completedAt: ISO string
  items: Item[]         // full snapshot at completion
}
```

Key modeling decisions (from the original design conversation, not
re-derivable from the code):

- **One shared run-state per list.** No parallel independent runs of the
  same list — if two people open it, they see and edit the same live
  state. This was a deliberate simplicity choice, not an oversight.
- **Checked items never move or reorder** — they stay in place, dimmed
  (not struck through — strikethrough was tried and reverted; it hurt
  readability when scanning back to verify a step was done).
- **Structure edits are last-write-wins, no locking.** This is a boat-crew
  checklist app, not a shared doc editor; deliberately out of scope unless
  it turns out to cause real friction in practice.
- **List structure editing happens entirely in the webapp**, not through
  SignalK's admin plugin-config schema. Plugin config is only for simple
  toggles (`publishSummary`, `autoTheme`).
- **Per-item value type is chosen per item**, not globally per list — some
  items are plain checkboxes, others carry a text note or a number.
- **Storage is one JSON file per list** (not one big file, not SQLite) —
  matches the pattern across Tobi's other plugins. Same for run history:
  one file per run, not a single append-only log file, so no file-locking
  concerns and atomic writes stay trivially simple.
- **Live sync rides on SignalK's own delta/WebSocket stream** — no
  separate WebSocket server. The plugin always publishes
  `checklists.<id>.state` (full list document) regardless of the optional
  `publishSummary` setting; that path is what the webapp subscribes to.
  `publishSummary` additionally publishes lightweight numeric paths
  (`checklists.<id>.checkedCount` / `.totalCount` / `.complete`) for other
  plugins/automations — a genuinely separate concern from internal sync.
- **Run-history retention is per-list, not global**, set in edit mode in
  days (blank = forever). Pruning has no background scheduler — it runs
  right after a new run is archived, whenever a list's history is viewed,
  and once across all lists on plugin startup.
- **Theme follows `signalk-dead-mans-switch`'s exact convention**: manual
  toggle (localStorage, falling back to OS `prefers-color-scheme`), plus
  an optional `autoTheme` config setting that follows
  `vessels.self.environment.sun` (preferred) or `environment.mode`
  (fallback), polled via `GET /theme` every 60s (slow-changing, unlike
  dead-mans-switch's 1s status poll).
- **Per-item actions (REST call or SignalK delta) always run server-side**,
  never from the browser — this sidesteps CORS entirely for REST calls to
  boat-local devices (many don't send CORS headers) and is the only option
  for delta publishing anyway (only the plugin backend can call
  `app.handleMessage`). The trigger button is fully decoupled from checked
  state/value — clicking it never checks the item off. `lib/actions.js`
  takes an injectable `fetchImpl` specifically so this is unit-testable
  without a real network call.
- **Two distinct authentication concerns, solved two different ways.**
  (1) The webapp *as a client of this plugin's own API* — handled by a
  browser-side sign-in screen against SignalK's standard
  `/signalk/v1/auth/login`, matching cookie + explicit-bearer-token
  belt-and-suspenders approach (see `public/app.js` and the Gotchas
  section below for why signalk-server's own global gate makes the
  plugin's own `requireAuth` check technically redundant but still worth
  keeping). (2) An item's REST action calling back into *this same
  server's own* `/signalk/v1/` API — handled entirely differently, via
  `lib/signalk-auth.js`'s device access request flow (no browser
  involved at all; the plugin backend requests its own access, a human
  approves it once in Security → Access Requests, and the resulting
  token is persisted and reused). Don't conflate these two — they solve
  different problems for different actors (a human in a browser vs. the
  plugin acting as its own automated client).

## API surface (mounted at `/plugins/signalk-checklist`)

```
GET    /lists
POST   /lists                              { name }
GET    /lists/:id
PUT    /lists/:id                          { name, items, retentionDays }
DELETE /lists/:id
POST   /lists/:id/reset
POST   /lists/:id/items/:itemId/check      { checked }
POST   /lists/:id/items/:itemId/value      { value }
POST   /lists/:id/items/:itemId/trigger    (fires the item's configured action, if any)
GET    /lists/:id/export                   (JSON download)
GET    /lists/:id/export/markdown
POST   /lists/import                       (full list document)
GET    /lists/:id/runs
GET    /lists/:id/runs/:runId
GET    /lists/:id/runs/:runId/export/markdown
GET    /theme                              -> { autoTheme, recommendation }
```

All of the above require an authenticated admin-level session whenever the
SignalK server has security enabled (enforced by the server itself, not
optional per-plugin — see Gotcha #7 below). With no security configured
(the common case for Tobi's boat), nothing changes; every route behaves
exactly as it did before this feature existed.

Webapp static files are served separately at `/signalk-checklist/`
(derived from the package name / `signalk.displayName`), per SignalK's
standard webapp-serving convention — this is a fixed path, unrelated to
where the REST API is mounted.

## Gotchas discovered the hard way

These cost real debugging time in the original session — worth reading
before touching `index.js` or `public/app.js`.

1. **`plugin.registerWithRouter` is inverted from what you'd guess.** The
   server creates its own router (mounted at `/plugins/<id>`) and calls
   `plugin.registerWithRouter(router)`, expecting the plugin to attach
   routes to *that* router. It is **not** `app.registerWithRouter(router)`
   called by the plugin — that method doesn't exist and silently throws
   inside `plugin.start()`, which manifests as every API call 404ing.
   Confirmed by reading `signalk-server`'s own
   `dist/interfaces/plugins.js`.

2. **`plugin.registerWithRouter` runs *after* `plugin.start()`.** So
   anything the router handlers close over (the store, `currentOptions`)
   must be set up in `start()` first — don't assume registration order.

3. **Preact's `render()` doesn't clear pre-existing DOM content** in its
   target container — it only diffs against nodes it created itself.
   `public/index.html`'s `#app` div starts with a static `Loading…`
   fallback text node; mounting the app left that node sitting in the DOM
   *alongside* the rendered UI instead of replacing it. Fix: clear the
   container (`appContainer.textContent = ''`) immediately before the
   initial `render()` call.

4. **The SignalK server pre-creates the plugin's data directory** before
   the plugin's own `init()` even runs (via `app.getDataDirPath()`
   internally calling `ensureExists()`). This means "does the data dir
   already exist" is **not** a valid signal for "is this a fresh
   install" — it's always true. Fresh-install detection instead uses a
   `.seeded` marker file written the first time the example checklist is
   seeded (see `ChecklistStore.needsSeeding()`).

5. **`npm install <new-pkg>` without `--save` will prune** any
   previously-installed-but-unlisted packages from `node_modules` — this
   bit the local dev/testing setup a couple of times when `preact`/`htm`
   were installed with `--no-save` (they're only used to seed
   `public/vendor/`, never as a real runtime dependency) and then vanished
   after installing something else. Not a production issue, just a local
   dev-loop trap.

6. **`gh auth login` device-flow processes get killed** when backgrounded
   naively across separate tool-call boundaries in a sandboxed shell.
   Needed `setsid nohup ... &` (fully detached, new session) to survive.
   Also: pushing changes to `.github/workflows/*.yml` requires the
   `workflow` OAuth scope, which the default device-flow login doesn't
   grant — needs `gh auth refresh -h github.com -s workflow` (same
   device-flow dance again) before that push will succeed.

7. **signalk-server already gates all of `/plugins/*` behind full admin
   auth on its own**, whenever a real security strategy is configured —
   confirmed by reading the actual installed server's source
   (`dist/serverroutes.js`: `app.use('/plugins', adminAuthenticationMiddleware(false))`,
   registered during `startSecurity()` in the `Server` constructor, well
   before any plugin is loaded — so it always runs first for any request
   under `/plugins/signalk-checklist/*`). This means `lib/auth.js`'s own
   `requireAuth` check is **not** the primary thing standing between an
   unauthenticated request and this plugin's data when security is
   on — it's kept anyway as defense-in-depth and for the readonly/write
   distinction at finer granularity than the server's all-or-nothing
   admin gate. Don't assume a plugin has to implement its own protection
   from scratch to be secure; check what the server already does first.

8. **Testing token security locally needs a real `security.json` on
   disk, not just the `ADMINUSER` env var.** `ADMINUSER=user:pass` is
   enough to log in, but at least one server route (approving a device
   access request) calls `getSecurityConfig(app, forceRead=true)`, which
   reads `security.json` fresh from disk rather than the in-memory config
   the `ADMINUSER` bootstrap built — and a missing file there means a
   missing `secretKey`, which crashes with `secretOrPrivateKey must have
   a value` when it tries to sign an approval token. Fix: write a real
   `security.json` by hand (bcrypt-hash a password with the `bcryptjs`
   package already in `signalk-server`'s own `node_modules`, generate a
   `secretKey`, list one admin user) rather than relying on `ADMINUSER`
   alone for anything beyond a basic login smoke test.

9. **The device-access-request approval endpoint's parameter names are
   easy to get wrong.** `PUT /skServer/security/access/requests/:identifier/:status`
   — `:identifier` is the request's `accessIdentifier` field from the
   pending-requests list (which is actually the *client's* `clientId`,
   not the `requestId` you might reach for first), and `:status` must be
   lowercase (`approved`, not `APPROVED`) — the handler does a literal
   `status === 'approved'` string check.

## Local development & testing setup

There is no npm-published version and no CI step that runs against a real
SignalK server — `plugin-ci.yml` just runs the unit test suite. Real
end-to-end verification (routes actually mounting, deltas actually
broadcasting, static files actually serving at the right path) requires
spinning up an actual `signalk-server` locally. This is how it was done
during development, and is worth repeating for any nontrivial change to
`index.js`:

```sh
# One-time setup, in a scratch dir:
mkdir sk-test-server && cd sk-test-server
npm init -y && npm install signalk-server

mkdir -p ../sk-home/node_modules
ln -s /path/to/signalk-checklist ../sk-home/node_modules/signalk-checklist
cat > ../sk-home/settings.json <<'EOF'
{ "port": 3300, "interfaces": {}, "pipedProviders": [] }
EOF
mkdir -p ../sk-home/plugin-config-data
cat > ../sk-home/plugin-config-data/signalk-checklist.json <<'EOF'
{ "enabled": true, "enableDebug": true, "configuration": { "publishSummary": false, "autoTheme": false } }
EOF

# Every run:
SIGNALK_NODE_CONFIG_DIR=/path/to/sk-home \
  node sk-test-server/node_modules/.bin/signalk-server
# -> curl http://localhost:3300/plugins/signalk-checklist/lists
# -> webapp at http://localhost:3300/signalk-checklist/
```

Notes:
- The config directory env var is `SIGNALK_NODE_CONFIG_DIR` (there's also
  an apparent-typo `SIGNALK_NODE_CONDFIG_DIR` alias in the server source —
  don't rely on it, use the correctly-spelled one).
- Plugin config changes require a server restart to take effect (no live
  reload in this setup).
- To test a fresh install (seeding, `needsSeeding()`), delete
  `plugin-config-data/signalk-checklist/` entirely between runs.
- To test retention pruning without waiting real days, backdate a run
  file's `completedAt` directly on disk and hit `GET /lists/:id/runs`.
- For frontend-only checks (e.g. "does this Preact/htm snippet actually
  render the way I think"), `jsdom` + the real vendored
  `public/vendor/*.mjs` files works well as a fast headless sanity check
  without needing the full server — see git history around the
  "Loading…" bugfix commit for an example.
- To test with SignalK security actually enabled, write a real
  `security.json` into the config dir rather than relying on `ADMINUSER`
  alone (see Gotcha #8) — e.g.:
  ```sh
  node -e "
  const bcrypt = require('./sk-test-server/node_modules/bcryptjs');
  const crypto = require('crypto');
  console.log(JSON.stringify({
    allow_readonly: false, expiration: '1h',
    secretKey: crypto.randomBytes(64).toString('hex'),
    users: [{ username: 'testadmin', type: 'admin',
      password: bcrypt.hashSync('testpass123', bcrypt.genSaltSync(10)) }],
    devices: [], acls: [],
    allowNewUserRegistration: false, allowDeviceAccessRequests: true
  }, null, 2))" > /path/to/sk-home/security.json
  ```
  Also add `"security": { "strategy": "./tokensecurity" }` under a
  `security` key in `settings.json` (or set `SECURITYSTRATEGY=@signalk/sk-simple-token-security`
  as an env var instead). Then: `POST /signalk/v1/auth/login` with
  `{username, password}` to get a token; list pending device access
  requests with `GET /skServer/security/access/requests` (as an
  authenticated admin) and approve one with `PUT
  /skServer/security/access/requests/:clientId/approved` (see Gotcha #9
  for the parameter footguns there).

## Release process

Matches the convention from `signalk-stowage-mgmt`, minus the npm-publish
step (not set up here — see below):

1. Make sure `CHANGELOG.md`'s `[Unreleased]` section is accurate and
   complete.
2. `npm version <patch|minor|major> --no-git-tag-version` (updates
   `package.json` + `package-lock.json` without an automatic commit/tag).
3. Convert `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`.
4. Commit as `"Bump version to X.Y.Z; update CHANGELOG"`.
5. `git tag -a vX.Y.Z -m vX.Y.Z`, push both the commit and the tag.
6. `gh release create vX.Y.Z --title vX.Y.Z --notes "..."`.
7. Confirm CI (`gh run list`) is green on the release commit before
   considering it done.

Version bumps and cutting the actual release are meant to stay separate,
explicit steps — don't fold them into a feature commit. Also: don't cut a
release proactively on every push; only when explicitly asked, or when
publishing to npm.

## Not yet done / open threads

- **npm publishing.** No `publish-npm.yml` exists for this repo, unlike
  `signalk-stowage-mgmt`. Worth setting up once this plugin is meant to be
  installed via the SignalK App Store rather than only from GitHub. If you
  do this, note that `signalk-stowage-mgmt`'s npm OIDC trusted-publishing
  setup was never fully completed on the npmjs.com side either — that
  repo's publishes are still manual with an OTP. Don't assume trusted
  publishing "just works" without checking.
- **Voice input/output** — the one item left on `ROADMAP.md`. Deliberately
  deferred since v1; revisit if a specific list (e.g. an engine-room
  checklist) makes a concrete case for it. Ties into
  `signalk-imo-alerts`'s existing voice-alert work.
- **No `docs/screenshots/`** yet, unlike some of Tobi's other plugins.
  Worth adding to the README once the UI feels settled.
- Retention setting is only visible from the Edit and History views — not
  surfaced on the list overview or run screen. Minor, flagged but not
  acted on.
- History view only offers a Markdown download per run, no in-app detail
  view of a past run's values. Worth reconsidering if history ends up
  getting checked often.

## Standing conventions worth knowing (apply across Tobi's plugins, not just this one)

- Always vendor frontend JS dependencies locally; never load from a CDN —
  the SignalK server and the browser hitting it may have no internet
  access, only the local network between them is assumed stable.
- Always use the reusable `SignalK/signalk-server/.github/workflows/plugin-ci.yml@master`
  workflow for CI.
- Never run the test suite repeatedly after every small fix during routine
  coding — update tests as you go, run the suite before a release or when
  explicitly asked.
- Never use an em dash in anything written in Tobi's own voice (Discord
  messages, forum posts, etc.) — this restriction is about his personal
  writing, not code comments or documentation like this file.
- GitHub auth is via `gh` CLI device flow — Tobi approves in his own
  browser, credentials never pass through the assistant.
