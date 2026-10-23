# Loading and failure states

The public SDK keeps Rust admission authoritative. Unsupported profiles,
extensions, versions and malformed input return typed refusals; callers retain
their original bytes. A failed replacement preserves the admitted document,
selection, history and saved revision. It does not create an empty document.

## Loading ownership

`createEditor({ input, options, loadTimeoutMs })` and the mounted adapter accept
an optional safe integer loading ceiling from 1 to 30000 milliseconds. The
default is 30000. Hosts may tighten this asynchronous waiting ceiling.
Synchronous JavaScript, Session admission and WASM execution are not preempted.
Invalid controller limits return `sdk.invalid_limit` before loading begins.

Low-level `loadSdk` and `loadSdkV2` accept the same `loadTimeoutMs` and an optional
`signal: AbortSignal`. Each reader owns its deadline and cancellation. Expiry
returns `SdkLoadError` with `code: 'sdk.load_timeout'`, `phase: 'load'`;
cancellation returns `sdk.load_cancelled` at the same phase. Invalid low-level
deadlines return `sdk.module_invalid` at phase `deadline`.

Concurrent readers still share one verified module initialization. Cancelling
one reader leaves another live reader's work intact. The last reader's departure
cancels owned fetch/body work where supported and fences late completion.
Controllers own cancellation for their default loader. An injected loader may
continue its own work; late results cannot create a disposed controller's Session.
Controller destruction retains its existing `sdk.cancelled` ready outcome.

`resources().loading_deadlines` reports the controller's owned loading deadline.
It returns to zero after readiness, refusal or destruction. Original input held
for recovery remains separate from a live Session and is released on destruction.

## Terminal runtime failure and recovery

A real `WebAssembly.RuntimeError` through the verified packaged Session retires
that module's capability in its JavaScript realm. The first failed mutation
retains the existing Fatal transport diagnostic and publication uncertainty.
Subsequent calls through old Sessions, projections or low-level loads refuse
`sdk.runtime_retired`; peer controllers become terminal when next observed.
Native resource counters from the retired instance are unavailable. JavaScript
ownership cleanup is observable separately.

Abandoning the last reader after generated singleton initialization has started
also retires the realm: a late instance must not become a new accepted cache.
Ordinary failures before singleton initialization remain retryable. Existing
seal, ABI, publisher and build identity checks still apply.

Recovery requires an explicit host action into a fresh JavaScript realm, such as
a new document. Retain the last coherent exported bytes and any provisional or
uncertain input outside the failed runtime. Load the matching verified JS/WASM
pair again and open those bytes. Resolve uncertain input explicitly; do not
silently replay or discard it. Fence old host callbacks by the host lifecycle
identity before native dispatch: fresh native serials are not cross-realm IDs.

A new Session's clean baseline does not mean that a host saved the recovered
document. Keep the host's unsaved/recovery state until its own successful
persistence and matching current snapshot acknowledgement. The fixture retains
its recovery packet across reload and preserves uncertain input separately when
the host explicitly chooses that disposition.

## Finite verification

The versioned [contract](../contracts/failure-states/v1/README.md) specifies finite
inputs, expected outcomes and observation limits. `npm run test:failure` runs
public packaged admission/resource observations and mounted DOM/runtime cases.
`npm run test:sdk` includes isolated loading deadline/cancellation probes.
Existing resource assertions are joined from their original required commands;
the collector does not rerun them or infer native process completion.

The runtime fault lane uses a separate source-bound test composition built from
the real bridge and KWDJ profile. It executes explicit compiled traps before
dispatch and after a completed native publication. Its fixture-local SDK and
WASM have their own matching identity. This proves those two fault boundaries,
not arbitrary faults inside a commit or a fault in production WASM bytes.
Browser string import is distinct from physical input and OS clipboard delivery.
Installed browser observations retain their own evidence and limitations.
