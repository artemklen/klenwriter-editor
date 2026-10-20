# Input origin authoring correction 001

Source reachability correction before the first slash browser/native acceptance run.
Frozen v1 bytes and original O04 remain unchanged. This is not an expectation
learned from candidate output.

`packages/dom/src/composition.ts:343` rejects a noncancelable event in the settled
ordinary permit path before `c.ordinary(event)` at354. Existing OSR-41 recovery/
refusal policy and its assertions remain authoritative. Therefore v1 O04's
ownedPermit=true/noncancelable ordinary-dispatch path is currently unreachable.
It is a defensive hypothetical branch, NOT_RUN as an actual admitted operation;
it must not be counted as a real native/DOM positive. Pending still retains and
propagates its private origin so a future or internal caller cannot silently
certify composition-owned input as ordinary.

The actual reachable noncancelable composition event must keep its existing41
refusal/recovery outcome and produce zero ordinary-input notifications. Tests
must exercise that real path; no private bypass establishes native acceptance.
No composition policy or prior assertion is relaxed to make the seed reachable.

Source SHA256: `3e832e4922c9553a665b9dc8ef3a2f7adc895891b48f65dd54f21d98518bf9d6`.
The source file is unchanged from accepted main396 at this correction.
