// SPDX-License-Identifier: MIT OR Apache-2.0
//! Process-local opaque identities. These tokens never enter a profile codec.

use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

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
}
