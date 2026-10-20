# Installed command payload projection

Source correction before the installed coordinator's first candidate execution.
The installed-v1 source semantic goldens retain abbreviated `command.payload`
objects. Complete native CommandDto comparisons must include the existing
Rust-tagged intent discriminator. This adds no native field or new command.

`packages/kwdj/src/index.ts` passes the full KwdjIntentDto to createCommand.
`crates/kwdj-sdk/src/wire.rs` declares its closed serde tagged intent with
`kind`; `crates/kwdj/src/commands/mod.rs` maps the corresponding native intents.
The complete expected payload is the source-authored payload plus:

| Golden / command | Required payload.kind |
| --- | --- |
| K01-en, K01-ru, K02 / accept-slash | accept_slash |
| K04 / insert-block | insert_block |
| K08/K09 and every ordinary insert-text | insert_text |

Compare the full parsed payload_json object, exact command ID and all original
fields with no extra keys. Keep original native request bytes in evidence.
The existing installed freeze selection of the current native After caret still
applies. No alternate kind, normalization, candidate-derived expected value or
omission of the discriminator is accepted. The installed-v1 bytes are preserved.
