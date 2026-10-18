# OSR-64 execution contract — public extensions and independent profile

Accepted technical contract by primary Codex under the owner's OSR-26 delegation,2026-10-18. Architecture v2.0/master plan v3/ADR002 and all four original Linear AC remain authoritative. Source admission starts from clean main522ba7d08b9d38995b5faf4687bcbde75ecd9965; dependencies29/34/36/63 are Done. Standalone,ci_owner none. No publish/deploy.

## Outcome and unchanged acceptance criteria

An external author supplies a separate package through public APIs, without core source changes. Both bounded runtime descriptors in already-built WASM and trusted compiled Rust modules are implemented. Independent notes has its own codec, callout and highlight, no KWDJ/MediaHub policy. KWDJ uses the same registration/composition API and keeps its existing normative authority.

1. Extension connects as a separate package through public API without modifying core source.
2. Native/WASM accept/refuse/export results agree for both profiles.
3. Grammar/commands/history/serialization are covered; conflicting/unknown extension version fails safely.
4. Integration guide and an author testkit exist; CMS/KWDJ profile uses the same API.

Required evidence is two real external consumer fixtures, actual normal dependency closure, shared extension conformance through native/compiled WASM/prebuilt SDK, exact source/artifact identities. A second manifest name or M0 reference checker is insufficient.

## Technical decisions

| Choice | Decision and reason |
| --- | --- |
| Profile composition | Keep typed Session<P>/GAT cache and existing transaction/history authority. Public factory erases only a fully constructed endpoint. A finite distribution enum is possible but forces composition edits per author; dyn FrozenProfile is not object-safe. |
| SDK evolution | Add explicitly negotiated V2 exports/options/manifest to the same sealed module and one glue initialization. Keep exact legacy ABI1/36 generated declarations and KWDJ codec/1. Replacing ABI1 or adding unknown fields to its closed DTOs would break existing consumers. |
| Registry/compiler | Sibling public generic registry crate above core; bounded epsilon-NFA plus compact counted Type-or-type-choice repetition. Avoid a DFA powerset or greedy backtracking. |
| Bridge boundaries | Common protocol/typed bridge/factories have no KWDJ dependency. Sibling KWDJ SDK adapter owns legacy facts/limits/intents/diagnostics; notes profile/adapter uses only generic public crates. Native core/KWDJ and any new normal registry dependency retain Rust1.89; engine/bridge may use pinned1.97.1. |
| Runtime command catalog | Add borrowed instance catalog defaulting to exact existing static catalog. Catalog/query/execute use the real registered IDs. Finite typed recipes expand existing operations through PlanBuilder and the same prepare/normalize/validate/publish path. |

No registry mutation in an existing Session. Runtime registry digest is distinct from distribution build identity and binds profile/cache/capability context. Explicit new admission is required for a registry change; ordinary remount remains same binding/registry. Compiled feature/module choices enter build identity and matching native/WASM manifests.

## Frozen registry language v1

Closed versioned JSON, `editor-registry/1`. Preflight borrowed bytes, depth/counts and bounds before owned parse/compile; duplicate JSON object keys in descriptors refuse. Exact ASCII identifiers128B, exact SemVer64B, no ranges/network resolution. Extension registrations own full public node/mark/command IDs; no owner is inferred from string prefixes or array order. `(kind,publicID)` conflicts refuse even for equal declarations. Preserve existing KWDJ IDs such as org.klenwriter.kwdj/text with owner org.klenwriter.kwdj/base. Mandatory compiled profile registrations cannot be removed/replaced by host descriptors.

All references resolve to exact owners in the selected version-pinned registry. Explicit dependency edges independently impose exact-version availability and deterministic topological rule order, ASCII tie-break; reject missing/mismatched/cyclic edges. Do not infer dependency edges from every type/mark reference: mutually recursive document types and profile-composed mark sets must not create artificial dependency cycles. The composer explicitly supplies root/mark policy; extensions do not silently patch another owner's schema. Ownership and the complete selected configuration enter the digest.

Grammar: Empty,Type,Sequence,Choice,Repeat(min,max), finite checked counts. Type references are terminal labels, not recursive grammar expansion. Bounded epsilon closure terminates with visited sets and charges transitions/scratch; compact repetition optimization applies only to single-child-label/choice-of-label items, never nullable/variable-width items. Check projected states/transitions before allocating. Unknown primitive/operator/reference/version refuses before document decode.

Attrs: closed string UTF8 bound,boolean,number,integer,enum,syntactic ASCII ID,nullable,bounded list,closed object. Required presence differs from nullable. Unknown keys and metadata never disappear in normalization. Number ranges compare exact bounded decimal bound strings to the canonical decimal of the represented serde_json Number; no f64 range comparison and no recovery of already-rounded original raw tokens. Integer means exact i64/u64 Number representation; floating forms such as1.0 and overflow fallback refuse. Numeric comparison treats signed zero equally; normalized bound tuples may share digest, authored canonical-v1 number bytes remain unchanged. Preserve ADR004, existing Number-string DTO and all KWDJ valid bytes.

SHA256 digest uses domain-separated registry-format canonical semantic data, exact ownership/binding/dependencies/declared policy and ordered grammar/recipes; sort only semantically unordered sets/maps. Normalize decimal bounds as bounded sign/coefficient/exponent tuples. Display metadata/renderer availability are not semantic authority. Host reductions bind a separate immutable capability context and can only lower distribution/profile limits.

Compiler hard ceilings (profile/host may reduce): descriptor256KiB,JSON depth128/values131072;64 extensions;1024 node+mark declarations;4096 attr rules/depth16;8192 grammar operators/depth32;16384 states/65536 transitions;1,000,000 work units/16MiB logical owned bytes. Decimal bound512B/coefficient256digits/absolute exponent4096. Existing catalog256commands and256operations/recipe;4096 total declared recipe operations. These are compiler capabilities, not new KWDJ document maxima. Checked overflow/exhaustion returns typed resource refusal before publication.

## Independent notes and two extension levels

Use exact notes profile org.example.notes@1.0.0,codec org.example.notes/json,wire1. Notes JSON is a closed schema_version1 envelope with one semantic document-root node; title/tags live in that node's bounded attrs so ordinary operations/history own authored metadata. Nodes encode type/attrs/marks/text/children with required explicit fields and no session IDs or authored primitive override; primitives come from the admitted schema. Canonical JSON follows existing canonical-v1 representation. Notes codec duplicate keys/unknown fields/version/unknown semantic data refuse with original input retained.

Compiled base supplies document,paragraph,text,hard-break and real Rust codec/normalization/commands. Runtime packages add callout Container and highlight mark plus named recipe commands. Profile composer explicitly selects root block/mark policy from admitted types. Normalize only documented lossless text joins via explicit bounded operations; canonical input is a fixed point. Edits use normal maps/inverses/history/single publication, never validator side effects.

LevelA proof: open D0 and D1 using identical packaged JS/WASM/build hashes, with no build between admissions; D1 admits/edits/exports callout/highlight and catalog recipes, existing D0 Session remains frozen and refuses D1-only data. LevelB proof: external composition exposes V2 in both distributions but omits/includes the trusted notes Rust adapter/codec; absent module gives typed missing profile/codec capability before document decode, matching rebuilt native/WASM includes it and runs the same literal corpus. This is not merely ABI1-versus2 mismatch.

## Literal oracle and coverage before implementation

Freeze independently authored valid/refused literals and expected semantic snapshots BEFORE implementing their paths. Do not generate expected bytes from the implementation. Matrix includes exact IDs/versions/dependencies/topo/digest reorder/conflicts, unknown unit fields, grammar ambiguity/nullable repeat/large simple root, UTF8/presence/nested attrs, i64/u64 extrema and2^53 neighbors, decimal bound reversal/underflow/huge exponent, compile/work/depth limits before decode.

Through BOTH real profiles/public APIs cover admission/strict/import/export, catalog/query purity/execute, compound and late refusals, Unicode/marks/attrs, selection/maps/revisions/events, normalization fixed point/nonconvergence/work refusal, undo/redo exact metadata and identity, immutable registry/remount, stale callbacks and lifecycle cleanup. Preserve all committed facets on expected refusal; traps remain Fatal with correct may_have_committed provenance. SDK63 legacy regressions remain applicable.

KWDJ retains existing scoped cache/semantic validator. Schema validation on local edits must not add a global or wide-root scan: admitted frozen schema plus exact dirty edges can reuse unchanged proof for simple counted grammars; complex global constraints disclose their real scope. Default/mismatched registry-cache identity takes full validation. Add full-versus-scoped equivalence and measured work counters, including large roots and type changes. Notes may retain honest metered full fallback.

## Delivery and limits

Run focused meaningful native/compiler/profile/SDK checks during implementation; final npm check, fresh applicable MSRV/M0/browser/package/boundary/provenance checks, full actual source closure and both native/WASM consumer fixtures. New runtime dependencies require pinned primary-source/license/MSRV rationale and manifest+lock+inventory updates. Prebuilt JS consumer installs outside checkout offline/ignore-scripts with cargo/rustc absent from child PATH; same packaged V1/V2 lifecycle under strict CSP in three engines. No imaginary Windows/installed Safari/IME/AT or product-renderer acceptance.

One prepared CI on the actually ready source, fresh independent Grok full4.7/xhigh/OIDC review of the complete four-AC scope, exact-head normal merge, one automatic post-merge CI, bounded proof archive/cleanup and Linear Done/readback. Do not prepare elaborate future delivery helpers before source stabilizes. Preserve actual failed runs and never replace a missing verdict with self-review.

Non-goals: DOM/UI/input/renderers, public alpha/publish, CMS migration/persistence, plugin marketplace/sandbox, collaboration/mobile. Their original tasks remain mandatory. Rollback is a paired revert/rebuild to the accepted distribution; KWDJ persisted data/legacy API stay compatible and unknown notes data remains preserved/refused. PO verdict: Ready with assumptions — notes names/codec layout and internal crate split are reversible technical choices, accepted here by delegated primary architect; no unresolved owner permission or product-scope blocker.
