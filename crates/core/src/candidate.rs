// SPDX-License-Identifier: MIT OR Apache-2.0
//! Borrowed candidate access. A view never confers admission or write authority.

use crate::document::{Attributes, Mark, Primitive};

#[derive(Debug, Clone, Copy)]
pub struct BorrowedNode<'a, I> {
    pub type_id: &'a str,
    pub primitive: Primitive,
    pub attributes: &'a Attributes,
    pub marks: &'a [Mark],
    pub text: Option<&'a str>,
    pub children: &'a [I],
    pub parent: I,
}

/// The synthetic root has children but no authored semantic node/metadata.
/// Implementations must provide stable borrowed records during a validation pass.
pub trait CandidateRead {
    type Id: Copy + Eq + Ord;
    fn root(&self) -> Self::Id;
    fn roots(&self) -> &[Self::Id];
    fn node(&self, id: Self::Id) -> Option<BorrowedNode<'_, Self::Id>>;

    fn children(&self, id: Self::Id) -> Option<&[Self::Id]> {
        if id == self.root() {
            Some(self.roots())
        } else {
            self.node(id).map(|node| node.children)
        }
    }
}
