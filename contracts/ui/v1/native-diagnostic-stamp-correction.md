# Source-only diagnostic stamp correction before OSR-42 runtime freeze

The original markdown01 `/tmp/osr-42-nesting-vectors-source-01.md` (SHA256 `ac16de8dde516da17def78ab52ef3ee4f3da88399250f08cccd022c50be773a1`) remains unchanged historical authoring data. Its blanket `stamp:null` statement for both availability and execution refusals is incorrect at the public bridge boundary. This correction was derived from source, with no editor/native/WASM/candidate execution or output learning.

`crates/bridge/src/lib.rs:532–556` embeds a freshly projected diagnostic in an Ok Availability reply, so that INNER diagnostic keeps stamp:null. `Bridge::boundary`, same file:403–410, takes an execution Err and fills diagnostic.stamp from current Session stamp when absent. Thus actual public execution Refused has the exact unchanged current FULL StampDto. It does not have stamp:null. No committed mutation is inferred: may_have_committed remains false and all baseline facets/events remain unchanged.

The machine-readable `/tmp/osr-42-nesting-oracles-source-01.json` distinguishes those two exact shapes for N03/N04/N06/N08. Opaque session/generation placeholders bind once to the real baseline; revision0/selection_epoch1/history_epoch0 are explicit fresh-session setup counters. All diagnostic code/path/category/details and canonical expectations remain unchanged. The file is source-authored template data; no copied token or wildcard is an actual native ID. Root should use corrected machine data rather than the inaccurate old markdown sentence/diagnostic stamp when freezing.

Source proof pin: `crates/bridge/src/lib.rs` SHA256 `1d59524a4db8ac7de9793f9ccd352e34f18c7e2da55b8b408690ed1ce2016600`, already matched Git857 in markdown source pins. No repository edits.
