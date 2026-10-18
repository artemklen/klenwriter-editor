# Finite recipe v1 — independent oracle before implementation

Authority: accepted OSR-64 execution contract65a842098cb267e2eccb2ba702b9295d6c650d8f05e2521e4d926815f0eda04b plus primary architect's accepted finite-recipe proposal. This is an independently authored synthetic verification corpus, NOT a compiler/provider implementation, executed pass or official review. MIT OR Apache-2.0. Original basic158 vectors/manifest remain unchanged. Notes codec and its native commands belong to the separate Notes corpus.

`recipe-vectors.json` contains28 compiler cases,24 generic Session runtime sequences and11 transport cases (63 authored cases). `recipe-manifest.json` pins these bytes. Expected documents, selections, revisions and codes were authored before recipe decoder/compiler/provider implementation. Test adapters must not derive expected values from registry, engine or serializer output.

## Closed declaration and finite operation language

Registry `commands` is closed tagged `kind`: `compiled{id}` or `recipe{id,parameters,operations,selection,stored_marks}`. Every displayed field is required; unit forms are empty STRUCT variants. Compiled markers are accepted ONLY from separately supplied mandatory trusted Rust registrations. The fixture `mandatory_registrations` models that compiled side; it is never a request field or a way for host JSON to grant itself privilege. Raw host markers refuse registry.compiled_command_forbidden. Compiler success is metadata/provenance validation, not proof a compiled callback executes; real compositions separately implement and verify each native catalog ID.

All parameters are required in this initial subset. Closed Parameter `kind` is `node{}` or `value{schema:AttributeSchema}`. A nullable Value accepts explicit null, not omission. Maximum64 parameters and64KiB raw recipe payload are accepted capabilities; compiler limits also cover all parameter/template rules/bytes. Catalog<=256, operations/recipe<=256, total declared operations<=4096; forward/self/noncreating/path-invalid references refuse before runtime. Zero-operation recipes are valid and can be true noops or explicit state-only plans.

NodeRef `kind`: `argument{name}` or `created{operation,path}`. ValueExpr `kind`: `literal{value:raw JSON Value}` or `argument{name}`. UnsignedExpr has the same tags, but literal must be u64 and runtime argument must be an exact nonnegative integer, never a float/string coercion. AttributeEdit `kind`: `remove{}` or `set{value:ValueExpr}`.

Exactly four operation `op` variants, each expanding to ONE existing core operation:

- replace_text{leaf,from,to,text}; text must resolve to String; offsets are UTF16 and existing grapheme guards remain authoritative.
- set_attribute{node,key,value}; one-key patch, including explicit removal. Multiple entries express multiple attribute updates; no hidden SetAttributes expansion.
- set_marks{leaf,marks}; marks are explicit whole-mark replacement, not a toggle with invented preservation rules.
- insert_fragment{parent,index,fragment}; finite NodeTemplate trees, never executable hooks.

MarkTemplate is exactly type_id/attributes; attributes map to ValueExpr. NodeTemplate is exactly type_id/attributes/marks/text/children; text is required-nullable ValueExpr, not authored primitive. Primitive is obtained from the selected registry. Static type/mark/template errors refuse compilation; dynamic parameter values remain subject to final actual profile validation. Created indexes are zero-based earlier recipe-operation indexes. InsertFragment path[0] chooses a root, subsequent entries choose descendants. Translate operation index by initial PlanBuilder.len() with checked addition; descriptors cannot address preceding unrelated builder operations. No supplied persistent IDs, restore IDs or historical revival primitives.

Selection `kind`: map_current{}, set{selection:required-nullable SelectionTemplate}, map_from_user_result{selection:required-nullable SelectionTemplate}. SelectionTemplate contains anchor/focus. PositionTemplate `kind`: text{node,offset,affinity}, child{parent,index,affinity}, edge{node,side}; affinity/side are before/after. These map exactly to existing SelectionIntent phases. Stored marks `kind`: keep{}, inherit{}, set{marks}. Final typing marks use the final candidate/selection and real profile finalizer; recipes have default presentation(active=None), not a fabricated On state.

## Exact V2 recipe payload — existing AttributeDto only

CommandDto.payload_json contains ORIGINAL UTF8 JSON text:

    {"kind":"recipe","arguments":{"nodes":{"target":"opaque-token"},"values":{"n":{"kind":"number","value":"9007199254740993"}}}}

The wrapper, arguments object, nodes map and values map are required and closed. Maps contain exact parameter names. Values use the EXISTING common protocol AttributeDto; no duplicate numeric/value DTO exists. Number values are canonical decimal STRINGS. Thus u64max/2^53+1 remain exact,1.0 remains a float, and noncanonical9007199254740993.0 is refused as sdk.noncanonical_number instead of silently rounded. Raw registry Literal JSON still follows ADR004's represented-number semantics; the two boundaries are deliberately different.

Before any serde BTreeMap collapse or node parser, borrowed V2-only preflight rejects duplicate JSON keys with registry.duplicate_json_key. ABI1 decode is unchanged. Diagnostic order: byte/depth/count/duplicate-key preflight -> closed DTO and AttributeDto/canonical-number decode -> known names/category/cross-map conflicts -> required presence -> declared Value schemas -> actual plan/engine/profile preparation. A Node parameter supplied in values, or a name present in both maps, gives registry.argument_type_mismatch. Unknown names give registry.unknown_argument; missing required arguments give registry.required_argument_missing. Invalid opaque token gives registry.invalid_node_argument through trusted Rust parser, not a JS callback.

The64KiB bound counts ALL UTF8 bytes of payload_json, including wrapper and whitespace, BEFORE owned parse/node resolution. Transport cases with append_ascii_spaces append exactly that many U+0020 bytes to the literal payload, assert the declared total byte length, then feed the original padded bytes. This deterministic input construction generates no expected output. Accepted transport never implies valid command parameters or successful execution.

## Runtime fixture meaning and independence

Generic runtime cases require actual Session<Recipes<P>> with a trusted synthetic profile that implements the declared registry attrs/grammar and the documented explicit adjacent-equal-text JoinText normalization. A permissive fake validator or alternate recipe executor is not accepted. Real public Notes/KWDJ and prebuilt SDK/native/WASM composition remain separate mandatory evidence. The fixture profile/codec is org.example.recipes, not org.example.notes.

`documents` are independently literal semantic node graphs. `attributes` and mark attributes use existing AttributeDto so numeric values never pass through JS Number. Every node has explicit type/primitive/attrs/marks/text/children and a LOGICAL id. These IDs are oracle variables, not public tokens. `$node.ID` substitutions use the actual opaque token captured for that independently named existing node. New logical IDs are assigned from operation/path provenance; no implementation-generated document becomes the oracle. Undo/redo must restore exact historical identities captured at first commit; normalized-away new-right remains retired. Query must not consume real IDs; compare next actual allocation to an untouched control when checking that property.

Successful frames begin at revision0 and assert apply1/undo2/redo3, exact documents/selection/stored marks and stack units. Newline/SPACE/NBSP/decomposed Unicode are literal authored data. Failed cases retain ALL committed facets: doc, selection/marks, revision/epochs, dirty/saved baseline, IDs/allocator, maps/history/journal, events/cursors/context/cache. Queries must remain pure even on late refusal. Profile/request work cap0 is real inherited engine refusal, not a new per-operation meter/reset. Recipes<P> MUST delegate the accepted FrozenProfile::transaction_work_limits hook unchanged.

RR017 maps a Created right-text caret through actual user-result normalization into the surviving left text. RR018 uses final-frame Set on that retired identity and refuses tree.missing_node; no silent retarget. RR022 is a true registered noop; RR023 changes future marks without document publication/history. Root metadata and compound late validation/refusal use the same engine path; exported docs are not patched afterward.

## Typed wrapper and remaining scope

RegistryProfile getter is defined in registry and extends FrozenProfile. Recipes<P> requires CommandProvider+RegistryProfile; it delegates exact Context/Admitted/Cache, codecs, seed_cache, full/scoped normalizer/validator, finalizer and immutable work limits, mapping errors into Profile(E)|Registry(Diagnostic). Compiled intent delegates to P; recipe intent expands through PlanBuilder under the same WorkMeter. Borrow catalog from FrozenRegistry; validate actual compiled IDs against P's real instance catalog before wrapper publication. No dyn FrozenProfile, global registry mutation, KWDJ branch, duplicate cache, unmetered whole-document codec or extra publication.

No implementation execution, full-vs-scoped proof, long fuzz/property claim, browser renderer, public package publication or four-AC completion follows from this corpus. Preserve actual red cases; correct an independently wrong oracle through an explicit reviewed change, never by copying current output.
