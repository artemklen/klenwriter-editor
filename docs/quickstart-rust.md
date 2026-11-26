# Native Rust quickstart

Open a KWDJ document, insert a character through the typed editor command, and export canonical JSON. The same example checks the typed refusal for an unsupported schema.

This walkthrough uses unpublished KlenWriter Editor bootstrap crates at version `0.0.0`. Use Rust `1.97.1` for the editing engine and Python 3.12 or later for the archive helper. Prepare the locked public Cargo dependencies once with `cargo +1.97.1 fetch --locked` from the repository root. The commands below use Cargo's offline mode.

## Package and run

From the repository root, choose a fresh output directory for the local archives.

```sh
archive_root="$(mktemp -d)"
python3 examples/native-quickstart/run.py pack "$archive_root/crates"
python3 examples/native-quickstart/run.py run "$archive_root/crates"
```

If you already have the verified archive directory, start with `run`. The helper checks its archive hashes and resolves all four editor crates from those archives in a separate Cargo project. It then runs `cargo +1.97.1 run --offline --locked --example quickstart`.

The example uses the current session key, document revision and selection epoch for a command. Its caret is a UTF-16 offset into the admitted text leaf. The sample contains plain text, so its host reports media and reference IDs as missing.

```rust
// SPDX-License-Identifier: MIT OR Apache-2.0
use klenwriter_editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
use klenwriter_editor_core::profile::{AdmissionMode, FrozenProfile};
use klenwriter_editor_engine::{
    AccessMode, CommandOutcome, CommandRequest, DispatchOutcome, Session, SessionError,
};
use klenwriter_editor_kwdj::commands::KwdjIntent;
use klenwriter_editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjErrorCode,
    KwdjProfile, KwdjProfileError, Limits,
};
use uuid::Uuid;

struct NoIdentities;

impl IdentityResolver for NoIdentities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Missing)
    }

    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Missing)
    }
}

fn main() {
    let input = br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}"#;
    let open = |bytes: &[u8]| {
        let profile =
            KwdjProfile::new(&NoIdentities, Limits::default(), AdmissionBudget::default());
        let binding = profile.binding().clone();
        Session::open(
            profile,
            &binding,
            bytes,
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
    };

    let mut session = open(input).expect("admit the valid KWDJ document");
    let key = session.key();
    let root = session.root(key).unwrap();
    let paragraph = session.node(key, root).unwrap().children()[0];
    let leaf = session.node(key, paragraph).unwrap().children()[0];
    let caret = Position::Text {
        leaf,
        utf16: Utf16Offset::new(5),
        affinity: Affinity::After,
    };
    session
        .set_selection(
            key,
            session.revision(),
            Selection {
                anchor: caret,
                focus: caret,
            },
        )
        .unwrap();
    let request = CommandRequest::new(
        key,
        session.revision(),
        session.selection_epoch(),
        KwdjIntent::InsertText { text: "!".into() },
    );
    assert!(matches!(
        session.execute_command(&request),
        CommandOutcome::Completed {
            outcome: DispatchOutcome::Changed(_),
            ..
        }
    ));

    let exported = session.export_snapshot(key, session.revision()).unwrap();
    let expected = br#"{"content":[{"content":[{"text":"Hello!","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#;
    assert_eq!(exported, expected);
    println!("{}", std::str::from_utf8(&exported).unwrap());

    let invalid =
        br#"{"schema":"other.document","schema_version":1,"profile":"prose","content":[]}"#;
    let Err(SessionError::Profile(KwdjProfileError::Document(error))) = open(invalid) else {
        panic!("expected a typed KWDJ admission refusal");
    };
    assert_eq!(error.code, KwdjErrorCode::UnsupportedSchema);
    assert_eq!(error.path, "/schema");
    println!("{} at {}", error.code.as_str(), error.path);
}
```

The first output line is the canonical KWDJ document containing `Hello!`. The second line is `kwdj.unsupported_schema at /schema`. The final receipt lists the producer revision, crate versions and archive SHA-256 hashes.

[Runnable example](../examples/native-quickstart/examples/quickstart.rs) · [Native command contract](commands.md)
