# Finite ordinary presentation coalescing

Source dataflow clarification before first mounted slash browser execution.
Multiple completed ordinary inputs can arrive before a UI animation frame;
keeping only the final event would lose the opening slash or the chain from the
last rendered frame. This follows browser synchronous event ordering, not a
candidate-learned golden.

The UI ordinary observer performs one pure bounded text_window read at the
observation after-stamp and retains one current lexical seed (range/literal, full
stamp/context) plus the latest immutable event. Each successor must start at the
previous full after-stamp/context and preserve the exact slash anchor. A new
seed still requires the frozen single slash + native before/after witness.
There is no array, semantic queue, command, bookmark, popup write or focus change
in this callback. The next existing UI RAF re-reads native current window and
checks the entire final stamp/context/range/literal before showing anything.
Foreign publication, missed/stale/refused input, disposal or ambiguous chain
closes it. Escape/Tab before first presentation clears the seed without stealing
native default. Native navigation remains native and retires presentation.

The original frozen v1 contracts/oracles remain unchanged. This clarifies bounded
observation retention; it does not change native command semantics or origin.
