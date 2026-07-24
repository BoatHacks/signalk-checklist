# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

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
