// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded Thompson epsilon NFA; no backtracking or powerset construction.
use crate::{
    Budget, CompilerLimits, Grammar, RegistryDiagnostic, RegistryErrorCode as E, charge, error,
};
use editor_core::transaction::{WorkMeter, WorkPhase};
use std::collections::BTreeSet;
#[derive(Debug, Clone)]
pub struct CompiledGrammar {
    kind: Matcher,
}
#[derive(Debug, Clone)]
enum Matcher {
    Counted {
        labels: BTreeSet<String>,
        min: u64,
        max: u64,
    },
    Nfa {
        states: Vec<Vec<Edge>>,
        start: usize,
        end: usize,
    },
}
#[derive(Debug, Clone)]
struct Edge {
    to: usize,
    label: Option<String>,
}
impl CompiledGrammar {
    pub fn compile(
        grammar: &Grammar,
        known: &BTreeSet<String>,
        limits: CompilerLimits,
        work: &mut WorkMeter,
    ) -> Result<Self, RegistryDiagnostic> {
        let start = work.usage();
        let mut b = Budget::new(limits, work);
        let result = Self::build(grammar, known, &mut b, "").map_err(|mut e| {
            e.usage = Box::new(b.usage);
            e
        });
        crate::with_work_usage(result, start, b.work)
    }
    pub(crate) fn build(
        grammar: &Grammar,
        known: &BTreeSet<String>,
        b: &mut Budget<'_>,
        path: &str,
    ) -> Result<Self, RegistryDiagnostic> {
        check(grammar, known, b, 1, path)?;
        if let Grammar::Repeat { item, min, max } = grammar
            && let Some((count, bytes)) = simple_cost(item)
        {
            b.units(count + 1)?;
            reserve(b, 2, 1)?;
            b.alloc(bytes + 64)?;
            let labels = simple(item).expect("checked compact labels");
            return Ok(Self {
                kind: Matcher::Counted {
                    labels,
                    min: *min,
                    max: *max,
                },
            });
        }
        let (s, t) = estimate(grammar).ok_or_else(|| b.resource("projected grammar overflow"))?;
        reserve(b, s, t)?;
        b.units(s + t)?;
        b.alloc(s * 32 + t * 192)?;
        let mut states = Vec::with_capacity(s as usize);
        let (start, end) = emit(grammar, &mut states);
        debug_assert_eq!(states.len(), s as usize);
        Ok(Self {
            kind: Matcher::Nfa { states, start, end },
        })
    }
    pub fn validate_labels<'a>(
        &self,
        labels: impl IntoIterator<Item = &'a str>,
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        let start = work.usage();
        let result = self.validate_labels_inner(labels, path, work);
        crate::with_work_usage(result, start, work)
    }
    fn validate_labels_inner<'a>(
        &self,
        labels: impl IntoIterator<Item = &'a str>,
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        charge(work, 1, 0)?;
        let fail = |index| {
            let mut e = error(E::GrammarMismatch, path, "complete child grammar");
            e.child_index = Some(index);
            e
        };
        match &self.kind {
            Matcher::Counted {
                labels: allowed,
                min,
                max,
            } => {
                let mut count = 0u64;
                for (index, label) in labels.into_iter().enumerate() {
                    charge(work, 1 + label.len() as u64, 0)?;
                    work.note_phase(WorkPhase::StaticValidation, 1, label.len() as u64);
                    count += 1;
                    if count > *max || !allowed.contains(label) {
                        return Err(fail(index));
                    }
                }
                if count < *min {
                    return Err(fail(count as usize));
                }
            }
            Matcher::Nfa { states, start, end } => {
                charge(work, states.len() as u64, states.len() as u64 * 160)?;
                let mut current = BTreeSet::new();
                current.insert(*start);
                closure(states, &mut current, work)?;
                let mut count = 0usize;
                for label in labels {
                    charge(work, 1 + label.len() as u64, states.len() as u64 * 80)?;
                    work.note_phase(WorkPhase::StaticValidation, 1, label.len() as u64);
                    let mut next = BTreeSet::new();
                    for state in &current {
                        for edge in &states[*state] {
                            charge(work, 1, 0)?;
                            if edge.label.as_deref() == Some(label) {
                                next.insert(edge.to);
                            }
                        }
                    }
                    if next.is_empty() {
                        return Err(fail(count));
                    }
                    closure(states, &mut next, work)?;
                    current = next;
                    count += 1;
                }
                if !current.contains(end) {
                    return Err(fail(count));
                }
            }
        }
        Ok(())
    }
    pub(crate) fn counted(&self) -> Option<(&BTreeSet<String>, u64, u64)> {
        match &self.kind {
            Matcher::Counted { labels, min, max } => Some((labels, *min, *max)),
            _ => None,
        }
    }
}
fn reserve(b: &mut Budget<'_>, states: u64, transitions: u64) -> Result<(), RegistryDiagnostic> {
    let s = b
        .usage
        .states
        .checked_add(states)
        .ok_or_else(|| b.resource("states overflow"))?;
    let t = b
        .usage
        .transitions
        .checked_add(transitions)
        .ok_or_else(|| b.resource("transitions overflow"))?;
    b.cap(s, b.limits.states, "projected states")?;
    b.cap(t, b.limits.transitions, "projected transitions")?;
    b.usage.states = s;
    b.usage.transitions = t;
    Ok(())
}
fn check(
    g: &Grammar,
    known: &BTreeSet<String>,
    b: &mut Budget<'_>,
    depth: u64,
    path: &str,
) -> Result<(), RegistryDiagnostic> {
    b.units(1)?;
    b.cap(depth, b.limits.grammar_depth, "grammar depth")?;
    b.usage.grammar_operators += 1;
    b.cap(
        b.usage.grammar_operators,
        b.limits.grammar_operators,
        "grammar operators",
    )?;
    match g {
        Grammar::Empty {} => {}
        Grammar::Type { id } => {
            b.units(id.len() as u64)?;
            if !crate::identifier(id) {
                return Err(error(E::InvalidIdentifier, path, "grammar type ID"));
            }
            if !known.contains(id) {
                return Err(error(E::UnknownType, path, "unselected grammar type"));
            }
        }
        Grammar::Sequence { items } | Grammar::Choice { items } => {
            if matches!(g, Grammar::Choice { .. }) && items.is_empty() {
                return Err(error(E::InvalidGrammar, path, "empty choice"));
            }
            b.cap(
                items.len() as u64,
                b.limits.grammar_operators,
                "grammar width",
            )?;
            for (index, item) in items.iter().enumerate() {
                check(item, known, b, depth + 1, &format!("{path}/items/{index}"))?;
            }
        }
        Grammar::Repeat { item, min, max } => {
            if min > max {
                return Err(error(E::InvalidGrammar, path, "reversed repeat"));
            }
            check(item, known, b, depth + 1, &crate::pointer(path, "item"))?;
        }
    }
    Ok(())
}
fn simple_cost(g: &Grammar) -> Option<(u64, u64)> {
    match g {
        Grammar::Type { id } => Some((1, id.len() as u64 + 64)),
        Grammar::Choice { items } if !items.is_empty() => {
            let mut bytes = 0;
            for item in items {
                if let Grammar::Type { id } = item {
                    bytes += id.len() as u64 + 64;
                } else {
                    return None;
                }
            }
            Some((items.len() as u64, bytes))
        }
        _ => None,
    }
}
fn simple(g: &Grammar) -> Option<BTreeSet<String>> {
    match g {
        Grammar::Type { id } => Some([id.clone()].into_iter().collect()),
        Grammar::Choice { items } if !items.is_empty() => {
            let mut out = BTreeSet::new();
            for item in items {
                if let Grammar::Type { id } = item {
                    out.insert(id.clone());
                } else {
                    return None;
                }
            }
            Some(out)
        }
        _ => None,
    }
}
fn estimate(g: &Grammar) -> Option<(u64, u64)> {
    match g {
        Grammar::Empty {} | Grammar::Type { .. } => Some((2, 1)),
        Grammar::Sequence { items } | Grammar::Choice { items } => {
            let (mut s, mut t) = (
                2u64,
                if matches!(g, Grammar::Sequence { .. }) {
                    items.len() as u64 + 1
                } else {
                    items.len() as u64 * 2
                },
            );
            for item in items {
                let (a, b) = estimate(item)?;
                s = s.checked_add(a)?;
                t = t.checked_add(b)?;
            }
            Some((s, t))
        }
        Grammar::Repeat { item, max, .. } => {
            let (s, t) = estimate(item)?;
            Some((
                2u64.checked_add(s.checked_mul(*max)?)?,
                1u64.checked_add(t.checked_add(2)?.checked_mul(*max)?)?,
            ))
        }
    }
}
fn new_state(states: &mut Vec<Vec<Edge>>) -> usize {
    let i = states.len();
    states.push(Vec::new());
    i
}
fn edge(states: &mut [Vec<Edge>], from: usize, to: usize, label: Option<String>) {
    states[from].push(Edge { to, label });
}
fn emit(g: &Grammar, states: &mut Vec<Vec<Edge>>) -> (usize, usize) {
    let start = new_state(states);
    let end = new_state(states);
    match g {
        Grammar::Empty {} => edge(states, start, end, None),
        Grammar::Type { id } => edge(states, start, end, Some(id.clone())),
        Grammar::Sequence { items } => {
            let mut previous = start;
            for item in items {
                let (a, b) = emit(item, states);
                edge(states, previous, a, None);
                previous = b;
            }
            edge(states, previous, end, None);
        }
        Grammar::Choice { items } => {
            for item in items {
                let (a, b) = emit(item, states);
                edge(states, start, a, None);
                edge(states, b, end, None);
            }
        }
        Grammar::Repeat { item, min, max } => {
            let mut previous = start;
            for i in 0..*max {
                if i >= *min {
                    edge(states, previous, end, None);
                }
                let (a, b) = emit(item, states);
                edge(states, previous, a, None);
                previous = b;
            }
            edge(states, previous, end, None);
        }
    }
    (start, end)
}
fn closure(
    states: &[Vec<Edge>],
    set: &mut BTreeSet<usize>,
    work: &mut WorkMeter,
) -> Result<(), RegistryDiagnostic> {
    charge(work, 1, states.len() as u64 * 16)?;
    let mut pending: Vec<_> = set.iter().copied().collect();
    while let Some(s) = pending.pop() {
        charge(work, 1, 0)?;
        for edge in &states[s] {
            charge(work, 1, 0)?;
            if edge.label.is_none() && set.insert(edge.to) {
                pending.push(edge.to);
            }
        }
    }
    Ok(())
}
