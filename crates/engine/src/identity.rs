// SPDX-License-Identifier: MIT OR Apache-2.0
//! Process-local opaque identities. These tokens never enter a profile codec.

use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

/// Hard bound checked before token traversal or numeric parsing.
pub const MAX_IDENTITY_TOKEN_BYTES: usize = 128;

/// Transport syntax/namespace errors; none grants node liveness or admission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityTokenError {
    TooLong,
    InvalidFormat,
    UnsupportedVersion,
    InvalidNumber,
    ForeignSession,
}
impl IdentityTokenError {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TooLong => "identity.token_too_long",
            Self::InvalidFormat => "identity.invalid_token",
            Self::UnsupportedVersion => "identity.unsupported_token_version",
            Self::InvalidNumber => "identity.invalid_token_number",
            Self::ForeignSession => "session.stale_session",
        }
    }
}
impl std::fmt::Display for IdentityTokenError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}
impl std::error::Error for IdentityTokenError {}

fn token_fields<const N: usize>(token: &str, prefix: &str) -> Result<[u64; N], IdentityTokenError> {
    if token.len() > MAX_IDENTITY_TOKEN_BYTES {
        return Err(IdentityTokenError::TooLong);
    }
    if !token.is_ascii() {
        return Err(IdentityTokenError::InvalidFormat);
    }
    let mut parts = token.split(':');
    let kind = parts.next().ok_or(IdentityTokenError::InvalidFormat)?;
    if kind != prefix {
        let family = prefix.as_bytes()[0];
        return Err(
            if kind.as_bytes().first() == Some(&family)
                && kind.len() > 1
                && kind[1..].bytes().all(|b| b.is_ascii_digit())
            {
                IdentityTokenError::UnsupportedVersion
            } else {
                IdentityTokenError::InvalidFormat
            },
        );
    }
    let mut values = [0; N];
    for value in &mut values {
        let part = parts.next().ok_or(IdentityTokenError::InvalidFormat)?;
        if part.is_empty() || part.starts_with('0') || !part.bytes().all(|b| b.is_ascii_digit()) {
            return Err(IdentityTokenError::InvalidNumber);
        }
        *value = part
            .parse()
            .map_err(|_| IdentityTokenError::InvalidNumber)?;
    }
    if parts.next().is_some() {
        return Err(IdentityTokenError::InvalidFormat);
    }
    Ok(values)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SessionKey {
    serial: u64,
    generation: u64,
}

impl SessionKey {
    pub(crate) fn allocate() -> Option<Self> {
        NEXT_SESSION
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |next| {
                next.checked_add(1)
            })
            .ok()
            .map(|serial| Self {
                serial,
                generation: 1,
            })
    }

    pub(crate) fn next_generation(self) -> Option<Self> {
        Some(Self {
            generation: self.generation.checked_add(1)?,
            ..self
        })
    }

    pub fn generation(self) -> u64 {
        self.generation
    }

    /// Canonical process-local session address, independent of persisted data.
    pub fn to_token(self) -> String {
        format!("s1:{}:{}", self.serial, self.generation)
    }

    pub fn matches_token(self, token: &str) -> bool {
        token_fields::<2>(token, "s1").is_ok_and(|[serial, generation]| {
            serial == self.serial && generation == self.generation
        })
    }

    /// Decode only within this exact namespace/generation. This intentionally
    /// does not assert current liveness: retired IDs remain useful for mapping.
    /// Reads and mutations still apply their normal native node/position guards.
    pub fn parse_node_token(self, token: &str) -> Result<NodeId, IdentityTokenError> {
        let [serial, generation, node] = token_fields::<3>(token, "n1")?;
        if serial != self.serial || generation != self.generation {
            return Err(IdentityTokenError::ForeignSession);
        }
        Ok(NodeId::new(self, node))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct NodeId {
    session: SessionKey,
    serial: u64,
}

impl NodeId {
    pub(crate) fn new(session: SessionKey, serial: u64) -> Self {
        Self { session, serial }
    }

    pub fn session(self) -> SessionKey {
        self.session
    }

    /// Canonical address token. It is not a profile document or a liveness proof.
    pub fn to_token(self) -> String {
        format!(
            "n1:{}:{}:{}",
            self.session.serial, self.session.generation, self.serial
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn namespaces_and_generation_do_not_alias() {
        let a = SessionKey::allocate().unwrap();
        let b = SessionKey::allocate().unwrap();
        assert_ne!(NodeId::new(a, 1), NodeId::new(b, 1));
        assert_ne!(
            NodeId::new(a, 1),
            NodeId::new(a.next_generation().unwrap(), 1)
        );
        let max = SessionKey {
            serial: 1,
            generation: u64::MAX,
        };
        assert_eq!(max.next_generation(), None);
    }

    #[test]
    fn canonical_tokens_round_trip_exact_native_and_max_u64_identities() {
        let key = SessionKey {
            serial: 7,
            generation: 3,
        };
        let node = NodeId::new(key, 5);
        assert_eq!(key.to_token(), "s1:7:3");
        assert_eq!(node.to_token(), "n1:7:3:5");
        assert!(key.matches_token("s1:7:3"));
        assert_eq!(key.parse_node_token("n1:7:3:5"), Ok(node));
        let max = SessionKey {
            serial: u64::MAX,
            generation: u64::MAX,
        };
        let id = NodeId::new(max, u64::MAX);
        assert_eq!(
            max.to_token(),
            "s1:18446744073709551615:18446744073709551615"
        );
        assert_eq!(
            id.to_token(),
            "n1:18446744073709551615:18446744073709551615:18446744073709551615"
        );
        assert!(id.to_token().len() <= MAX_IDENTITY_TOKEN_BYTES);
        assert!(max.matches_token(&max.to_token()));
        assert_eq!(max.parse_node_token(&id.to_token()), Ok(id));
        let native = SessionKey::allocate().unwrap();
        assert!(native.matches_token(&native.to_token()));
        assert_eq!(
            native.parse_node_token(&NodeId::new(native, 1).to_token()),
            Ok(NodeId::new(native, 1))
        );
    }

    #[test]
    fn token_parser_refuses_noncanonical_zero_signed_overflow_and_unbounded_inputs() {
        let key = SessionKey {
            serial: 7,
            generation: 3,
        };
        for value in [
            "n1:0:3:5",
            "n1:7:0:5",
            "n1:7:3:0",
            "n1:07:3:5",
            "n1:7:03:5",
            "n1:7:3:05",
            "n1:+7:3:5",
            "n1:7:-3:5",
            "n1:7:3:5.0",
            "n1:7:3:5e0",
            "n1:7:3:0x5",
            "n1:7:3: 5",
            "n1:7:3:5\n",
            "n1:18446744073709551616:3:5",
            "n1:7:3:18446744073709551616",
        ] {
            assert_eq!(
                key.parse_node_token(value),
                Err(IdentityTokenError::InvalidNumber),
                "{value:?}"
            );
        }
        for value in [
            "",
            "n1",
            "n1:7:3",
            "n1:7:3:5:",
            "n1:7:3:5:6",
            "s1:7:3:5",
            "N1:7:3:5",
            "n1:７:3:5",
        ] {
            assert_eq!(
                key.parse_node_token(value),
                Err(IdentityTokenError::InvalidFormat),
                "{value:?}"
            );
        }
        for value in ["n0:7:3:5", "n2:7:3:5"] {
            assert_eq!(
                key.parse_node_token(value),
                Err(IdentityTokenError::UnsupportedVersion)
            );
        }
        assert_eq!(
            key.parse_node_token(&"n".repeat(MAX_IDENTITY_TOKEN_BYTES + 1)),
            Err(IdentityTokenError::TooLong)
        );
        for value in [
            "s1:0:3",
            "s1:7:0",
            "s1:07:3",
            "s1:7:03",
            "s1:7:3:",
            "s2:7:3",
            "s1:7:18446744073709551616",
        ] {
            assert!(!key.matches_token(value), "{value:?}");
        }
        assert!(!key.matches_token(&"s".repeat(MAX_IDENTITY_TOKEN_BYTES + 1)));
    }

    #[test]
    fn decoded_tokens_are_bound_to_expected_namespace_and_generation() {
        let key = SessionKey {
            serial: 7,
            generation: 3,
        };
        for foreign in [
            SessionKey {
                serial: 8,
                generation: 3,
            },
            SessionKey {
                serial: 7,
                generation: 4,
            },
        ] {
            assert!(!key.matches_token(&foreign.to_token()));
            assert_eq!(
                key.parse_node_token(&NodeId::new(foreign, 5).to_token()),
                Err(IdentityTokenError::ForeignSession)
            );
        }
        for (error, code) in [
            (IdentityTokenError::TooLong, "identity.token_too_long"),
            (IdentityTokenError::InvalidFormat, "identity.invalid_token"),
            (
                IdentityTokenError::UnsupportedVersion,
                "identity.unsupported_token_version",
            ),
            (
                IdentityTokenError::InvalidNumber,
                "identity.invalid_token_number",
            ),
            (IdentityTokenError::ForeignSession, "session.stale_session"),
        ] {
            assert_eq!(error.as_str(), code);
            assert_eq!(error.to_string(), code);
        }
    }

    #[test]
    fn retired_node_token_round_trips_without_conferring_live_read_authority() {
        use crate::tree::AddressTree;
        use editor_core::document::{Attributes, Document, Node, Primitive};
        let key = SessionKey::allocate().unwrap();
        let mut tree = AddressTree::from_document(
            key,
            Document {
                children: vec![Node {
                    type_id: "org.example/paragraph".into(),
                    primitive: Primitive::TextBlock,
                    attributes: Attributes::new(),
                    marks: vec![],
                    text: None,
                    children: vec![],
                }],
            },
        )
        .unwrap();
        let id = tree.node(tree.root()).unwrap().children()[0];
        let token = id.to_token();
        let mut draft = tree.prepare();
        let _retired = draft.detach(id).unwrap();
        let patch = draft.prepare_patch().unwrap();
        tree.publish(patch, 1);
        assert!(tree.node(id).is_err());
        assert_eq!(key.parse_node_token(&token), Ok(id));
        assert_eq!(
            key.next_generation().unwrap().parse_node_token(&token),
            Err(IdentityTokenError::ForeignSession)
        );
    }
}
