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

## Shipped since v1

- **Per-item notes/values.** ~~Items are checkbox-only today~~ — done: any
  item can now optionally carry a free-text or numeric value field, chosen
  per item in edit mode.
- **Completed-run record-keeping.** Markdown export (manual, and for
  historical runs) plus an append-only per-list run history, auto-archived
  whenever a list is fully checked off.

## Other ideas

- **npm publishing.** No `publish-npm.yml` exists yet for this plugin
  (unlike [[signalk-stowage-mgmt]]). Worth setting up once the plugin is
  ready to be installed via the SignalK App Store rather than only from
  GitHub.
