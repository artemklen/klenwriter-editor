# Clipboard pipeline

OSR-47 adds optional KWDJ plain/HTML conversion to the mounted SDK2 editor.
The default generic DOM adapter owns browser events, target freshness and raw
recovery; a profile codec supplies conversion. Rust admits the fragment and
executes one atomic command with isolated history.

```ts
import { kwdjClipboardCodec } from '@klenwriter/editor-kwdj/clipboard';

const mounted = mountEditor({
  element, editor, renderers,
  clipboard: {
    codec: kwdjClipboardCodec({
      allow_origin_relative: true,
      allowed_schemes: ['https'],
    }),
  },
});
```

The codec requires an explicit URL policy. It can narrow the native http(s)
and origin-relative subset. It cannot broaden native admission. The optional
subpath lazy loads the [parse5 adapter](adr/006-clipboard-parser-boundary.md).
Neither source HTML nor parsed nodes enter the editor DOM.

## Formats and structure

The paste event captures exposed `text/plain` and `text/html` strings synchronously.
Complete HTML takes precedence. A causal unsupported/unsafe rich branch may use
independently captured complete plain text, with ordered diagnostics. A missing,
oversize or unread rich representation cannot establish fallback eligibility.
Declared files/media prevent text fallback. The reserved internal MIME
`application/vnd.klenwriter.editor.fragment+json` receives explicit refusal;
it does not change profiles or authorize a structured payload.

Plain prose preserves punctuation literally, maps single newlines to hard breaks
and blank runs to paragraph boundaries. Plain poetry uses native verse context.
Line ending conversion belongs to this explicit format decoder. Core text is not
implicitly normalized to NFC or passed through typography/Markdown rules.
Raw recovery preserves the exact exposed UTF-16 strings, including unpaired
surrogates which semantic admission refuses. Browser/OS clipboard transformations
must be measured separately from exact code-point equality and NFC equivalence.
Browser writers can also add encoding metadata and resolve relative link URLs.
The decoder ignores only an inert root HTML `meta` with one exact UTF-8 charset
attribute, with an explicit metadata diagnostic. It never reconstructs a relative
URL from an exposed absolute URL. Platform write confirmation acknowledges the
write; lexical format fidelity is a separate observation. A host requiring only
portable absolute links can set `allow_origin_relative: false`.

Native clipboard reads expose a small profile context or an ID-free fragment,
with the original directed selection and stamp. The separate ABI2 formats are
`org.klenwriter.kwdj/clipboard-context/1` and
`org.klenwriter.kwdj/clipboard-fragment/1`. ABI1 remains closed.
Compatible sibling text blocks support partial cross-block replacement with
marks and hard breaks. Open start/end edges retain compatible outside headers;
closed blocks retain their own structure. Partial cross-parent/list/cell shapes
and incompatible open headers refuse. An empty fragment forest refuses without
moving the caret; an explicit empty paragraph remains a real inserted block.

The mounted KWDJ renderer gates insertion to its supported presentation subset.
Native acceptance of a table/verse does not install a table/poetry provider.
Unsupported mounted presentation preserves the raw capture for host recovery.
Safe copy serialization emits escaped allowlisted HTML. Open heading edges
refuse because external HTML cannot preserve partial heading openness; closed
headings remain supported. Semantics which cannot
roundtrip through that serializer refuse rather than being flattened.

## Ownership and platform completion

Before insertion, the owner rechecks full native stamp, session context, private
selection intent, actual live directed range, focus, access, mode and composition.
A final validation also runs after the host command gate. Changes do not cause
recapture, rebasing or retry. The original completed/queued native ticket remains
the publication receipt.

Copy/cut uses a confirmed platform writer. `writeText(text)` supports plain output;
`write({text,html})` can provide a trusted host rich writer returning a completion
promise. Defaults use this document's `navigator.clipboard` APIs. Event `setData`
is observation only. Cut deletes once, only after writer confirmation and a new
full target check. A late/failed write cannot replay deletion.

A failed paste retains one raw slot. Further paste attempts cannot displace it:

```ts
const recovery = mounted.clipboard.takeRecovery(); // transfers ownership
// Or explicitly release the retained slot:
mounted.clipboard.releaseRecovery();
```

Recovery includes per-format completeness, metadata, original target and causal
reason/diagnostics. A complete local string snapshot is distinct from a durable
host write or storage acknowledgement. It contains no retained ClipboardEvent or
DataTransfer. `destroy().clipboardRecovery` transfers a terminal snapshot, or
returns a completion promise while retired work still actually owns the slot.
Document `RecoveryPacket.originalInput` keeps its original meaning.

Capture reads at most 16 total metadata entries, MIME length128 UTF-16 units,
524288 units per representation and1048576 total retained units. Initial
`getData` materialization is outside these post-read limits. The parser bounds
source, construction, attributes, depth, copies and logical work; see exported
`clipboardParserLimits`. The decoder caps output at8192 nodes. Native profile,
work, copy, ID, mapping and history limits apply independently.

A15-second decoder deadline marks work retired; it cannot interrupt synchronous
JavaScript. A monotonic deadline also guards late completion before native work.
Retired parsers and their retained units stay counted until actual completion.
Late candidates never insert. Parser logical counters are not process RSS or a
bound on every private tokenizer instruction.

## Corpus ownership and verification

The unchanged `contracts/kwdj/v1` fixtures own conversion literals and diagnostic
order. The TS decoder owns conversion; native profile validation owns admission;
actual SDK2 WASM and mounted fixtures own their respective execution stages.
Future presentation providers keep separate pending stages.

The frozen OSR-45 ledger retains its seven historical `clipboard_pending`
memberships. OSR-47 adds the seven CB13 conversion rows per engine without
rewriting that ledger. Every accepted corpus candidate uses an actual packaged
SDK2/sealed WASM **headless** session; this does not establish mounted corpus
presentation. DOC-029 poetry and DOC-030 table presentation remain pending.
DOC-031/033 have no conversion candidate and dispatch no native insertion.
The separate native corpus test checks the five accepted unchanged KWDJ literals.

| Fixture | Conversion outcome / diagnostic codes | Admission/presentation boundary |
| --- | --- | --- |
| DOC-028 | candidate, none | literal prose; native and WASM insertion |
| DOC-029 | candidate, none | canonical poetry; native/WASM, poetry presentation separate |
| DOC-030 | candidate, none | nested rich forest including table; native/WASM, table presentation separate |
| DOC-031 | refusal: unsupported_semantics | no native insertion candidate |
| DOC-032 | candidate: rich_branch_rejected, plain_fallback_used, unsafe_url_rejected | independent plain fallback; native/WASM insertion |
| DOC-033 | refusal: media_item_forbidden, remote_image_forbidden | no native insertion candidate |
| DOC-034 | candidate: editor_metadata_ignored | allowlisted visible content; native/WASM insertion |

All table diagnostic names have the `clipboard.` prefix. Stage availability is
not an acceptance PASS. `npm run test:clipboard` runs focused Node and three-engine
mounted measurements after a coherent build; native tests also run in the Rust
workspace checks. Installed Chrome/Safari clipboard/input observations have a
separate mandatory protocol and receipts. Controlled writers/events are labelled
and do not establish OS clipboard behavior. The parser build manifest records
published dependency versions, original licenses, graph inputs/outputs and
raw/gzip hashes separately from runtime no-fetch/browser proof.
Current invocations write `artifacts/clipboard/browser.json` and per-case JSON
observations under `artifacts/clipboard/browser-results/`. Their source/build
pins and original exits must be joined to the final revision; historical or
development observations do not establish final-current-source acceptance.

HTML drop remains the existing OSR-44 explicit refusal, with no DataTransfer body
reads. Native block Move uses its existing independent route. Clipboard adds no
publish, deploy, provider, mobile or collaboration behavior.
