@no-slop.md

# signalk-checklist

SignalK webapp plugin for generic, user-defined checklists (not limited to one
use case like pre-departure). Repo: BoatHacks/signalk-checklist.

## v1 design
- Multiple named lists side by side, each with ordered items (label + checked
  state only, no per-item notes/values yet).
- Manual "Reset" button per list — no automatic reset on open.
- Persistence via the plugin's own backend (REST API/storage), not
  browser localStorage.
- SignalK delta-publishing of checklist status is optional, toggleable in
  plugin config — not mandatory.
- Interaction: tap to check off; drag-to-reorder only in edit mode (not while
  working through a list); progress shown as e.g. "7/12". Voice input/output is
  an interesting future idea, deliberately not in v1.
- Live sync between devices/webapp clients is always on (not optional),
  independent of the optional delta-publishing — it rides on SignalK's own
  delta/WebSocket stream, no separate mechanism.
- List structure editing (add/remove/reorder lists and items) happens entirely
  in the webapp, not via the plugin config schema in the SignalK admin UI;
  plugin config only holds simple settings like the delta-publishing toggle.
- Concurrent edits to the same list structure: last-write-wins, no locking
  in v1.
- Checked-off items stay in their original position and are just dimmed (not
  struck through) — easier to re-scan whether a step is already done.
- One shared run-state per list — no parallel independent runs of the same
  list.
- Lists support section dividers/sub-headers for grouping items, already in v1.
- Storage: one JSON file per list (not one big file, not SQLite). Edit mode
  has upload/download for lists.

## v2 (in progress)
- Per-item notes/values — type (free text or numeric) chosen per item at edit
  time, not globally for the whole list.
- Export/archive a completed list to Markdown, both automatically at 100% and
  via a manual export button.
- Append-only history of completed runs per list (record-keeping over time,
  not overwriting the current run).
