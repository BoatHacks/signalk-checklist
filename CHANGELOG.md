# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] - 2026-07-25

### Added

- Per-item notes/values: any item can optionally carry a value field (chosen
  per item in edit mode — free text or a number), recorded while running the
  list (e.g. a fuel reading or a quick note), separate from its checked
  state.
- Markdown export, both for the live state of a list (manual "Export
  Markdown" button) and for a specific historical run.
- Run history: a completed run (every item checked) is automatically
  archived as an append-only snapshot per list — visible from a new
  "History" view with per-run Markdown export. Archiving triggers only on
  the incomplete-to-complete transition, so re-checking an already-complete
  list doesn't create duplicate archive entries. Resetting a list clears
  checked state and any recorded values, ready for the next run.
- Per-list retention for completed runs (set in edit mode, in days; blank
  means keep forever). Old runs are pruned automatically — right after a
  new run is archived, whenever a list's history is viewed, and on plugin
  startup — so retention takes effect without a background scheduler.
- Light/dark theme, matching signalk-dead-mans-switch's convention: a
  manual toggle (remembered per browser, falling back to the OS's
  prefers-color-scheme), plus an optional "Automatically switch theme"
  plugin setting that instead follows the boat's sun position
  (`vessels.self.environment.sun`, falling back to `environment.mode`) —
  the manual toggle is hidden while that's on, same as dead-mans-switch.

## [0.1.0] - 2026-07-24

### Added

- Initial release: SignalK plugin + webapp for generic, user-defined
  checklists.
- Multiple named checklists, each with ordered items and optional section
  headers for grouping.
- Touch-first run mode: tap to check items off (dimmed in place, no
  strikethrough, for readability when scanning back through a list),
  progress counter, manual reset button.
- Full list editing (create/rename/reorder/delete lists and items) directly
  in the webapp.
- Live sync across every open device/tab via SignalK's own delta/WebSocket
  stream (`checklists.<id>.state`), always on.
- Optional plugin setting to also publish checklist summaries
  (`checklists.<id>.checkedCount` / `.totalCount` / `.complete`) onto the
  wider SignalK data tree.
- Import/export individual checklists as JSON files.
- Example checklist ("Familiarizing yourself with the checklist plugin")
  seeded automatically on a fresh install, walking through the app's own
  features.
- Frontend built with vendored Preact + htm (no CDN, no build step).
- App icon and `signalk.displayName`/`signalk.appIcon` metadata.
