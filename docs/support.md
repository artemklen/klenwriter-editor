# Compatibility and limitations

This matrix covers the standalone preview documented by this checkout. Package
identities and the workspace version are in the [package map](../package-map.json).
The [vanilla local build](../examples/vanilla-alpha/README.md) uses the
`0.1.0-alpha.1` distribution. The Angular preview quickstart uses the
`0.0.0` bootstrap artifacts. The native quickstart and extension tutorial
use `1.0.0` workspace artifacts. The 1.0 release matrix will record the actual
OS and browser versions checked with its coordinated release artifacts.
Use the archive checksums from each quickstart to select its producer. Install
its editor packages together as one bundle.

| Environment | v1 tier | Acceptance scope |
| --- | --- | --- |
| Desktop Chrome stable on macOS and Windows 11 | Required | Installed-browser editing, RU/EN input and ordinary dead keys, keyboard, focus and semantics. |
| Desktop Safari stable on supported macOS | Required | The same installed-browser scope on Safari. |
| Desktop Firefox | Experimental | Three-engine observation includes Firefox. Supported status requires installed Firefox qualification on the production adapter. |
| Desktop Chrome on Linux | Experimental | A separate environment qualification is required for supported status. |
| Mobile editing, CJK input and real assistive technology | Deferred | Unicode document storage is available. Touch, CJK composition and real screen-reader acceptance are outside the v1 input and accessibility scope. |

The [desktop scope decision](m0/decision-register.md#compatibility-matrix)
records the target OS families and the historical measurements. The
[installed input protocol](m0/native-protocol.md) distinguishes a native
installed-browser run from the matching automated engine. Accessibility acceptance
includes keyboard, focus, semantics and axe. The
[accessibility guide](accessibility.md) describes the distinct real-AT evidence.

## Known browser behavior

- The early Firefox single-host trial stopped at the atomic card during a
  selection that should have reached a nested paragraph. This is an experimental
  compatibility gap to recheck on installed Firefox.
- A selection endpoint can reach its target while the caret stays outside the
  visible scroll area. The early Chromium edge-hold trial had a clipped caret,
  and the short installed Chrome and Safari drags reached the paragraph with
  the caret still below the viewport. The editor's
  [selection controller](selection.md) owns bounded edge autoscroll. Acceptance
  measures the endpoint and its visibility.
- The [single-host experiment](m0/editing-host-decision.md) records the original
  gestures and results. The [mounted corpus](mounted-corpus.md) covers the
  packaged adapter. Each result applies to its recorded build, gesture and
  environment.

## Local documents and network use

The standalone example loads its JS, CSS, WASM and public demo fixtures from the
serving origin. The import control reads local JSON and the export control
returns canonical JSON on the device. Save stores the sample document in this
browser's local storage for the current origin and selected profile. Clear
that site's storage to remove saved samples. The included media picker and
reference lookup use sample data.

An integrating application owns persistence, media, references, link dialogs,
identity and server policy. Review its host services and network requests
separately when handling private documents. The
[failure-state contract](failure-states.md) describes bounded admission,
typed refusals and recovery. Use [KWDJ v1](../contracts/kwdj/v1/README.md)
to identify the schema and validation rules for KWDJ JSON.

## Scope

Collaborative editing, a mobile authoring surface and integrated real
screen-reader acceptance are deferred. The editor provides public host
interfaces for application-specific persistence and recovery. See the
[roadmap](roadmap.md) for the planned release and the separate experimental
browser work.
