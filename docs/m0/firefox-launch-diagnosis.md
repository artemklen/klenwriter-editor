# Native browser diagnostics for OSR-58

Investigation: 2026-10-16–17, Europe/Moscow. Starting repository revision: `4371dd96cea8a854450714140def982506378711`. This note records environment diagnosis and source inspection; the architecture decision remains in ADR-001.

## Firefox: profile creation was denied by macOS App Data protection

The first native attempt used Playwright's Firefox 157.0 build 1555 at:

`/Users/klen/Library/Caches/ms-playwright/firefox-1555/firefox/Nightly.app`

The profile wizard reported `NS_ERROR_FILE_ACCESS_DENIED`; later accessibility calls timed out. The relevant local facts are:

| Check | Observed result |
| --- | --- |
| System | macOS 27.0.1, build 26A434, arm64 |
| Bundle identity | `org.mozilla.nightlyunofficial`; Firefox 157.0; BuildID `20261002115412` |
| Code signature | `Signature=adhoc`, `TeamIdentifier=not set`, `Sealed Resources=none` |
| Firefox data directories | `~/Library/Application Support/Firefox` and its `Profiles` directory were owned by `klen`, mode `0700` |
| Ancestor ACLs | No ACL denying writes was present; the inherited-looking `everyone deny delete` entries on ancestors protect directory deletion, not profile creation |
| Existing profile registry | No files were listed under the Firefox data directory during diagnosis |

The system log supplies the distinguishing evidence. Times below are local Europe/Moscow:

```text
2026-10-16 23:16:38.282 sandboxd: TCC denied kTCCServiceSystemPolicyAppDataDetailed for org.mozilla.firefox
2026-10-16 23:28:29.846 sandboxd: TCC denied kTCCServiceSystemPolicyAppDataDetailed for org.mozilla.firefox
2026-10-16 23:30:47.133 sandboxd: TCC denied kTCCServiceSystemPolicyAppDataDetailed for org.mozilla.firefox
```

The checks immediately preceding these denials requested App Data access for `org.mozilla.firefox`. The running app identity at the second launch was `org.mozilla.nightlyunofficial`. Ordinary owner write permission therefore did not establish permission for that application to access Firefox's protected data.

Mozilla documents the same macOS 27 restriction in [bug 2069536](https://bugzilla.mozilla.org/show_bug.cgi?id=2069536): builds without Mozilla's signature cannot access the Firefox application-data directory by default. Launching a signed browser by its bare executable can also attribute access to the launching terminal. The report records a startup fix for Firefox 158. This explains the environment failure; it is not evidence of an editor defect or a reason, by itself, to drop Firefox support.

### Resolution and independent read-back

The primary agent installed the official Firefox 158.0 in the dedicated location below and launched it through the native application API. No TCC grant, ACL change, `chmod`, or application-data relocation was used for this resolution.

`/Users/klen/Applications/OSR-58/Firefox.app`

Independent read-only checks of that installed bundle returned:

```text
Identifier=org.mozilla.firefox
Authority=Developer ID Application: Mozilla Corporation (43AQ936H96)
TeamIdentifier=43AQ936H96
Notarization Ticket=stapled
CFBundleShortVersionString=158.0
```

The downloaded `/tmp/osr58-firefox-158.dmg` had SHA-256:

```text
dfe8508ee8880cec1578253eb02b9154b5971a55e832d97396f463cd07b5ef67
```

[Mozilla's version feed](https://product-details.mozilla.org/1.0/firefox_versions.json) reported 158.0 as the current release, released 2026-10-13. The [official macOS/en-US download](https://www.mozilla.org/en-US/firefox/all/desktop-release/osx/en-US/) resolved to `https://download-installer.cdn.mozilla.net/pub/firefox/releases/158.0/mac/en-US/Firefox%20158.0.dmg`. [Mozilla's installation instructions](https://support.mozilla.org/en-US/kb/how-download-and-install-firefox-mac) describe normal app installation and launch.

The primary agent observed the working native browser. Independently inspected exports in Downloads identify Firefox 158.0, carry the served source fingerprint, and contain native-session composition traces:

| Mode | Export filenames | Distinct `startedAt` values, UTC |
| --- | --- | --- |
| Single | `osr-58-single-1792183787499.json`, `osr-58-single-1792183824535.json`, `osr-58-single-1792183827129.json` | `2026-10-16T20:49:30.244Z`, `20:50:23.047Z`, `20:50:25.307Z` |
| Islands | `osr-58-islands-1792184053771.json`, `osr-58-islands-1792184056641.json`, `osr-58-islands-1792184059249.json` | `2026-10-16T20:54:11.760Z`, `20:54:14.631Z`, `20:54:17.346Z` |

The three single traces each contain 90 events and the three islands traces each contain 89. Their session starts and event-relative times differ, and each starts from the original sample text before recording the edits. Matching event counts/composition sequences alone must not be mistaken for duplicate exports. Native acceptance and final evidence selection are recorded separately by the primary agent.

Read-only commands sufficient to reproduce the key checks:

```sh
codesign -dv --verbose=4 /Users/klen/Library/Caches/ms-playwright/firefox-1555/firefox/Nightly.app
ls -ldeO@ '/Users/klen/Library/Application Support/Firefox' '/Users/klen/Library/Application Support/Firefox/Profiles'
/usr/bin/log show --start '2026-10-16 23:09:00' --end '2026-10-16 23:33:00' --style compact --predicate 'process == "sandboxd" AND eventMessage CONTAINS[c] "org.mozilla.firefox"'
codesign -dv --verbose=4 /Users/klen/Applications/OSR-58/Firefox.app
plutil -extract CFBundleShortVersionString raw /Users/klen/Applications/OSR-58/Firefox.app/Contents/Info.plist
```

## Chrome 155: why native composition can end with `isTrusted=false`

The local native traces recorded trusted `compositionstart`/`compositionupdate` events but an untrusted `compositionend`. Source inspection used the **exact Chromium tag `155.0.8059.85`**, which [resolves to commit `0e66b94549a8bd85f03fbdf189b752d6e7b63c32`](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.85), rather than current `main`.

The inspected path is consistent with the observed trust difference:

1. [`DispatchCompositionEndEvent`, lines 396–409](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/renderer/core/editing/ime/input_method_controller.cc#396) creates a `CompositionEvent` and sends it through `EventDispatcher::DispatchScopedEvent`. Start and update instead call the target's `DispatchEvent` at lines 1004 and 393.
2. The [`CompositionEvent` constructor](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/renderer/core/events/composition_event.cc#37) delegates through [`UIEvent`](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/renderer/core/events/ui_event.cc#32) to [`Event`, whose constructor initializes `is_trusted_` to false at line 92](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/renderer/core/dom/events/event.cc#78).
3. [`DispatchScopedEvent`, lines 88–93](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/renderer/core/dom/events/event_dispatcher.cc#88), sets the target and queues the event. [`ScopedEventQueue`, lines 60–78](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/renderer/core/dom/events/scoped_event_queue.cc#60), ultimately calls `EventDispatcher::DispatchEvent`; this path does not promote the trust bit.
4. In contrast, [`EventTarget::DispatchEvent`, lines 865–869](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/renderer/core/dom/events/event_target.cc#865), explicitly sets trust to true before dispatch. That accounts for the source-level difference between the start/update and end paths.

This is **source-level corroboration, not runtime debugging of the installed Chrome binary**. No debugger stack or instrumented Chrome build established that a particular recorded event traversed this path. Source inspection therefore removes the assumption that `isTrusted=false` necessarily means the recorder or page synthesized the event, but does not alone prove provenance, event order, exactly-once reconciliation, or behavior in other Chrome versions. Keep the raw trust value and native-input provenance in the evidence; do not relabel the event as trusted.
