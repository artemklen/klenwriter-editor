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

/// Engine-prepared invalidation forest, including old and final parent edges.
/// The synthetic root may occur here but is never a semantic direct change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirtyNode<I> {
    pub id: I,
    pub direct: bool,
    pub payload_changed: bool,
    pub children_changed: bool,
    pub before_parent: Option<I>,
    pub after_parent: Option<I>,
    pub before_ordinal: Option<usize>,
    pub after_ordinal: Option<usize>,
    /// Sorted union of dirty child edges in the original and candidate trees.
    pub dirty_children: Vec<I>,
}

/// A stable, metered engine impact prepared from an admitted baseline.
///
/// IDs and forest records are sorted and unique. Ancestor-only records expose
/// dirty edges without requiring enumeration of every unaffected sibling.
/// A stamp identifies successful primitive frames within this draft, not a
/// document revision. Preparing another primitive invalidates the borrowed view.
/// The engine is responsible for complete, exact invalidation relative to the
/// cache's admitted baseline. Trusted profiles may reuse unchanged proofs; a
/// caller-authored partial forest cannot confer admission or write authority.
pub trait CandidateChanges: CandidateRead {
    fn before_node(&self, id: Self::Id) -> Option<BorrowedNode<'_, Self::Id>>;
    fn before_roots(&self) -> &[Self::Id];
    fn direct_changes(&self) -> &[Self::Id];
    fn dirty_forest(&self) -> &[DirtyNode<Self::Id>];
    fn roots_changed(&self) -> bool;
    fn mutation_stamp(&self) -> u64;
}
