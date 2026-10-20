# Slash and insertion picker v1 — OSR-43

Pre-candidate specification, authored on accepted main
`3960664b286b0939d3e7d8e724183eb9f7b71ee6`, tree
`0f24703a5dc7f9c1fd2689a87a8cb2afaecdaadd`. This directory contains contracts
and independently authored expectations, not execution evidence or review.
Architecture v2, master plan v3, the original four AC of OSR-43, and
`docs/m0/ux-contract.md` insertion/frame02 govern. OSR-41 and OSR-42 are Done.

Rust owns query-range validation, target eligibility, atomic replacement,
canonical output, IDs, selection and history. Optional generic UI owns only
discovery, lexical presentation, filtering, navigation and localized feedback.
It uses public DOM/SDK and has no CMS/KWDJ semantic imports, second session,
query deletion command, implicit conversion or semantic queue. Add uses the
same optional catalog/picker with a null slash range and the existing native
insert-block operation. Old profiles without slash retain their OSR-42 behavior.

Accept preserves native prefix + requested target + copied-header trailing
block topology, including empty prefix/trailing blocks and heading attributes.
An acceptance is one isolated native transaction. One Undo restores exactly the
pre-accept document including the committed literal. Ordinary character edits
have their existing isolated history; no typing/accept coalescing is invented.
Escape, Tab, no-results dismissal and native refusal retain committed text.

The typed ABI2 text-window read is pure and bounded before reply allocation;
ABI1 remains closed. It reads backward from a collapsed caret, never clones a
whole text leaf or child array. Limits are separately accounted: at most256
returned UTF-16 units,1024 visited nodes,128 ancestor depth and32768 decoded
source scalars. Cached lengths and nearest-end resolution avoid scanning a long
prefix for a tail caret. A deep interior exceeding the scan bound is an explicit
`text_window.source_scan_limit` refusal, not no-results or universal O(window).
No text-storage index, mutation, history, event cursor, bookmark, retained lease
or lazy unbounded initialization is added by this read. Detailed DTO/diagnostic
and empty/barrier/scalar cases are in the accompanying native contract.

Independent literal expectations and input source pins precede runtime code.
Existing35/39/40/41/42 contract bytes and tests remain unchanged. Authoring
corrections need a separate source rationale; candidate output is never a new
golden. Controlled events, three-engine automation, installed Safari/Chrome,
native and sealed SDK outcomes are distinct evidence lanes. Unobserved native
composition windows remain UNOBSERVED. Stopped OSR-38 campaigns remain stopped.

Required delivery: applicable focused tests, installed Chrome/Safari RU/EN,
all nine exact-head pre-send commands, one prepared build-only premerge CI,
independent Grok exact-head review, normal merge, one postmerge CI, durable
readback/hygiene then Done. CMS49/66 consumes these scenarios; this does not
claim completed CMS cutover, real AT, CJK/mobile, publication or deployment.
