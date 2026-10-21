# Installed clipboard coordinator

`acceptance.mjs` is a source-authored, closed installed-browser lane. Its presence
and a syntax check are not an executed acceptance result. Freeze and review the
coordinator, fixture, helper source and binary before running it.

Run it from the existing authorized **Terminal** context with Node **v24.22.0**,
the coherent packaged build, and the workspace fixture server already serving
`http://127.0.0.1:4174/clipboard`:

```sh
node scripts/clipboard-installed/acceptance.mjs \
  --browser chrome \
  --out /absolute/fresh/clipboard-chrome-evidence \
  --helper /absolute/pinned/clipboard-input
```

Use `--browser safari` for ordinary installed Safari. The helper is compiled
separately as described in `README.md`. The coordinator never compiles, grants or
resets permissions, switches input sources, takes a screenshot, or supplies an
alternate input method. An expired source-pinned browser or dependency version
fails before normal input and needs a separately reviewed source update.

Chrome uses one dedicated persistent test profile and child-only app-data
directory inside the evidence output. Setup disables Playwright's original
focus emulation using its pinned original main FrameSession, then checks actual
document focus and the launched PID against the independently measured AX
owner. Safari uses one newly created ordinary window, its original numeric ID,
exact fixture URL and nonce title. Its closed asynchronous page facade uses one
request-identified promise-result slot, bounded script files and positional
Apple Event arguments. There is no Safari WebDriver session.

Five fixed rows measure forward/reverse fresh ASCII cross-block replacement,
rich Copy over the same selected range, rich Cut/Paste restoration, and mixed
Russian/English decomposed Unicode. Every Copy/Cut/Paste/Undo is a physical fixed
CGEvent program with a fresh full native stamp/context and actual directed DOM
range check before dispatch. Tests never invoke the fixture's controlled paste,
writer acknowledgement, history or command methods. Required results include
trusted browser clipboard events and paired shortcut keydown/keyup observations,
actual platform-writer confirmation, selected
NSPasteboard readback, native canonical/mark/link/hard-break structure, exactly
one independent Undo per edit, historical identity restoration, save/reopen and
final native/DOM/clipboard resource release.

The Unicode row freezes two literal browser-exposure branches: the supplied
decomposed string and its explicitly written NFC counterpart. It records the
source, selected OS UTF-8 bytes, exact browser-exposed string/code points and
native literal independently. Native content must equal its declared branch;
NFC equivalence is reported separately from exact equality. This is no claim to
retain arbitrary OS UTF-16 strings. The helper's known source write/read still
requires exact selected scalar bytes and does not normalize them.

Evidence includes an incrementally persisted `report.json`, an immediate file
for every original helper receipt, dependency/build/source/binary hashes, and
bounded Safari facade scripts/process results. A row has 45 seconds; the normal
run has five minutes and a separate final cleanup has 15 seconds. A failed or
unknown outcome is preserved, disables later physical input, and is never
retried. Observation polling only reads the original operation's completion.
Cleanup closes only the launched Chrome context or the original Safari window
after ID/URL/title checks. It preserves cleanup refusal separately. The output
directory must be fresh; the runner never overwrites a prior outcome.
The runner rechecks freshness after evidence persistence and before key dispatch.
It also joins source, dist, helper, fixture, HEAD and tracked-worktree pins at the
end; development runs record a stable dirty tree without calling it an exact
committed revision. Final delivery uses a clean committed tree.

Clipboard reads are only the helper's readback of a predeclared source write or
the two selected formats after confirmed fixture Copy/Cut. The lane does not
read or restore prior user clipboard content. It leaves the fixture-owned
clipboard write in place and records that scope explicitly.
