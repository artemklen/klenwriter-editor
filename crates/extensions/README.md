# Typed finite recipes

`Recipes<P>` composes an existing `CommandProvider + RegistryProfile`. It keeps
that profile's concrete Context, Admitted and GAT Cache types. Normalization,
full/scoped validation, codecs, final typing marks and immutable host work limits
continue to use that same profile. The crate's normal dependency graph contains
core and registry; engine is a test-only dependency.

Construct with `Recipes::new(profile, &mut work)`. The constructor validates the
real underlying instance catalog and requires its IDs to equal the frozen
registry's mandatory `Compiled` registrations exactly. The wrapper borrows the
registry's complete catalog, including recipes. `Intent::Compiled` also checks
that its real command ID has compiled provenance before delegation;
`Intent::Recipe(RecipeIntent { id, nodes, values })` expands a registered recipe.
An ID cannot choose the other implementation path.

The finite subset is `ReplaceText`, `SetAttribute`, `SetMarks`, `InsertFragment`.
Templates use the registry's declared primitive. Attribute values remain core
`Attribute` values, including exact arbitrary-precision JSON number forms; no
floating-point or string coercion is used. Parameter categories, unknown keys,
required keys and compiled Value schemas are checked before expansion. Copies
are charged before allocation, and the existing PlanBuilder and subsequent
Session preparation share one WorkMeter. Local Created references address only
earlier operations within this recipe. Position/index values have an explicit
u32 capability before conversion to host usize; this does not restrict numeric
attributes to u32.

This crate does not publish tree state, execute JavaScript or provide an
alternative transaction engine. The production Session prepares each resulting
operation, final selection and typing marks, then owns atomic publication and
history. The separate bridge owns bounded closed JSON transport and opaque Node
tokens; native callers use typed IDs and Attributes directly.

`tests/runtime.rs` reads the independently authored recipe corpus under
`contracts/extensions/v1`. It compares literal document fields, exact strings,
selections, stored marks, revisions, live identities and undo/redo restoration.
It runs actual queries and executions and compares their work; query/refusal
checks cover all public committed facets. Private allocator/cache counters are
not inspected by this external integration crate. The trusted synthetic profile
uses the registry's actual full/scoped schema authority and explicit JoinText
normalization. It is separate from real Notes/KWDJ codec and native/WASM
composition evidence.
