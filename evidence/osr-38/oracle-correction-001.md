# Portable oracle correction 001 — conservative dirty

18.10.2026, before any native/SDK adapter executed the scenario packet.
Primary's ed1673f finite model used `text !== initialText` as dirty. Two supporting
agents independently identified the conflict with the already accepted public
contract: `docs/deltas.md` explicitly says undo always leaves conservative dirty;
`Session::dirty` in `crates/engine/src/session.rs` documents that exact equality
is checked only at an explicit export/save boundary. No such reconciliation or
acknowledgement is part of this finite scenario protocol.

This is an independently established oracle defect, not an observed engine bug.
The model now latches dirty at its first document commit, including all later
undo/redo actions. Canonical bytes/history/caret expectations are unchanged.
Hand-authored dirty traces are added to the existing literal oracle checks.
No production source, limit, AC or runtime result was changed. No production
RED/pass is claimed: only pure model tests had run against the first packet.

Original generator remains immutable in Git ed1673f, SHA256
bc6baa655304d973df5c036bed0c3faffb39baba648716d0d153e98c7113a8e9.
Original1036-case packet22,327,907 B, SHA256
bebbba600775ecee0dd3b44b7e28e9d33c16e98c0238fec6ed200d22d8edfdd5,
and its seal are preserved under
`artifacts/reliability/oracle-history/ed1673f/` before regeneration.
The new packet/seal and corrective commit identify the accepted oracle version.
