# Reliability scenario v1

Independently authored synthetic model/oracles for OSR-38. This is a test protocol,
not an editor ABI or a second document validator. The generator imports no engine,
codec or SDK. Complete canonical encoders and three Unicode/history traces are
checked against literal expected values authored before runtime adapters.

`scripts/reliability/scenarios.mjs` exports `literalScenarios()`,
`generatedScenarios({perContext:256,seed:0x38c0ffee})`, and `writeScenarios()`.
The latter writes JSONL plus a byte/SHA/context-count seal under
`artifacts/reliability/`, before replay. Native consumes all256 generated/context;
packaged SDK consumes at least first64 generated/context plus every literal.
Literal cases do not count toward generated exploration floors.

Every scenario has closed versioned `format`, `model`, `id`, `seed`, and one of
`kwdj-prose`, `kwdj-poetry`, `notes-d0`, `notes-d1`. `input_json`, `registry_json`,
and `profile_options_json` retain exact source strings. `profile` is the explicit
V2 binding; the actual verified module's build ID is injected at execution.
`admission` is validate. The KWDJ registry is an independently authored default
public descriptor, not an output of a runtime registry compiler. Notes descriptors
are the existing versioned author-package d0/d1 inputs, read verbatim.

`initialLabels` holds node paths under the engine's synthetic root. Resolve the
block once. The semantic paragraph remains live; subsequent legitimate current
child reads can bind returned created leaves. Never retarget an opaque stale
node to a different node occupying its former path. Dedicated stale-reference
and native-operation fixtures remain separate.

`initialExpected` and every action's `expected` have complete `canonical_json`,
logical `selection:null|{anchor_utf16,focus_utf16}`, history undo/redo unit counts,
conservative dirty flag and document revision string. Dirty remains true after the first document commit; undo does not reconcile saved content. This scenario has no save/reconcile action. These values are computed
before calling the engine. Logical selection must map to an actually valid
physical position; it is not permission to ignore invalid DTOs or identity.
`effect:state` denotes the model's selection navigation; it is not a new SDK
effect variant. Insert/history effects are changed. Fresh captured stamps and
correct public tickets are required at every action.

Actions are `select{from,to}`, `insert_text{text,isolated:true}`, `undo`, `redo`.
At most16 nontrivial replacements produce64 total actions including undo-all
and redo-all. Independent text tokens are ASCII A/B, SPACE, NBSP, decomposed
e+acute, astral emoji and complete woman-technologist ZWJ. The finite alphabet's
boundaries are known; this does not claim a second general grapheme algorithm.
Generated cases retain ASCII L/R sentinels, so the bound paragraph and a nonempty
text representation survive. D1 starts with literal highlight sun and complete
metadata; edits must preserve those authored fields. D0 unknown-extension
refusals, D1 recipes, structural/normalization/algebra cases and hostile raw-byte
fixtures are additional lanes, not erased by this deliberately small model.

The pure model checks no implementation outcome. Refused execution may burn
reserved IDs; committed tree/stamps/history/cache/outbox/baseline remain atomic.
Native full/scoped differential tests are labelled authoritative differential
evidence rather than independent semantic oracles. Query parity uses identical
native hint/caps; generic V2 SDK queries cover representable Isolated requests.
V2 generic controller excludes update_facts even though the KWDJ V2 low-level
endpoint owns that request; real V1-controller facts, raw V2 endpoint facts and
V2-controller typed unsupported outcomes must be reported distinctly.

Replay a saved original/minimized failure before exploration. Shrinking must
preserve the same invariant and phase/class and valid definition-use relations;
a new parse error cannot replace a semantic failure. Corpus additions preserve
original bytes/provenance. Model/fixture changes require an explicit independent
spec correction; never derive expected values from observed runtime outputs.
