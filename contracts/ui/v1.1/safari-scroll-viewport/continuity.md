# Visible viewport continuity — source addendum

Authored before the correction candidate. A document's measured content extent
is not the mapping viewport. During one original pointer program, growth or
shrinkage outside its visible intersection may change the content frame without
changing any permitted screen coordinate.

Each original pre-post check must still perform the complete bounded native
scan and validate all geometry, direct ancestry, unique WebArea, scrollbar,
original CF content/scroll identities, nonce/title/root membership, focus, root
frame and deadline. The full ScrollArea mapping rectangle and exact visible
intersection must remain equal to the original values. Scrollbar identity,
orientation and measured rectangle also remain equal. Only the content frame
outside that unchanged visible intersection may differ; it is never substituted
for the mapping viewport. The original point must pass the production mapper and
visible-content clip again before each original post.

For an independent numeric witness, the frozen SV02 content height400 and a
height500 at the same origin both yield the same483x300 visible intersection
and the same screen point110,110. A changed visible right/bottom edge or a
changed ScrollArea origin/scale cannot grant continuity. Existing pure geometry
checks still apply to every newly observed rectangle; this is not a stale proof.

Successful fallback receipts retain the actual bounded recheck proofs, including
their current content frames, separately from the initial proof. At most three
rechecks occur: initial validation and the original DOWN/UP pre-post checks.
There is no extra event, input retry, changed point or extension of the original
deadline. Earlier UNKNOWN/FAILED receipts retain their original status.
