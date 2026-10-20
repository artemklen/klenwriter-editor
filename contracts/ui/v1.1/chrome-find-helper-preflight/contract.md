# CW01 — one closed Chrome Find helper preflight

Status: SOURCE_AUTHORED_BEFORE_CANDIDATE. Chrome21 remains FAILED. Its Node
budget fell from959ms before the CG helper to7ms before the independent post-AX
proof, while the helper reported161.990167ms internally. The approximately790ms
residual has no recorded per-process wall attribution. Cold executable/framework
loading is a hypothesis, not an established cause or performance guarantee.

## One fixed preparation, no authority

Only Chrome, after its ordinary helper compilation/pinning and before browser
creation or any physical gesture, invokes the SAME fresh `findKeyHelper` exactly
once with exactly `['--request','{}']`. There is no caller-supplied payload,
fallback, retry or repeated sampling. This local closed stage uses spawnSync
directly; existing normal run() exit policy, commands and transport dispatch are
not generalized. Timeout is5000ms, stdout/stderr buffer bound32768bytes each,
unchanged parent environment/cwd. Failure aborts before creating the browser.

Current find-key.swift validates the closed request before AX calls or ANY CG
source/event allocation. Empty object fails that validation; the existing emit
path exits2 with zero posts and no core. The binary/interface/source do not
change. A preflight reply is never an input guard, native Find episode, key ACK,
readiness token or positive installed result. It warms only this executable's
invalid-request/load/JSON-output path; no AX/CG initialization benefit is claimed.

## Exact original reply and evidence

Preserve raw stdout/stderr, actual returnCode2, signal/error, fixed argv and
monotonic parent wallTimeMs. Require no process error/signal and empty stderr;
JSON-parse the entire bounded stdout. Require exactly14 top-level members:
`format,status,delivery,method,request,programId,program,postedTransitions,
postedCount,preflightProofs,core,postcondition,diagnostic,elapsedMs`.

Values are fixed: format `osr42-chrome-find-key-result/1`, status `refused`,
delivery `not_sent`, method `CGEvent/cghidEventTap`, request `{}`, programId null,
program null, postedTransitions `[]`, postedCount0, preflightProofs `[]`, core
null. Postcondition has exactly six fields: status `not_attempted`, expectedPhase
null, observedPhase null, reads0, proof null, diagnostic null. Top diagnostic has
exactly code `request` and reason `Invalid closed request`. elapsedMs is an actual
finite nonnegative number <=5000; it never changes normal action budgets.

Pin actual helper bytes/hash/mode immediately before and after; they must match
each other and the already recorded helper artifact. Keep a stage row containing
those pins and the actual execution. Stage status PASSED/validationExitCode0
means ONLY that the expected refusal was validated; raw process returnCode stays
2. An unexpected rc0, truncated/malformed/extra-field reply, wrong nested value,
timeout/signal/error/stderr or helper mutation gives stage FAILED/validationExitCode1
and preserves original evidence. Do not change a nonzero child exit into a
fabricated successful execution receipt.

Add optional observational `wallTimeMs` to the coordinator's existing run()
receipts: parent process.hrtime immediately before spawnSync and immediately
after it returns, converted to milliseconds. This field includes startup/output/
termination observed by the parent and is distinct from helper elapsedMs. It
changes no spawn argv, timeout, result/exception policy or accepted output.
Existing injected execution stubs need not invent that field. No timing field
grants authority; no real-time completion bound beyond the existing APIs is
claimed. Pure source/invalid-request controls do not establish a speedup.

All original page/nonce/mount/case/PID/root/CF-focus checks, per-event ownership,
CG program/postcondition, independent fresh post-Find Swift proof and SAME
original one-second action budget remain. No guard is removed or rebased, no
native result is replaced, no event retry/UP waiver/semantic replay is added.
All existing177 units/assertions and browser216/972 inventory remain unchanged.
Future actual installed execution is still required; old reports are immutable.
