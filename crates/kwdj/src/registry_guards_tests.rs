// SPDX-License-Identifier: MIT OR Apache-2.0
//! New guard assertions reuse the pre-existing test-only tree diff oracle.
use super::*;
use crate::{KwdjProfile, KwdjProfileError};
use editor_core::profile::FrozenProfile;
use editor_core::transaction::{Operation, TransactionProfile};

fn meter() -> WorkMeter {
    WorkMeter::new(WorkLimits::default())
}
fn profile(facts: &Facts, narrow: bool) -> KwdjProfile<'_> {
    let p = KwdjProfile::new(facts, Limits::default(), AdmissionBudget::default());
    if !narrow {
        return p;
    }
    let mut d = crate::registry::registry_descriptor();
    d.mark_policy
        .insert("org.klenwriter.kwdj/text".into(), vec![]);
    p.with_registry_descriptor(&d, editor_registry::CompilerLimits::default(), &mut meter())
        .unwrap()
}
fn cache(p: &KwdjProfile<'_>, v: &View) -> crate::registry::KwdjProfileCache<usize> {
    let admitted = crate::admit_core_document(
        &v.snapshot(),
        Profile::Prose,
        &Facts::default(),
        Limits::default(),
    )
    .unwrap();
    p.seed_cache(&admitted, v, &mut meter()).unwrap()
}
fn signature(e: KwdjProfileError) -> (String, String) {
    match e {
        KwdjProfileError::Registry(e) => (e.code.as_str().into(), e.path),
        other => panic!("expected registry refusal: {other:?}"),
    }
}
fn discarded_change(before: View, index: usize) -> Changes {
    let mut after = before.clone();
    let parent = after.roots[index];
    let leaf = after.nodes[&parent].children[0];
    let record = after.nodes.get_mut(&leaf).unwrap();
    record.node.text = Some(String::new());
    record.node.marks = vec![editor_core::document::Mark {
        type_id: "org.klenwriter.kwdj/strong".into(),
        attributes: Default::default(),
    }];
    let mut replacement = record.clone();
    replacement.node.text = Some("b".into());
    replacement.node.marks.clear();
    after.nodes.insert(1_000_000 + index, replacement);
    after
        .nodes
        .get_mut(&parent)
        .unwrap()
        .children
        .push(1_000_000 + index);
    Changes::new(before, after)
}
#[test]
fn discarded_schema_metadata_scoped_equals_full_and_is_constant_across_1024_roots() {
    let facts = Facts::default();
    let p = profile(&facts, true);
    let mut baseline = None;
    for width in [1, 16, 128, 1024] {
        let before = source(
            Profile::Prose,
            Value::Array((0..width).map(|_| paragraph("a")).collect()),
        );
        let c = cache(&p, &before);
        let changes = discarded_change(before, 0);
        let mut work = meter();
        let scoped = signature(
            p.normalize_scoped(&Profile::Prose, &changes, &c, &mut work)
                .unwrap_err(),
        );
        let full = signature(
            p.normalize_candidate(&Profile::Prose, &changes, &mut meter())
                .unwrap_err(),
        );
        assert_eq!(
            scoped,
            (
                "registry.mark_not_allowed".into(),
                "/content/0/content/0/marks/0".into()
            )
        );
        assert_eq!(scoped, full);
        assert_eq!(work.trace().phase(WorkPhase::FullFallback).visits, 0);
        let measured = (work.usage(), work.trace());
        if let Some(expected) = baseline {
            assert_eq!(measured, expected, "width {width}");
        } else {
            baseline = Some(measured);
        }
    }
}
#[test]
fn discarded_guard_preserves_numeric_source_order_and_exact_current_paths() {
    let facts = Facts::default();
    let p = profile(&facts, true);
    let before = source(
        Profile::Prose,
        Value::Array((0..16).map(|_| paragraph("a")).collect()),
    );
    let c = cache(&p, &before);
    let first = discarded_change(before, 10);
    let changes = discarded_change(first.after, 2);
    // Both poisoned originals are current targets; source index2 must be first,
    // independently of ID sort order or the lexicographic "10"/"2" ordering.
    let original = changes.after.clone();
    let id2 = original.nodes[&original.roots[2]].children[0];
    let id10 = original.nodes[&original.roots[10]].children[0];
    let ops = vec![
        Operation::Remove { node: id10 },
        Operation::Remove { node: id2 },
    ];
    let err = crate::registry_guards::discarded(
        p.registry(),
        &original,
        &ops,
        AdmissionBudget::default(),
        &mut meter(),
        |id, w| current_path(&changes, &c.domain, id, w),
    )
    .unwrap_err();
    assert_eq!(
        signature(err),
        (
            "registry.mark_not_allowed".into(),
            "/content/2/content/0/marks/0".into()
        )
    );
}
#[test]
fn empty_normalization_has_zero_extra_guard_work_and_never_requests_a_path() {
    let facts = Facts::default();
    let p = profile(&facts, true);
    let v = source(Profile::Prose, json!([paragraph("a")]));
    let mut w = meter();
    let before = w.usage();
    let trace = w.trace();
    crate::registry_guards::discarded(
        p.registry(),
        &v,
        &[],
        AdmissionBudget::default(),
        &mut w,
        |_, _| panic!("no discarded source"),
    )
    .unwrap();
    assert_eq!(w.usage(), before);
    assert_eq!(w.trace(), trace);
}
#[test]
fn missing_domain_proof_and_mismatched_schema_digest_cannot_authorize_metadata() {
    let facts = Facts::default();
    let narrow = profile(&facts, true);
    let ordinary = profile(&facts, false);
    let before = source(
        Profile::Prose,
        json!([paragraph("a"), paragraph("untouched")]),
    );
    let changes = discarded_change(before.clone(), 0);
    let mut w = meter();
    let missing = signature(
        narrow
            .normalize_scoped(&Profile::Prose, &changes, &Default::default(), &mut w)
            .unwrap_err(),
    );
    assert_eq!(
        missing,
        (
            "registry.mark_not_allowed".into(),
            "/content/0/content/0/marks/0".into()
        )
    );
    assert!(w.trace().phase(WorkPhase::FullFallback).visits > 0);
    let c = cache(&ordinary, &before);
    let mut after = before.clone();
    let leaf = after.first_text();
    after.nodes.get_mut(&leaf).unwrap().node.marks = vec![editor_core::document::Mark {
        type_id: "org.klenwriter.kwdj/strong".into(),
        attributes: Default::default(),
    }];
    let changes = Changes::new(before, after);
    let mut w = meter();
    let scoped = signature(
        narrow
            .validate_scoped(&Profile::Prose, &changes, &c, &mut w)
            .err()
            .expect("different digest must not reuse allowed marks"),
    );
    let full = signature(
        narrow
            .validate_candidate(&Profile::Prose, &changes, &mut meter())
            .unwrap_err(),
    );
    assert_eq!(scoped, full);
    assert_eq!(scoped.0, "registry.mark_not_allowed");
    assert!(w.trace().phase(WorkPhase::FullFallback).visits > 0);
}
