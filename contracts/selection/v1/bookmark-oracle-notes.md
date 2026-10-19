# OSR-40 pre-candidate bookmark data

Independent authoring only, 2026-10-19; no candidate/native/browser/test/build execution. Root started40 after actual39 close. This packet is proposed acceptance data for primary inspection/freeze, not a runtime pass or formal review.

- JSON: `/tmp/osr-40-bookmark-oracles.json`, 162,831 bytes, SHA256 `cdfb09a724e301424a500089ba267fd795e6986e27fa32558d7d6e3da8b9e5cb`.
- 59 concrete cases;16 full literal KWDJ wire documents;39 native state descriptions;11 native map-fact tables. Expected points/states/maps were written before DOM40 candidate code. The Python assembly only copies literal structures; no production import/map interpreter/output was executed. The JSON, not the preliminary assembly helper, is the final data authority.
- Role strings such as T/P/ROOT are **fixture bindings**, never fake NodeId wire tokens. The adapter binds actual opaque IDs once via independently authored role paths, preserves declared identities through edits, and resolves DOM objects separately. Session/generation/build/digest tokens are relational bindings, not invented process constants. All public text offsets remain UTF-16 counts validated at scalar boundaries. History retained_bytes is target-dependent and compared exactly within a native state, not guessed portably.

## Coverage and concrete expected facts

C01–C11 cover capture purity, reverse/before affinity, Child0, hard-break gaps, atom edges, null, combining-readable UTF16=4 in `a😀é👩🏽‍💻Z`, half-surrogate offset2 refusal, pending DOM mismatch and busy. L01 captures64 literal T2 bookmarks, refuses65 without mutation, releases one slot and captures another. B01–B03 reject copied/foreign/released capabilities. E01–E10 include native no-op, retained stored marks, null focus refusal, explicit versus deferred outside focus, another mount, same-point pointer/host-selection intent invalidation, and Tab restoring CURRENT T3 without publishing a browser-start reset.

M01–M15 use literal maps: split `abcd` at2 (Before stays old T2; After becomes new T_RIGHT0), join `ab`+strong`cd` (right0→left2; old left EdgeAfter→left2 After), forward/back/cross-parent moves, and insertion `abЯcd` preserving Before2 versus After3. Deleted removal returns live ROOT child1 **with deleted=true** and must refuse. Exact refusal can be followed only by an explicit mapped retry; no automatic retry. Eviction uses66 real isolated Move actions in33 forward/back pairs, so final document/IDs/selection equal the original while revision/history epoch66, action stack64, oldest retained map revision2. No private setter or smaller cap is needed.

H01/H02 explicitly separate chronological native maps from action permission: split→undo maps old T2 back to T2 and redo revives right IDs, but history changed intent, so the old bookmark refuses before map lookup. H03/H04/H05 cover stored marks, no-op barrier and fresh capture after unknown-state invalidation; a new continuity baseline never revalidates OLD.

FX01/FX02 preserve native semantics: changed selection in an open typing group clears strong override, seals history epoch1→2 and advances selection epoch3→4, with undo entries remaining1 and no document change. An identical native point keeps marks/group/native stamp, while the new pointer intent still invalidates the earlier UI bookmark.

A01–A05 distinguish pre-queue busy/reentrant refusal from controlled unexpected queued Submission identity and real subscriber/focus races. A changed mapped restore can publish state, a subscriber queues a newer selection, and the original completed state_changed response remains unchanged; late DOM/focus work cannot rewrite it into native Refused. A native no-op emits no event, so the subscriber case deliberately uses a changed restore. Focus listeners are installed before focus to reach their named guard.

S01–S07 cover provisional preservation, disposal/replacement generations, failed replacement local ownership, disabled/readOnly and inconsistent context metadata.

## Execution qualifications for later adapters

1. Cases marked controlled_sdk_boundary / controlled_context_boundary / controlled_delivery_boundary are explicit policy/transport seam tests, **not** native semantic conformance or evidence that normal idle restore queues. Their expected returned response object/promise is retained verbatim. Do not report those fixtures as actual Rust failures.
2. M13/M14 include an actual changed-revision boundary before intercepted map responses, so the mapping guard is reached. Map facts remain independently authored and should also be checked against actual native SDK/public engine behavior; never let a permissive fake become the edit/EGC authority.
3. Current native default journal and history-action caps are64 (`crates/engine/src/transaction.rs:43`, `crates/engine/src/history.rs:59`).66 commits produce64 undo units, not66. All isolated document actions use actual changed operations; true no-ops cannot fabricate revisions.
4. Two local UI policies are explicit for primary freeze: a bookmark is consumed at final dispatch, while busy/preflight refusal retains it; an explicit replacement attempt invalidates old handles even on admission failure, while **native** state/generation stays unchanged on that failure. If primary chooses another policy, change this independent data transparently before implementation, never to fit candidate output.
5. Native setup/state counters are authored from named public actions. OPEN_GROUP has a descriptive fixture-only open flag, not a new SDK field or a permission for a private setter. Construct it through actual stored-mark/typing-hint actions. Target-dependent ownership bytes, opaque tokens and serialized object key order are not portable numeric goldens.
6. Original39 contract61 pins/expected bytes are untouched. New40 DOM codes and selection phase/resources sibling are separate additive contract choices. All assertions/data remain pre-candidate; no Ready/review/pass claim or OSR38 stopped campaign is implied.

The initial authoring self-check corrected a draft odd-length two-state eviction transcript to66 concrete moves and corrected its history cap to64; this used existing accepted native definitions, with no implementation execution. The final JSON records these corrections explicitly.
