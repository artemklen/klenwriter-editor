// SPDX-License-Identifier: MIT OR Apache-2.0
//! Actual target-local phase observations. Only portable semantic assertions
//! enter native/WASM equality; allocation/work byte counts remain diagnostics.
use super::*;
use editor_core::transaction::{WorkTrace, WorkUsage};

pub(super) fn paragraph(text: &str) -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}
pub(super) fn envelope(content: Value, poetry: bool) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":if poetry{"poetry"}else{"prose"},"content":content})
}
pub(super) fn fixture(kind: &str, size: usize) -> (Value, Vec<usize>, usize, usize) {
    match kind {
        "roots" => (
            envelope(
                json!((0..size).map(|_| paragraph("a")).collect::<Vec<_>>()),
                false,
            ),
            vec![0, 0],
            size * 2,
            size,
        ),
        "quote" => (
            envelope(
                json!([{"type":"blockquote","content":(0..size).map(|_|paragraph("a")).collect::<Vec<_>>() }]),
                false,
            ),
            vec![0, 0, 0],
            size * 2 + 1,
            size,
        ),
        "verse" => (
            envelope(
                json!([{"type":"verse","content":(0..size).map(|_|json!({"type":"verse_line","content":[{"type":"text","text":"a"}]})).collect::<Vec<_>>() }]),
                true,
            ),
            vec![0, 0, 0],
            size * 2 + 1,
            size,
        ),
        "styled" => (
            envelope(
                json!([{"type":"paragraph","content":(0..size).map(|i|if i%2==0{json!({"type":"text","text":"a","marks":[{"type":"strong"}]})}else{json!({"type":"text","text":"a"})}).collect::<Vec<_>>() }]),
                false,
            ),
            vec![0, 0],
            size + 1,
            size,
        ),
        "leaf" => (
            envelope(json!([paragraph(&"a".repeat(size))]), false),
            vec![0, 0],
            2,
            size,
        ),
        "depth" => {
            let mut node = paragraph("a");
            for _ in 0..size {
                node = json!({"type":"blockquote","content":[node]});
            }
            (
                envelope(json!([node]), false),
                vec![0; size + 2],
                size + 2,
                1,
            )
        }
        "table" => (
            envelope(
                json!([{"type":"table","content":(0..size).map(|_|json!({"type":"table_row","content":[{"type":"table_cell","content":[paragraph("a")]}]})).collect::<Vec<_>>() }]),
                false,
            ),
            vec![0, 0, 0, 0, 0],
            size * 4 + 1,
            size,
        ),
        _ => panic!("unknown shape {kind}"),
    }
}
const PHASES: [(WorkPhase, &str); 13] = [
    (WorkPhase::Structure, "structure"),
    (WorkPhase::Header, "header"),
    (WorkPhase::Preflight, "preflight"),
    (WorkPhase::Normalization, "normalization"),
    (WorkPhase::Serialization, "serialization"),
    (WorkPhase::StaticValidation, "static_validation"),
    (WorkPhase::Identity, "identity"),
    (WorkPhase::CacheReuse, "cache_reuse"),
    (WorkPhase::CacheUpdate, "cache_update"),
    (WorkPhase::Impact, "impact"),
    (WorkPhase::Event, "event"),
    (WorkPhase::Export, "export"),
    (WorkPhase::FullFallback, "full_fallback"),
];
pub(super) fn trace_json(trace: WorkTrace, work: WorkUsage) -> Value {
    let phases = PHASES
        .into_iter()
        .map(|(phase, name)| {
            let p = trace.phase(phase);
            (name.into(), json!({"visits":p.visits,"bytes":p.bytes}))
        })
        .collect::<serde_json::Map<String, Value>>();
    json!({"logical_work":{"units":work.units,"bytes":work.bytes},"phases":phases})
}
fn flat_signature(trace: WorkTrace) -> [editor_core::transaction::PhaseUsage; 4] {
    [
        WorkPhase::Header,
        WorkPhase::Normalization,
        WorkPhase::StaticValidation,
        WorkPhase::Serialization,
    ]
    .map(|p| trace.phase(p))
}
pub fn observe() -> Value {
    let mut portable = vec![];
    let mut diagnostics = vec![];
    for kind in [
        "roots", "quote", "verse", "styled", "leaf", "depth", "table",
    ] {
        let sizes: &[usize] = match kind {
            "leaf" => &[1, 64, 4096],
            "depth" => &[0, 4, 12],
            "table" => &[1, 16, 128],
            _ => &[1, 16, 128, 1024],
        };
        let mut signature = None;
        for &size in sizes {
            let (value, path, nodes, bytes) = fixture(kind, size);
            let (mut s, calls) = open(&value, false, EventLimits::default(), AccessMode::Editable);
            let leaf = at(&s, &path);
            let root = at(&s, &[]);
            let initial = s.node_at(s.key(), 0, root).unwrap().stats;
            assert_eq!(initial.authored_nodes, nodes);
            assert_eq!(initial.text_utf8, bytes);
            assert_eq!(initial.text_utf16, bytes);
            let tx = replace(&s, leaf, 0, 1, "b");
            let event = raw(&mut s, &calls, tx);
            assert_eq!(
                event.trace.phase(WorkPhase::FullFallback).visits,
                0,
                "ordinary {kind} fallback at size {size}"
            );
            assert_eq!(event.trace.phase(WorkPhase::Export).visits, 0);
            assert!(event.trace.phase(WorkPhase::Header).visits > 0);
            assert!(event.trace.phase(WorkPhase::Event).visits > 0);
            assert!(event.trace.phase(WorkPhase::Impact).visits > 0);
            let after = s.node_at(s.key(), 1, root).unwrap().stats;
            assert_eq!(after, initial);
            assert_eq!(
                s.node(s.key(), leaf).unwrap().text().unwrap().as_bytes()[0],
                b'b'
            );
            let actual = s.export_snapshot_receipt(s.key(), 1).unwrap();
            assert_eq!(actual.stamp().revision, 1);
            assert_eq!(actual.event_cursor(), event.notification.cursor());
            let mut expected = value.clone();
            let mut n = &mut expected["content"];
            for &index in &path[..path.len() - 1] {
                n = &mut n[index]["content"];
            }
            let text = n[path[path.len() - 1]]["text"].as_str().unwrap().to_owned();
            n[path[path.len() - 1]]["text"] = json!(format!("b{}", &text[1..]));
            assert_eq!(actual.document(), canonical_expected(&expected));
            let flat = matches!(kind, "roots" | "quote" | "verse" | "styled" | "table");
            if flat {
                let now = flat_signature(event.trace);
                if let Some(first) = signature {
                    assert_eq!(
                        now, first,
                        "unrelated {kind} width {size} changed static/header/serialization/normalization work"
                    );
                } else {
                    signature = Some(now);
                }
            }
            portable.push(json!({"shape":kind,"size":size,"status":"passed","authored_nodes":nodes,"text_utf8":bytes,"text_utf16":bytes,"header_visits":event.trace.phase(WorkPhase::Header).visits,"full_fallback_visits":0,"ordinary_export_visits":0,"ordinary_codec_hooks":0,"unchanged_width_profile_work_flat":flat}));
            diagnostics.push(json!({"shape":kind,"size":size,"trace":trace_json(event.trace,event.work),"export_trace":trace_json(actual.trace(),Default::default())}));
        }
    }
    // Structural child-vector/subtree scopes are allowed to grow with affected
    // width. Preserve the actual traces rather than call them constant-time.
    for width in [1, 16, 128, 1024] {
        let value = envelope(
            json!((0..=width).map(|_| paragraph("a")).collect::<Vec<_>>()),
            false,
        );
        let (mut s, calls) = open(&value, false, EventLimits::default(), AccessMode::Editable);
        let root = at(&s, &[]);
        let node = at(&s, &[0]);
        let leaf = at(&s, &[0, 0]);
        let tx = Transaction::new(s.key(), 0, vec![Operation::Remove { node: node.into() }]);
        let event = raw(&mut s, &calls, tx);
        let EventKind::Document { impact, .. } = event.notification.kind() else {
            panic!("missing delete delta")
        };
        let mut removed = vec![node, leaf];
        removed.sort();
        assert_eq!(impact.removed, removed);
        assert!(impact.upserted.is_empty());
        assert_eq!(impact.ancestors_before, vec![root, node]);
        assert_eq!(impact.ancestors_after, vec![root]);
        assert!(impact.root_order_changed);
        assert_eq!(
            s.node_at(s.key(), 1, root).unwrap().stats.authored_nodes,
            width * 2
        );
        assert_eq!(event.trace.phase(WorkPhase::FullFallback).visits, 0);
        portable.push(json!({"shape":"delete","size":width,"status":"passed","removed_nodes":2,"remaining_nodes":width*2,"ordinary_codec_hooks":0}));
        diagnostics.push(
            json!({"shape":"delete","size":width,"trace":trace_json(event.trace,event.work)}),
        );
        let value = envelope(
            json!([{"type":"blockquote","content":(0..=width).map(|_|paragraph("a")).collect::<Vec<_>>()},{"type":"blockquote","content":[paragraph("z")]}]),
            false,
        );
        let (mut s, calls) = open(&value, false, EventLimits::default(), AccessMode::Editable);
        let root = at(&s, &[]);
        let left = at(&s, &[0]);
        let right = at(&s, &[1]);
        let node = at(&s, &[0, 0]);
        let leaf = at(&s, &[0, 0, 0]);
        let before = s.node_at(s.key(), 0, root).unwrap().stats;
        let tx = Transaction::new(
            s.key(),
            0,
            vec![Operation::Move {
                node: node.into(),
                parent: right.into(),
                before_index: 1,
            }],
        );
        let event = raw(&mut s, &calls, tx);
        assert_eq!(s.node_at(s.key(), 1, root).unwrap().stats, before);
        assert_eq!(s.node(s.key(), node).unwrap().parent(), Some(right));
        assert_eq!(s.node(s.key(), leaf).unwrap().parent(), Some(node));
        let EventKind::Document { impact, .. } = event.notification.kind() else {
            panic!("missing move delta")
        };
        let mut upserted = vec![left, right, node];
        upserted.sort();
        assert_eq!(impact.upserted, upserted);
        assert!(impact.removed.is_empty());
        assert!(!impact.root_order_changed);
        assert_eq!(event.trace.phase(WorkPhase::FullFallback).visits, 0);
        portable.push(json!({"shape":"move","size":width,"status":"passed","moved_subtree_nodes":2,"preserved_descendant_ids":true,"ordinary_codec_hooks":0}));
        diagnostics
            .push(json!({"shape":"move","size":width,"trace":trace_json(event.trace,event.work)}));
    }
    // Independent flow: actual KWDJ event gaps and map retention on both targets.
    let value = envelope(json!([paragraph("a")]), false);
    let (mut s, calls) = open(
        &value,
        false,
        EventLimits {
            records: 2,
            ..EventLimits::default()
        },
        AccessMode::Editable,
    );
    let key = s.key();
    let initial = s.event_status(key).unwrap().head;
    let leaf = at(&s, &[0, 0]);
    for i in 0..70 {
        let tx = replace(&s, leaf, 0, 1, if i % 2 == 0 { "b" } else { "a" });
        raw(&mut s, &calls, tx);
    }
    let status = s.event_status(key).unwrap();
    assert_eq!(status.records, 2);
    assert_eq!(status.head.sequence(), 70);
    assert_eq!(status.oldest_after.sequence(), 68);
    assert!(matches!(
        s.events_after(
            key,
            initial,
            EventReadLimits::default(),
            WorkLimits::default()
        ),
        Err(SessionError::Events(EventError::Gap { .. }))
    ));
    assert!(matches!(
        s.protect_events(key, ProtectionStart::After(initial)),
        Err(SessionError::Events(EventError::Gap { .. }))
    ));
    let batch = s
        .events_after(
            key,
            status.oldest_after,
            EventReadLimits {
                records: 1,
                ..EventReadLimits::default()
            },
            WorkLimits::default(),
        )
        .unwrap();
    assert_eq!(
        batch
            .iter()
            .map(|e| e.cursor().sequence())
            .collect::<Vec<_>>(),
        vec![69]
    );
    let consumed = batch.through();
    let token = s
        .protect_events(key, ProtectionStart::After(status.oldest_after))
        .unwrap();
    assert!(s.acknowledge_events(key, token, consumed).unwrap());
    assert!(!s.acknowledge_events(key, token, consumed).unwrap());
    assert!(matches!(
        s.acknowledge_events(key, token, status.oldest_after),
        Err(SessionError::Events(EventError::StaleAcknowledgement))
    ));
    s.release_events(key, token).unwrap();
    let next = s.protect_events(key, ProtectionStart::Now).unwrap();
    assert!(matches!(
        s.acknowledge_events(key, token, status.head),
        Err(SessionError::Events(EventError::StaleProtection))
    ));
    s.release_events(key, next).unwrap();
    assert_eq!(
        s.map_position(key, 0, point(leaf, 1)).unwrap(),
        MapResult::Stale
    );
    assert_document(&s, &value);
    portable.push(json!({"shape":"gap","size":70,"status":"passed","head":"70","oldest_after":"68","retained":2,"batch_first":"69","stale_bookmark_chain":true,"ordinary_codec_hooks":0}));
    json!({"portable":{"status":"passed","case_total":portable.len(),"cases":portable,"scope":"Actual Session widths/depth/leaf/table and structural traces; profile flatness is measured separately from permitted affected block/vector work."},"diagnostics":{"series":diagnostics,"phase_bytes":"Target-local operational/prepared-copy bytes, not RSS; shared old event payload is not rescanned. Profile serialization bytes count the authoritative local wire rule.","private_engine_counter_witness":"Event-sequence MAX is exercised by private engine tests; no fake public/WASM setter."}})
}
