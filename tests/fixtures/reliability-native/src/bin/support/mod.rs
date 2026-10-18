// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_bridge::{Distribution, Endpoint};
use editor_core::{
    commands::CommandProvider,
    positions::{Affinity, Position, Selection, Utf16Offset},
    profile::AdmissionMode,
    transaction::{WorkLimits, WorkMeter},
};
use editor_engine::{
    AccessMode, NodeId, Session,
    commands::{CommandAvailability, CommandOutcome, CommandRequest},
    events::{EventLimits, ProtectionStart},
    transaction::DispatchOutcome,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fmt::Debug,
    io::{self, Read},
    rc::Rc,
    time::Instant,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub profile: String,
    pub input: String,
    pub registry: String,
    pub root_blocks: Vec<String>,
    pub first_text_path: Vec<usize>,
    pub layer: String,
    pub workload: String,
    pub samples: usize,
    pub warmup: usize,
    pub steps: usize,
    #[serde(skip)]
    pub allocator: bool,
}
fn heap(enabled: bool) -> (u64, u64) {
    #[cfg(feature = "allocator-profile")]
    if enabled {
        let stats = dhat::HeapStats::get();
        return (stats.total_bytes, stats.curr_bytes as u64);
    }
    let _ = enabled;
    (0, 0)
}
struct Facts;
impl editor_kwdj::IdentityResolver for Facts {
    fn resolve_media(
        &self,
        _: &uuid::Uuid,
    ) -> Result<editor_kwdj::IdentityStatus, editor_kwdj::IdentityResolverError> {
        Ok(editor_kwdj::IdentityStatus::Missing)
    }
    fn resolve_reference(
        &self,
        _: &uuid::Uuid,
    ) -> Result<editor_kwdj::IdentityStatus, editor_kwdj::IdentityResolverError> {
        Ok(editor_kwdj::IdentityStatus::Missing)
    }
}
fn native<P: CommandProvider>(
    profile: P,
    request: &Request,
    intent: impl Fn(String) -> P::Intent<NodeId>,
) -> Value
where
    P::Error: Debug,
{
    let binding = profile.binding().clone();
    let start = Instant::now();
    let mut session = if request.workload == "recurrence" {
        Session::open_with_event_limits(
            profile,
            &binding,
            request.input.as_bytes(),
            AdmissionMode::Strict,
            AccessMode::Editable,
            EventLimits {
                records: 1,
                ..EventLimits::default()
            },
        )
    } else {
        Session::open(
            profile,
            &binding,
            request.input.as_bytes(),
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
    }
    .expect("strict corpus admission");
    let admission_ns = start.elapsed().as_nanos() as u64;
    let key = session.key();
    if request.workload == "one-admit" {
        session.close(key).expect("lifecycle close");
        drop(session);
        return json!({"admission_ns":admission_ns,"native_session_closed_and_dropped":true});
    }
    assert_eq!(
        session.export_snapshot(key, 0).expect("initial checkpoint"),
        request.input.as_bytes(),
        "independently authored canonical input"
    );
    let protection = session
        .protect_events(key, ProtectionStart::Now)
        .expect("delivery protection");
    let total = if matches!(request.workload.as_str(), "long-session" | "recurrence") {
        request.steps
    } else {
        request.samples + request.warmup
    };
    let mut timings = Vec::with_capacity(total.saturating_sub(request.warmup));
    let mut allocations = Vec::with_capacity(total.saturating_sub(request.warmup));
    let mut live = Vec::with_capacity(total.saturating_sub(request.warmup));
    assert!(total <= 16384 && request.samples <= 4096 && request.warmup <= 4096);
    let mut checkpoints = Vec::new();
    let mut work_observations = Vec::new();
    for index in 0..total {
        // Replacing the whole first leaf legitimately retires its identity.
        // Guarded reads resolve the current authored path outside timed work.
        let mut leaf = session.root(key).expect("root");
        for &index in &request.first_text_path {
            leaf = session.node(key, leaf).expect("current path").children()[index];
        }
        let before = session.revision();
        let anchor = Position::Text {
            leaf,
            utf16: Utf16Offset::new(0),
            affinity: Affinity::After,
        };
        let focus = Position::Text {
            leaf,
            utf16: Utf16Offset::new(1),
            affinity: Affinity::Before,
        };
        if request.workload != "export" {
            session
                .set_selection(key, before, Selection { anchor, focus })
                .expect("replace first ASCII scalar");
            let head = session.event_status(key).expect("selection status").head;
            session
                .acknowledge_events(key, protection, head)
                .expect("selection delivery before command");
        }
        let command = CommandRequest::new(
            key,
            session.revision(),
            session.selection_epoch(),
            intent(if index % 2 == 0 { "z" } else { "x" }.into()),
        );
        let allocation_before = heap(request.allocator).0;
        let start = Instant::now();
        let (exported, outcome) = if request.workload == "export" {
            (
                Some(
                    session
                        .export_snapshot(key, before)
                        .expect("explicit export"),
                ),
                None,
            )
        } else {
            (None, Some(session.execute_command(&command)))
        };
        let elapsed = start.elapsed().as_nanos() as u64;
        let after = heap(request.allocator);
        std::hint::black_box(&exported);
        if let Some(outcome) = outcome {
            match outcome {
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Changed(event),
                    ..
                } => {
                    if index == request.warmup || index + 1 == total {
                        let names = [
                            "Structure",
                            "Header",
                            "Preflight",
                            "Normalization",
                            "Serialization",
                            "StaticValidation",
                            "Identity",
                            "CacheReuse",
                            "CacheUpdate",
                            "Impact",
                            "Event",
                            "Export",
                            "FullFallback",
                        ];
                        let trace:Vec<_>=event.trace.phases.iter().enumerate().map(|(i,value)|json!({"phase":names[i],"visits":value.visits,"bytes":value.bytes})).collect();
                        work_observations.push(json!({"step":index+1,"work_units":event.work.units,"work_bytes":event.work.bytes,"normalization_operations":event.normalization_operations,"validation_nodes":event.validation.nodes,"canonical_bytes":event.validation.canonical_bytes,"trace":trace}));
                    }
                }
                other => panic!("actual command must publish: {other:?}"),
            }
        }
        if index >= request.warmup {
            timings.push(elapsed);
            allocations.push(after.0 - allocation_before);
            live.push(after.1);
        }
        let status = session.event_status(key).expect("status");
        session
            .acknowledge_events(key, protection, status.head)
            .expect("deliver then acknowledge actual head");
        if [0, 63, 511, 1023, 2047, 4095].contains(&index) || index + 1 == total {
            let history = session.history_summary();
            let journal = session.journal_summary();
            checkpoints.push(json!({"step":index+1,"revision":session.revision().to_string(),"undo_units":history.undo_units,"redo_units":history.redo_units,"history_retained_bytes":history.retained_bytes,"journal_entries":journal.entries,"journal_bytes":journal.bytes,"event_records":status.records,"event_bytes":status.retained_bytes}));
        }
    }
    assert_eq!(
        total % 2,
        0,
        "even replacement count restores authored bytes"
    );
    assert_eq!(
        session
            .export_snapshot(key, session.revision())
            .expect("final checkpoint"),
        request.input.as_bytes()
    );
    let revision = session.revision();
    session
        .release_events(key, protection)
        .expect("release cursor");
    session.close(key).expect("close");
    drop(session);
    json!({"samples":timings,"allocation_samples":allocations,"live_samples":live,"admission_ns":admission_ns,"final_revision":revision.to_string(),"literal_bytes_restored":true,"checkpoints":checkpoints,"work_observations":work_observations,"native_session_closed_and_dropped":true})
}
fn core(request: &Request) -> Value {
    if request.profile == "kwdj" {
        let profile = editor_kwdj::KwdjProfile::new_owned(
            Rc::new(Facts),
            editor_kwdj::Limits::default(),
            editor_kwdj::AdmissionBudget::default(),
        );
        native(profile, request, |text| {
            editor_kwdj::commands::KwdjIntent::InsertText { text }
        })
    } else {
        assert_eq!(request.profile, "notes");
        let profile = editor_notes::NotesProfile::compile_json(
            request.registry.as_bytes(),
            &request.root_blocks,
            editor_notes::NotesLimits::default(),
            editor_registry::CompilerLimits::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .expect("frozen notes registry");
        if request.workload == "capacity" {
            use editor_core::profile::FrozenProfile;
            let binding = profile.binding().clone();
            return match Session::open(
                profile,
                &binding,
                request.input.as_bytes(),
                AdmissionMode::Strict,
                AccessMode::Editable,
            ) {
                Ok(mut session) => {
                    let key = session.key();
                    let export = match session.export_snapshot(key, session.revision()) {
                        Ok(bytes) => {
                            assert_eq!(bytes, request.input.as_bytes());
                            json!({"feasible":true})
                        }
                        Err(editor_engine::SessionError::Profile(error)) => {
                            json!({"feasible":false,"code":error.as_str()})
                        }
                        Err(editor_engine::SessionError::Tree(
                            editor_engine::tree::TreeError::ResourceLimit,
                        )) => json!({"feasible":false,"code":"resource_limit_exceeded"}),
                        Err(error) => panic!("unexpected export capacity boundary: {error:?}"),
                    };
                    let mut commands = Vec::new();
                    for index in 0..2 {
                        let mut leaf = session.root(key).expect("capacity root");
                        for &part in &request.first_text_path {
                            leaf = session.node(key, leaf).expect("capacity path").children()[part];
                        }
                        session
                            .set_selection(
                                key,
                                session.revision(),
                                Selection {
                                    anchor: Position::Text {
                                        leaf,
                                        utf16: Utf16Offset::new(0),
                                        affinity: Affinity::After,
                                    },
                                    focus: Position::Text {
                                        leaf,
                                        utf16: Utf16Offset::new(1),
                                        affinity: Affinity::Before,
                                    },
                                },
                            )
                            .expect("capacity selection");
                        let command = CommandRequest::new(
                            key,
                            session.revision(),
                            session.selection_epoch(),
                            editor_notes::NativeNotesIntent::InsertText {
                                text: if index == 0 { "z" } else { "x" }.into(),
                            },
                        );
                        let query = session.query_command(&command);
                        let available = matches!(query, CommandAvailability::Available { .. });
                        let outcome = session.execute_command(&command);
                        match outcome {
                            CommandOutcome::Completed {
                                outcome: DispatchOutcome::Changed(event),
                                ..
                            } => {
                                assert!(available);
                                commands.push(json!({"feasible":true,"work_units":event.work.units,"work_bytes":event.work.bytes,"validation_nodes":event.validation.nodes,"canonical_bytes":event.validation.canonical_bytes}));
                            }
                            CommandOutcome::Refused { reason, work, .. } => {
                                assert!(!available);
                                commands.push(json!({"feasible":false,"code":reason,"work_units":work.units,"work_bytes":work.bytes}));
                                break;
                            }
                            other => panic!("unexpected capacity command outcome: {other:?}"),
                        }
                    }
                    let command_feasible =
                        commands.len() == 2 && commands.iter().all(|v| v["feasible"] == true);
                    session.close(key).expect("capacity close");
                    drop(session);
                    json!({"status":"accepted","command_feasible":command_feasible,"commands":commands,"export":export,"codec_admission_work":"not exposed by public Notes API","default_work_units":1000000,"default_work_bytes":67108864})
                }
                Err(editor_engine::SessionError::Profile(error)) => {
                    json!({"status":"refused","code":error.as_str(),"path":error.path,"codec_admission_work":"not exposed by public Notes API","default_work_units":1000000,"default_work_bytes":67108864})
                }
                Err(error) => panic!("unexpected capacity boundary: {error:?}"),
            };
        }
        native(profile, request, |text| {
            editor_notes::NativeNotesIntent::InsertText { text }
        })
    }
}
fn ok(value: Value) -> Value {
    assert_eq!(value["status"], "ok", "public bridge refused: {value}");
    value["value"].clone()
}
fn call(session: &mut editor_bridge::DistributionSession, request: Value) -> Value {
    ok(serde_json::from_str(&session.call_json(&request.to_string())).expect("bridge JSON"))
}
fn bridge(request: &Request) -> Value {
    let distribution = Distribution::new(
        "reliability-native-measurement",
        vec![
            Box::new(editor_kwdj_sdk::KwdjFactory),
            Box::new(editor_notes_sdk::NotesFactory),
        ],
    )
    .expect("distribution");
    let profile = if request.profile == "notes" {
        json!({"profile_id":"org.example.notes","profile_version":"1.0.0","codec_id":"org.example.notes/json","wire_version":1,"extensions":serde_json::from_str::<Value>(&request.registry).unwrap()["selected_extensions"]})
    } else {
        json!({"profile_id":"org.klenwriter.kwdj","profile_version":"1.0.0","codec_id":"org.klenwriter.kwdj/json","wire_version":1,"extensions":[{"id":"org.klenwriter.kwdj/base","version":"1.0.0"}]})
    };
    let options = json!({"abi":"editor-sdk/2","build_id":"reliability-native-measurement","profile":profile,"admission":"validate","access":"editable","registry_json":request.registry,"profile_options_json":if request.profile=="notes" {json!({"root_blocks":request.root_blocks,"limits":null}).to_string()} else {json!({"identities":{"media":[],"references":[]},"limits":null}).to_string()}});
    let start = Instant::now();
    let mut session = distribution.open(request.input.as_bytes(), &options.to_string());
    ok(serde_json::to_value(session.initialization()).unwrap());
    let admission_ns = start.elapsed().as_nanos() as u64;
    if request.workload == "one-admit" {
        session.destroy();
        let resources = session.own_resource_counts();
        return json!({"admission_ns":admission_ns,"resources_after":resources});
    }
    let mut state = call(&mut session, json!({"kind":"state"}))["state"].clone();
    let mut timings = Vec::new();
    let mut checkpoints = Vec::new();
    let mut allocations = Vec::new();
    let mut live = Vec::new();
    let total = if request.workload == "long-session" {
        request.steps
    } else {
        request.samples + request.warmup
    };
    for index in 0..total {
        let mut leaf = state["root"].clone();
        for &index in &request.first_text_path {
            leaf = call(
                &mut session,
                json!({"kind":"node","stamp":state["stamp"],"node":leaf}),
            )["node"]["children"][index]
                .clone();
        }
        if request.workload != "export" {
            call(
                &mut session,
                json!({"kind":"set_selection","stamp":state["stamp"],"selection":{"anchor":{"kind":"text","node":leaf,"offset":0,"affinity":"after"},"focus":{"kind":"text","node":leaf,"offset":1,"affinity":"before"}}}),
            );
            state = call(&mut session, json!({"kind":"state"}))["state"].clone();
        }
        let text = if index % 2 == 0 { "z" } else { "x" };
        let payload = if request.profile == "kwdj" {
            json!({"kind":"insert_text","text":text})
        } else {
            json!({"text":text})
        };
        let command = json!({"kind":"command","stamp":state["stamp"],"command":{"id":if request.profile=="kwdj" {"org.klenwriter.kwdj/command/insert-text"} else {"org.example.notes/command/insert-text"},"payload_json":payload.to_string()},"history_hint":{"kind":"isolated"}});
        let allocation_before = heap(request.allocator).0;
        let start = Instant::now();
        let reply = if request.workload == "export" {
            call(
                &mut session,
                json!({"kind":"snapshot","stamp":state["stamp"],"max_bytes":16777216}),
            )
        } else {
            call(&mut session, command)
        };
        let elapsed = start.elapsed().as_nanos() as u64;
        let after = heap(request.allocator);
        if index >= request.warmup && timings.len() < request.samples {
            timings.push(elapsed);
            allocations.push(after.0 - allocation_before);
            live.push(after.1);
        }
        if request.workload == "export" {
            call(
                &mut session,
                json!({"kind":"release_snapshot","handle":reply["handle"]}),
            );
        }
        state = call(&mut session, json!({"kind":"state"}))["state"].clone();
        let events = call(&mut session, json!({"kind":"events"}));
        assert_eq!(events["gap"], false);
        if !events["events"].as_array().unwrap().is_empty() {
            call(
                &mut session,
                json!({"kind":"acknowledge_events","cursor":events["cursor"]}),
            );
        }
        if index + 1 == total || [0, 63, 511, 1023, 2047, 4095].contains(&index) {
            checkpoints.push(json!({"step":index+1,"state":state}));
        }
    }
    let exported = call(
        &mut session,
        json!({"kind":"snapshot","stamp":state["stamp"],"max_bytes":16777216}),
    );
    assert_eq!(exported["canonical_json"], request.input);
    call(
        &mut session,
        json!({"kind":"release_snapshot","handle":exported["handle"]}),
    );
    session.destroy();
    let resources = session.own_resource_counts();
    drop(session);
    json!({"samples":timings,"allocation_samples":allocations,"live_samples":live,"admission_ns":admission_ns,"literal_bytes_restored":true,"checkpoints":checkpoints,"resources_after":resources})
}
pub fn main(allocator: bool) {
    let mut raw = String::new();
    io::stdin()
        .take(20 * 1024 * 1024)
        .read_to_string(&mut raw)
        .expect("bounded stdin");
    let mut request: Request = serde_json::from_str(&raw).expect("closed request");
    request.allocator = allocator;
    assert!(request.samples <= 4096 && request.warmup <= 4096 && request.steps <= 16384);
    let execute = |request: &Request| {
        if request.layer == "core" {
            core(request)
        } else {
            assert_eq!(request.layer, "bridge");
            bridge(request)
        }
    };
    let mut output = if request.workload == "lifecycle" {
        let count = request.samples;
        let warmup = request.warmup;
        request.samples = 0;
        request.warmup = 0;
        request.workload = "one-admit".into();
        let mut samples = Vec::new();
        let mut allocations = Vec::new();
        let mut live = Vec::new();
        for index in 0..count + warmup {
            let before = heap(allocator).0;
            let start = Instant::now();
            std::hint::black_box(execute(&request));
            let elapsed = start.elapsed().as_nanos() as u64;
            let after = heap(allocator);
            if index >= warmup {
                samples.push(elapsed);
                allocations.push(after.0 - before);
                live.push(after.1);
            }
        }
        json!({"samples":samples,"allocation_samples":allocations,"live_samples":live,"lifecycle_cycles":count+warmup,"scope":"public profile construction, strict Session admission, close/drop; registry construction included"})
    } else {
        execute(&request)
    };
    output["format"] = json!("editor-reliability-native-capture/1");
    output["allocator_instrumented"] = json!(allocator);
    let mut increment = u64::MAX;
    for _ in 0..20000 {
        let start = Instant::now();
        let ns = start.elapsed().as_nanos() as u64;
        if ns > 0 {
            increment = increment.min(ns);
        }
    }
    output["timerIncrement"] = json!(increment);
    #[cfg(feature = "allocator-profile")]
    if allocator {
        let s = dhat::HeapStats::get();
        output["allocator"] = json!({"total_blocks":s.total_blocks,"total_bytes":s.total_bytes,"live_blocks":s.curr_blocks,"live_bytes":s.curr_bytes,"whole_process_peak_blocks":s.max_blocks,"whole_process_peak_bytes":s.max_bytes,"scope":"fresh process including input decoding / harness / corpus / output; no peak subtraction"});
    }
    println!("{}", output);
}
