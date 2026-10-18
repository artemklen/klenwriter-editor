// SPDX-License-Identifier: MIT OR Apache-2.0
//! Typed profile-owned proof state; the Session alone owns publication.

use crate::transaction::ValidationStats;

/// Empty Default means that no incremental proof is available. Prepared sparse
/// patches own all recoverable work/resource checks before publication; publish
/// cannot refuse. This is not an allocator-free or recoverable-OOM guarantee:
/// standard collection ownership transfers may still allocate.
pub trait CandidateCache: Default {
    type Patch;
    fn publish(&mut self, patch: Self::Patch);
}

impl CandidateCache for () {
    type Patch = ();
    fn publish(&mut self, (): ()) {}
}

pub enum CacheUpdate<C: CandidateCache> {
    Replace(C),
    Patch(C::Patch),
}

impl<C: CandidateCache> CacheUpdate<C> {
    /// No validation, resource checks or recoverable errors belong here.
    pub fn publish(self, cache: &mut C) {
        match self {
            Self::Replace(next) => *cache = next,
            Self::Patch(patch) => cache.publish(patch),
        }
    }
}

pub struct PreparedValidation<C: CandidateCache> {
    pub stats: ValidationStats,
    pub cache: CacheUpdate<C>,
}
