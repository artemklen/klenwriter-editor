// SPDX-License-Identifier: MIT OR Apache-2.0
use super::{RecipeIntent, charge, diagnostic};
use editor_core::commands::{LocalRef, PlanBuilder, SelectionIntent, StoredMarksUpdate};
use editor_core::document::{Attribute, Attributes, Document, Mark, Node};
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset};
use editor_core::transaction::{Operation, WorkMeter};
use editor_registry::{
    AffinityDescriptor, AttributeEdit, FrozenRegistry, MarkTemplate, NodeRef, NodeTemplate,
    PositionTemplate, RecipeOperation, RecipeSelection, RecipeStoredMarks, RegistryDiagnostic,
    RegistryErrorCode as E, SelectionTemplate, UnsignedExpr, ValueExpr,
};
use std::collections::BTreeMap;

struct Resolve<'a, I> {
    registry: &'a FrozenRegistry,
    intent: &'a RecipeIntent<I>,
    base: usize,
    current: usize,
}
impl<I: Copy + Eq + Ord> Resolve<'_, I> {
    fn node(&self, n: &NodeRef, w: &mut WorkMeter) -> Result<LocalRef<I>, RegistryDiagnostic> {
        charge(w, 1, 0)?;
        match n {
            NodeRef::Argument { name } => self
                .intent
                .nodes
                .get(name)
                .copied()
                .map(LocalRef::Existing)
                .ok_or_else(|| diagnostic(E::RequiredArgumentMissing, "node argument", w)),
            NodeRef::Created { operation, path } => {
                if *operation as usize >= self.current {
                    return Err(diagnostic(
                        E::InvalidRecipe,
                        "created reference is not earlier",
                        w,
                    ));
                }
                if path.len() > 128 {
                    return Err(diagnostic(E::ResourceLimitExceeded, "created path", w));
                }
                charge(
                    w,
                    path.len() as u64,
                    (path.len() * std::mem::size_of::<usize>()) as u64,
                )?;
                let operation = self.base.checked_add(*operation as usize).ok_or_else(|| {
                    diagnostic(E::ResourceLimitExceeded, "created operation index", w)
                })?;
                Ok(LocalRef::Created {
                    operation,
                    path: path.iter().map(|x| *x as usize).collect(),
                })
            }
        }
    }
    fn uint(&self, x: &UnsignedExpr, w: &mut WorkMeter) -> Result<usize, RegistryDiagnostic> {
        charge(w, 1, 0)?;
        let value = match x {
            UnsignedExpr::Literal { value } => *value,
            UnsignedExpr::Argument { name } => match self.intent.values.get(name) {
                Some(Attribute::Number(n)) => n.as_u64().ok_or_else(|| {
                    diagnostic(
                        E::ArgumentTypeMismatch,
                        "unsigned exact integer required",
                        w,
                    )
                })?,
                _ => {
                    return Err(diagnostic(
                        E::ArgumentTypeMismatch,
                        "unsigned argument required",
                        w,
                    ));
                }
            },
        };
        let bounded = u32::try_from(value).map_err(|_| {
            diagnostic(
                E::ResourceLimitExceeded,
                "recipe index or offset capability",
                w,
            )
        })?;
        Ok(bounded as usize)
    }
    fn value(&self, v: &ValueExpr, w: &mut WorkMeter) -> Result<Attribute, RegistryDiagnostic> {
        match v {
            ValueExpr::Argument { name } => {
                let value =
                    self.intent.values.get(name).ok_or_else(|| {
                        diagnostic(E::RequiredArgumentMissing, "value argument", w)
                    })?;
                preflight_attribute(value, 0, w)?;
                Ok(value.clone())
            }
            ValueExpr::Literal { value } => editor_registry::copy_literal(value, w),
        }
    }
    fn text(&self, v: &ValueExpr, w: &mut WorkMeter) -> Result<String, RegistryDiagnostic> {
        match self.value(v, w)? {
            Attribute::String(s) => Ok(s),
            _ => Err(diagnostic(
                E::ArgumentTypeMismatch,
                "text expression must be string",
                w,
            )),
        }
    }
    fn attrs(
        &self,
        source: &BTreeMap<String, ValueExpr>,
        w: &mut WorkMeter,
    ) -> Result<Attributes, RegistryDiagnostic> {
        let mut out = Attributes::new();
        for (key, value) in source {
            charge(
                w,
                1,
                key.len() as u64 + std::mem::size_of::<(String, Attribute)>() as u64,
            )?;
            let value = self.value(value, w)?;
            out.insert(key.clone(), value);
        }
        Ok(out)
    }
    fn marks(
        &self,
        source: &[MarkTemplate],
        w: &mut WorkMeter,
    ) -> Result<Vec<Mark>, RegistryDiagnostic> {
        charge(
            w,
            source.len() as u64,
            (source.len() * std::mem::size_of::<Mark>()) as u64,
        )?;
        let mut result = Vec::with_capacity(source.len());
        for mark in source {
            charge(w, 1, mark.type_id.len() as u64)?;
            let attributes = self.attrs(&mark.attributes, w)?;
            result.push(Mark {
                type_id: mark.type_id.clone(),
                attributes,
            });
        }
        Ok(result)
    }
    fn template(
        &self,
        source: &NodeTemplate,
        depth: usize,
        w: &mut WorkMeter,
    ) -> Result<Node, RegistryDiagnostic> {
        if depth > 128 {
            return Err(diagnostic(E::ResourceLimitExceeded, "template depth", w));
        }
        charge(
            w,
            1,
            source.type_id.len() as u64 + std::mem::size_of::<Node>() as u64,
        )?;
        let spec = self
            .registry
            .node(&source.type_id)
            .ok_or_else(|| diagnostic(E::UnknownType, "template node type", w))?;
        let attributes = self.attrs(&source.attributes, w)?;
        let marks = self.marks(&source.marks, w)?;
        let text = source.text.as_ref().map(|v| self.text(v, w)).transpose()?;
        charge(
            w,
            source.children.len() as u64,
            (source.children.len() * std::mem::size_of::<Node>()) as u64,
        )?;
        let mut children = Vec::with_capacity(source.children.len());
        for child in &source.children {
            children.push(self.template(child, depth + 1, w)?);
        }
        Ok(Node {
            type_id: source.type_id.clone(),
            primitive: spec.descriptor.primitive.core(),
            attributes,
            marks,
            text,
            children,
        })
    }
    fn position(
        &self,
        p: &PositionTemplate,
        w: &mut WorkMeter,
    ) -> Result<Position<LocalRef<I>>, RegistryDiagnostic> {
        Ok(match p {
            PositionTemplate::Text {
                node,
                offset,
                affinity: a,
            } => Position::Text {
                leaf: self.node(node, w)?,
                utf16: Utf16Offset::new(self.uint(offset, w)?),
                affinity: affinity(*a),
            },
            PositionTemplate::Child {
                parent,
                index,
                affinity: a,
            } => Position::Child {
                parent: self.node(parent, w)?,
                index: self.uint(index, w)?,
                affinity: affinity(*a),
            },
            PositionTemplate::Edge { node, side } => Position::Edge {
                node: self.node(node, w)?,
                side: match side {
                    AffinityDescriptor::Before => Edge::Before,
                    AffinityDescriptor::After => Edge::After,
                },
            },
        })
    }
    fn selection(
        &self,
        s: &Option<SelectionTemplate>,
        w: &mut WorkMeter,
    ) -> Result<Option<Selection<LocalRef<I>>>, RegistryDiagnostic> {
        s.as_ref()
            .map(|s| {
                Ok(Selection {
                    anchor: self.position(&s.anchor, w)?,
                    focus: self.position(&s.focus, w)?,
                })
            })
            .transpose()
    }
}
fn affinity(a: AffinityDescriptor) -> Affinity {
    match a {
        AffinityDescriptor::Before => Affinity::Before,
        AffinityDescriptor::After => Affinity::After,
    }
}
fn preflight_attribute(
    v: &Attribute,
    depth: usize,
    w: &mut WorkMeter,
) -> Result<(), RegistryDiagnostic> {
    if depth > 64 {
        return Err(diagnostic(
            E::ResourceLimitExceeded,
            "argument attribute depth",
            w,
        ));
    }
    charge(w, 1, std::mem::size_of::<Attribute>() as u64)?;
    match v {
        Attribute::String(s) => charge(w, 1, s.len() as u64)?,
        Attribute::List(xs) => {
            for x in xs {
                preflight_attribute(x, depth + 1, w)?;
            }
        }
        Attribute::Object(xs) => {
            for (key, x) in xs {
                charge(w, 1, key.len() as u64 + 32)?;
                preflight_attribute(x, depth + 1, w)?;
            }
        }
        Attribute::Number(number) => {
            // Display streams the exact arbitrary-precision representation;
            // no to_string allocation may precede its ownership charge.
            struct Sink<'a> {
                work: &'a mut WorkMeter,
                refusal: Option<RegistryDiagnostic>,
            }
            impl std::fmt::Write for Sink<'_> {
                fn write_str(&mut self, text: &str) -> std::fmt::Result {
                    charge(self.work, 1, text.len() as u64).map_err(|error| {
                        self.refusal = Some(error);
                        std::fmt::Error
                    })
                }
            }
            let mut sink = Sink {
                work: w,
                refusal: None,
            };
            let result = std::fmt::write(&mut sink, format_args!("{number}"));
            if let Some(error) = sink.refusal {
                return Err(error);
            }
            debug_assert!(result.is_ok());
        }
        _ => {}
    }
    Ok(())
}

pub fn prepare<I: Copy + Eq + Ord>(
    registry: &FrozenRegistry,
    intent: &RecipeIntent<I>,
    operations: &[RecipeOperation],
    selection: &RecipeSelection,
    stored: &RecipeStoredMarks,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<(), RegistryDiagnostic> {
    let base = plan.len();
    for (index, operation) in operations.iter().enumerate() {
        let r = Resolve {
            registry,
            intent,
            base,
            current: index,
        };
        charge(plan.work(), 1, 0)?;
        let op = match operation {
            RecipeOperation::ReplaceText {
                leaf,
                from,
                to,
                text,
            } => {
                let leaf = r.node(leaf, plan.work())?;
                let from = Utf16Offset::new(r.uint(from, plan.work())?);
                let to = Utf16Offset::new(r.uint(to, plan.work())?);
                let inserted = r.text(text, plan.work())?;
                Operation::ReplaceText {
                    leaf,
                    from,
                    to,
                    inserted,
                }
            }
            RecipeOperation::SetAttribute { node, key, value } => {
                let node = r.node(node, plan.work())?;
                charge(plan.work(), 1, key.len() as u64)?;
                let value = match value {
                    AttributeEdit::Remove {} => None,
                    AttributeEdit::Set { value } => Some(r.value(value, plan.work())?),
                };
                Operation::SetAttribute {
                    node,
                    key: key.clone(),
                    value,
                }
            }
            RecipeOperation::SetMarks { leaf, marks } => {
                let leaf = r.node(leaf, plan.work())?;
                let marks = r.marks(marks, plan.work())?;
                Operation::SetMarks { leaf, marks }
            }
            RecipeOperation::InsertFragment {
                parent,
                index,
                fragment,
            } => {
                let parent = r.node(parent, plan.work())?;
                let index = r.uint(index, plan.work())?;
                charge(
                    plan.work(),
                    fragment.len() as u64,
                    (fragment.len() * std::mem::size_of::<Node>()) as u64,
                )?;
                let mut children = Vec::with_capacity(fragment.len());
                for node in fragment {
                    children.push(r.template(node, 1, plan.work())?);
                }
                Operation::InsertFragment {
                    parent,
                    index,
                    fragment: Document { children },
                }
            }
        };
        plan.push(op).map_err(|_| {
            diagnostic(
                E::ResourceLimitExceeded,
                "recipe operation plan",
                plan.work(),
            )
        })?;
    }
    let r = Resolve {
        registry,
        intent,
        base,
        current: operations.len(),
    };
    let selection = match selection {
        RecipeSelection::MapCurrent {} => SelectionIntent::MapCurrent,
        RecipeSelection::Set { selection } => {
            SelectionIntent::Set(r.selection(selection, plan.work())?)
        }
        RecipeSelection::MapFromUserResult { selection } => {
            SelectionIntent::MapFromUserResult(r.selection(selection, plan.work())?)
        }
    };
    plan.set_selection(selection).map_err(|_| {
        diagnostic(
            E::ResourceLimitExceeded,
            "recipe selection plan",
            plan.work(),
        )
    })?;
    let marks = match stored {
        RecipeStoredMarks::Keep {} => StoredMarksUpdate::Keep,
        RecipeStoredMarks::Inherit {} => StoredMarksUpdate::Inherit,
        RecipeStoredMarks::Set { marks } => StoredMarksUpdate::Set(r.marks(marks, plan.work())?),
    };
    plan.set_stored_marks(marks).map_err(|_| {
        diagnostic(
            E::ResourceLimitExceeded,
            "recipe stored mark plan",
            plan.work(),
        )
    })?;
    Ok(())
}
