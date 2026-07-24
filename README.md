# signalk-checklist

A SignalK plugin + webapp for generic, user-defined checklists (pre-departure,
maintenance, docking procedures, or anything else you define yourself).

## Features

- Multiple named checklists, each with ordered items and optional section
  headers for grouping.
- Touch-friendly run mode: tap to check items off (they stay in place,
  dimmed/struck-through), progress counter, manual reset button.
- Full list editing (create/rename/reorder/delete lists and items) directly
  in the webapp — no need to touch the SignalK admin plugin config.
- Live sync across every open device/tab via SignalK's own delta/WebSocket
  stream — no separate sync server.
- Import/export individual checklists as JSON files.
- Optional plugin setting to also publish checklist summaries
  (checked/total counts, complete flag) onto the wider SignalK data tree for
  other plugins or automations to react to.

## Data model

Each checklist is stored as its own JSON file. A checklist has a name and an
ordered list of items, where each item is either:

- `{ type: 'item', label, checked }` — a checkable item
- `{ type: 'section', label }` — a section header/divider (not checkable)

## Storage & persistence

Lists are persisted server-side by the plugin (one JSON file per list, using
atomic write-then-rename), not in browser storage — so checklist state is
available from any device on the boat and survives a browser reset or a
SignalK restart.

## Live sync

The plugin always publishes the full state of a checklist under
`checklists.<id>.state` as a SignalK delta whenever it changes. The webapp
subscribes to this via SignalK's `/signalk/v1/stream` WebSocket, so every
open client sees changes immediately. This always happens, independent of
the optional "publish summary" plugin setting described below.

## Plugin configuration

- **Publish checklist summary** (off by default): when enabled, also
  publishes lightweight numeric paths per list —
  `checklists.<id>.checkedCount`, `checklists.<id>.totalCount`, and
  `checklists.<id>.complete` — so other plugins/automations can react to
  checklist progress without parsing the full state object.

## Development

```sh
npm install
npm test
```

The webapp (`public/`) uses [Preact](https://preactjs.com/) and
[htm](https://github.com/developit/htm) as vendored ES modules — see
`public/vendor/VERSIONS.md` for versions and how to refresh them. No CDN
dependency and no build step.
