# Compatibility and limitations

This matrix covers the desktop targets for the coordinated `1.0.0`
distribution. Install matching editor packages from the same manifest. The
native, vanilla and Angular quickstarts and the extension tutorial use
`1.0.0` artifacts. The historical [vanilla playground](../examples/vanilla-alpha/README.md)
uses `0.1.0-alpha.1`. The archived Angular quickstart uses `0.0.0`
bootstrap artifacts. [Package map](../package-map.json),
[release manifests and acceptance records](https://github.com/artemklen/klenwriter-editor/releases)

| Environment | v1 tier | Release qualification |
| --- | --- | --- |
| Desktop Chrome stable on macOS | Supported | Chrome 158.0.8127.88 on macOS 27.0.1. Installed-browser editing, RU/EN input and ordinary dead keys, keyboard, focus and semantics. |
| Desktop Chrome stable on Windows 11 | Supported | Chrome 158.0.8127.89 on Windows 11 Pro 26H2. The same installed-browser scope on Windows. |
| Desktop Safari stable on macOS | Supported | Safari 27.0.1 on macOS 27.0.1. The same installed-browser scope on Safari. |
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
