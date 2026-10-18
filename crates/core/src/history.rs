// SPDX-License-Identifier: MIT OR Apache-2.0
//! Final typing validation for exact history replay, independent of a catalog.

use crate::candidate::CandidateRead;
use crate::commands::CommandProvider;
use crate::document::Mark;
use crate::positions::Selection;
use crate::transaction::{TransactionProfile, WorkMeter};

/// Replay validates a saved typing context against the final candidate and
/// current synchronous profile facts. The engine additionally requires exact
/// equality with the saved marks, including None versus Some(empty).
///
/// A transaction-only profile can implement this without a command catalog.
/// Command providers use their existing finalizer through the blanket impl.
pub trait HistoryProfile: TransactionProfile {
    fn finalize_history_typing<V: CandidateRead>(
        &self,
        context: &Self::Context,
        final_view: &V,
        final_selection: Option<Selection<V::Id>>,
        saved: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error>;

    fn history_error_code(error: &Self::Error) -> &'static str;
}

impl<P: CommandProvider> HistoryProfile for P {
    fn finalize_history_typing<V: CandidateRead>(
        &self,
        context: &Self::Context,
        final_view: &V,
        final_selection: Option<Selection<V::Id>>,
        saved: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.finalize_typing_override(context, final_view, final_selection, saved, work)
    }

    fn history_error_code(error: &Self::Error) -> &'static str {
        Self::error_code(error)
    }
}
