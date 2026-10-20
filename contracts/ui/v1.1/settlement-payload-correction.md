# OSR-42 settlement payload authoring correction — source01

Status: **AUTHORING_CORRECTION_NOT_ACCEPTANCE**. Independently derived from the
binding/native source and already frozen41 literals below. No installed03 output
was read or used as a golden; no modules, native code, tests or browser executed.
No repository bytes were changed to write this outside note.

| Profile | Exact command ID | Exact `payload_json` for U+00E9 |
| --- | --- | --- |
| KWDJ | `org.klenwriter.kwdj/command/insert-text` | `{"kind":"insert_text","text":"é"}` |
| NotesD0 | `org.example.notes/command/insert-text` | `{"text":"é"}` |

KWDJ DOM binding constructs `kwdjCommand({kind:'insert_text',text})`
(packages/kwdj/src/dom.ts:175); the factory maps that kind to the namespaced ID
and passes the WHOLE intent to createCommand (index.ts:11,20–26).
SDK ownData copies Object.keys in order and JSON.stringify serializes the owned
object (packages/sdk/src/data.ts:81–98). Thus kind precedes text in this emitted
exact string. Rust KwdjIntentDto is internally tagged `kind`, snake_case and
rejects unknown fields (wire.rs:130–145); the bridge decodes that DTO (lib.rs:230),
converts InsertText (convert.rs:45), and prepares native inline insert_text
(commands/mod.rs:235). The mounted command gate also requires kind (dom.ts:119–123).
Frozen41 P15-forward and P15-reverse already specify precisely this precomposed-é
payload for command/query/execute; no frozen literal correction is needed.

Notes has a DIFFERENT protocol. Its DOM binding calls createCommand with only
`{text}` (examples/notes-extension/dom.mjs:48); the gate permits only that field
(:42). NotesAdapter decodes a deny_unknown_fields struct containing only text
(crates/notes-sdk/src/adapter.rs:12–15,54–56) into NativeNotesIntent::InsertText;
its native provider uses the ID above (crates/notes/src/commands.rs:15,267).
Adding a KWDJ discriminator to Notes would be wrong.

The existing harness authoring error is the ONE shared
compositionSettlementState.payloadJson=`{"text":"é"}` (settlement-literals.mjs:25),
which ui-native-acceptance.mjs:66 applies to both profiles. It is correct for Notes,
incorrect for KWDJ. Minimal correction: retain exact string equality, store the
payload literal per profile, and compare the selected profile's literal. Preserve
all command IDs, canonical output, directed endpoints, IDs/metadata, stamp deltas,
event counts, history/undo and every other assertion unchanged. This is not a new
production/native command, normalization change or acceptance waiver. Old35/41/v1
bytes stay unchanged; existing full checks/installed assertions remain required.

## Exact source pins

Paths are relative to `/Users/artem/projects/klenwriter-editor`; line anchors
refer to these pinned bytes. These pins are source evidence, not execution proof.

| Path:lines | Bytes | SHA256 |
| --- | ---: | --- |
| `packages/kwdj/src/dom.ts:117–123,173–175` | 12425 | `6399c1e91a7952bf468cc11246b20282d796425043b4b93e5fc467aad9304a51` |
| `packages/kwdj/src/index.ts:9–11,20–26` | 1536 | `f369b51656c4840107b4db51dc157ce7b2635888a73896b52ad113be6ce612ca` |
| `packages/sdk/src/index.ts:8–12` | 649 | `185cafbffbb9dcac4f51df81c3cacec7061e05976fee937a87c6637bd2a3b2cb` |
| `packages/sdk/src/data.ts:81–98` | 5981 | `0a58772a4fb0d4101e8a719e12406f939cedc42ad496ce16bb3d581edd04f2c7` |
| `crates/kwdj-sdk/src/wire.rs:130–145` | 12999 | `d19033b8f4f3f244ec01ffab0ee17a11dd2a770cd1105c589bc94ab9f38f3cdd` |
| `crates/kwdj-sdk/src/lib.rs:225–230` | 17616 | `0dd3fe70557e2e5f7c1eb1e125ec4dffc67e335278d8803b59b1ec0b47cf7474` |
| `crates/kwdj-sdk/src/convert.rs:37–45` | 4900 | `6586e933c1bb3d76f51101b9c33f0ff62c3350dd029a01bef7f056af458c4833` |
| `crates/kwdj/src/commands/mod.rs:107–108,199–206,229–235` | 8311 | `aeb7ea6abb41a69405e7876fe5df6a9572d7a544f05308be4de84f708ed7a8e4` |
| `examples/notes-extension/dom.mjs:38–48` | 3650 | `0d4aebb834b03f068e21fc74f7888f60cdfe794ac3d78d1dd7a5967471815205` |
| `crates/notes-sdk/src/adapter.rs:12–15,49–56` | 2122 | `36977eff0a37f307d6b617e371fd50228ab439a20d8a2a13ec8de31889e51ed4` |
| `crates/notes/src/commands.rs:15–21,265–267,306–310` | 15308 | `7035e6b3f98c3b2d11f4d5f1c411cecca081b33467e7eb69f42d40b7f03e9095` |
| `contracts/composition/v1/native-oracles.json:18805,18882–18899,19872,19950–19966` | 847545 | `ac17ce35d4dd94f397782ce89fc0567404b3305da1c63a9277309b8c2e16df6c` |
| `scripts/ui-native/settlement-literals.mjs:13,22,25` | 3176 | `aacc2e34cdbffbfce36af725769e86261a90d545d157ca7f65783eb900ec878e` |
| `scripts/ui-native-acceptance.mjs:46–48,66` | 38671 | `8b9492e38a730a0fc449ac9bad8e4ba1f34a88813e342e93904ffdd5ebcc7577` |
