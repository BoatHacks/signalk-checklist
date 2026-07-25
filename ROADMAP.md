# Roadmap

Planned future work that's been discussed but isn't scheduled for the
current round of development. This isn't a commitment or a timeline —
just a place to remember ideas so they don't get lost.

## Deferred from v1

These were explicitly discussed during initial design and deliberately
left out of v1 to keep the first release simple and shippable.

- **Voice input/output.** Say "done" (or an item's name) to check it off
  hands-free, and have the plugin read items back — useful for
  greasy-hands situations like engine checks. Ties into the existing
  voice-alert plugin work ([[signalk-imo-alerts]]). Bigger lift (needs
  in-browser speech recognition), so deferred until a specific list (e.g.
  an engine-room checklist) makes the case for it.

- **Per-item notes/values.** Items are checkbox-only today (label +
  checked). A natural next step is an optional value field per item —
  e.g. a free-text note or a numeric reading (fuel level, engine hours) —
  without forcing every checklist into that shape.

- **Locking/conflict protection for structure edits.** Editing a list's
  structure is currently last-write-wins with no locking, since it's a
  boat-crew checklist app, not a shared doc editor. If concurrent editing
  turns out to actually cause real conflicts in practice, revisit with
  either a simple "someone else is editing this list" indicator or a
  lightweight lock.

## Other ideas

- **npm publishing.** No `publish-npm.yml` exists yet for this plugin
  (unlike [[signalk-stowage-mgmt]]). Worth setting up once the plugin is
  ready to be installed via the SignalK App Store rather than only from
  GitHub.
