# ADR-005: explicit profile DOM bindings

Status: accepted implementation decision for OSR-39; runtime and evidence remain
subject to the task's independent review. Date: 19.10.2026.

`@klenwriter/editor-dom` depends only on the generic SDK. It owns the mounted
lifecycle, DOM identity and selection conversion, event delivery integration and
bounded input reconciliation. Native profiles continue to own edit semantics.
The DOM package imports neither KWDJ nor Notes and contains no profile-name switch.

The existing optional KWDJ package gains an explicit `./dom` subpath containing
`kwdjBasicRenderers`. That subpath depends on generic DOM and SDK; the headless
root entry remains independent of a mounted surface. The package's declared
runtime graph is therefore `kwdj -> {sdk, dom}`. SDK never imports DOM or KWDJ.
The independent Notes D0 renderer is an example under `examples/notes-extension`;
it is not embedded in the generic DOM package.

A native build-time producer compiles each exact supported composition from its
public mandatory registration, then resolves every candidate node, mark and
command through the actual `FrozenRegistry`. Its generated data binds the full
profile tuple, schema digest, owner, primitive and closed attribute inventory.
The optional binding imports `sdkBuildId` at runtime rather than embedding its own
build ID into an input to that ID. Changes to producer/registration/binding sources
participate in SDK build identity. No new registry-enumeration SDK endpoint or
frontend copy of native editing semantics is introduced.

The KWDJ inventory covers the complete registry while presentation handlers cover
only the twelve basic node types and nine supported marks. Initial actual-tree
admission, exact build/profile/registry binding and a bounded payload-aware gate
jointly prevent an unknown type, mark, recipe or command target from becoming an
editable opaque view. Stored marks use the same renderer policy. Native history
replays states reached within that admitted owner; explicit replacement validates
fresh native state and resets history through its real remount boundary.

This policy proves the handled type and closed-attribute/target subset. Some value
domains are narrower than the native model: the simple HTML ordered-list binding
requires `start <= 2147483647`, preserving its exact decimal string including zero.
An initially unsupported value refuses admission without changing source bytes.
A supported native command can derive a larger start, for example exiting the
middle empty item of a list starting at `2147483647` yields a trailing list starting
at `2147483649`. That actual native publication remains successful and its exact
value remains in Session; presentation failure enters explicit mounted recovery.
The adapter does not fabricate an atomic refusal or claim that the native change
was rolled back. Avoiding every state-derived value failure would require a real
native preparation seam; it is not approximated by TypeScript edit logic.

Presentations use fixed allowed tags, attributes and finite static CSS classes.
Authored text and attribute values are assigned as DOM data. Color tokens select
fixed classes; links never cause resource loading; language metadata does not load
syntax code. Unknown handlers or unsupported faithful presentation refuse
explicitly. This decision does not complete the separate OSR-67 security review.

Rollback: revert the OSR-39 changes and the paired package graph/lock updates.
Persisted document schema and bytes do not require migration.
