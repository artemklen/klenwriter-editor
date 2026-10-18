// SPDX-License-Identifier: MIT OR Apache-2.0
//! Closed finite command declarations; compiled command provenance is separate
//! from runtime data and never supplies a callback or mutation privilege.
use crate::{AttributeSchema, CompiledAttributes};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CommandDescriptor {
    Compiled {
        id: String,
    },
    Recipe {
        id: String,
        parameters: BTreeMap<String, Parameter>,
        operations: Vec<RecipeOperation>,
        selection: Box<RecipeSelection>,
        stored_marks: RecipeStoredMarks,
    },
}
impl CommandDescriptor {
    pub fn id(&self) -> &str {
        match self {
            Self::Compiled { id } | Self::Recipe { id, .. } => id,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Parameter {
    Node {},
    Value { schema: AttributeSchema },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NodeRef {
    Argument { name: String },
    Created { operation: u32, path: Vec<u32> },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ValueExpr {
    Literal { value: serde_json::Value },
    Argument { name: String },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum UnsignedExpr {
    Literal { value: u64 },
    Argument { name: String },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AttributeEdit {
    Remove {},
    Set { value: ValueExpr },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarkTemplate {
    pub type_id: String,
    pub attributes: BTreeMap<String, ValueExpr>,
}
fn required_text<'de, D: Deserializer<'de>>(d: D) -> Result<Option<ValueExpr>, D::Error> {
    Option::deserialize(d)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeTemplate {
    pub type_id: String,
    pub attributes: BTreeMap<String, ValueExpr>,
    pub marks: Vec<MarkTemplate>,
    #[serde(deserialize_with = "required_text")]
    pub text: Option<ValueExpr>,
    pub children: Vec<NodeTemplate>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum RecipeOperation {
    ReplaceText {
        leaf: NodeRef,
        from: UnsignedExpr,
        to: UnsignedExpr,
        text: ValueExpr,
    },
    SetAttribute {
        node: NodeRef,
        key: String,
        value: AttributeEdit,
    },
    SetMarks {
        leaf: NodeRef,
        marks: Vec<MarkTemplate>,
    },
    InsertFragment {
        parent: NodeRef,
        index: UnsignedExpr,
        fragment: Vec<NodeTemplate>,
    },
}
fn required_selection<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<SelectionTemplate>, D::Error> {
    Option::deserialize(d)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RecipeSelection {
    MapCurrent {},
    Set {
        #[serde(deserialize_with = "required_selection")]
        selection: Option<SelectionTemplate>,
    },
    MapFromUserResult {
        #[serde(deserialize_with = "required_selection")]
        selection: Option<SelectionTemplate>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectionTemplate {
    pub anchor: PositionTemplate,
    pub focus: PositionTemplate,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AffinityDescriptor {
    Before,
    After,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PositionTemplate {
    Text {
        node: NodeRef,
        offset: UnsignedExpr,
        affinity: AffinityDescriptor,
    },
    Child {
        parent: NodeRef,
        index: UnsignedExpr,
        affinity: AffinityDescriptor,
    },
    Edge {
        node: NodeRef,
        side: AffinityDescriptor,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RecipeStoredMarks {
    Keep {},
    Inherit {},
    Set { marks: Vec<MarkTemplate> },
}
#[derive(Debug, Clone, Copy)]
pub struct CommandRef<'a> {
    pub descriptor: &'a CommandDescriptor,
    pub owner: &'a str,
    pub value_parameters: Option<&'a CompiledAttributes>,
}
#[derive(Debug)]
pub(crate) struct CompiledCommand {
    pub descriptor: CommandDescriptor,
    pub owner: String,
    pub values: Option<CompiledAttributes>,
}

use crate::compile::{CompiledMark, CompiledNode};
use crate::{
    AttributeField, Budget, FrozenRegistry, RegistryDiagnostic, RegistryErrorCode as E, error,
    identifier,
};
use editor_core::document::{Attributes, Primitive};
use std::collections::BTreeSet;

pub(crate) struct CommandTables {
    pub commands: BTreeMap<String, CompiledCommand>,
    pub catalog: Vec<String>,
    pub compiled: Vec<String>,
}
pub(crate) fn compile_commands(
    extensions: &BTreeMap<String, &crate::ExtensionDescriptor>,
    mandatory: &[crate::ExtensionDescriptor],
    nodes: &BTreeMap<String, CompiledNode>,
    marks: &BTreeMap<String, CompiledMark>,
    b: &mut Budget<'_>,
) -> Result<CommandTables, RegistryDiagnostic> {
    let count: usize = extensions.values().map(|e| e.commands.len()).sum();
    b.cap(count as u64, 256, "command catalog")?;
    let total: usize = extensions
        .values()
        .flat_map(|e| &e.commands)
        .map(|c| match c {
            CommandDescriptor::Recipe { operations, .. } => operations.len(),
            _ => 0,
        })
        .sum();
    b.cap(total as u64, 4096, "total declared recipe operations")?;
    let mut commands = BTreeMap::new();
    let mut compiled = Vec::new();
    for ext in extensions.values() {
        let trusted = mandatory.iter().any(|e| e.id == ext.id);
        b.units(mandatory.len() as u64 + 1)?;
        for command in &ext.commands {
            let id = command.id();
            b.units(id.len() as u64 + 1)?;
            if !identifier(id) {
                return Err(error(E::InvalidIdentifier, "/commands/id", "command ID"));
            }
            if commands.contains_key(id) {
                return Err(error(
                    E::DuplicateCommand,
                    "/commands/id",
                    "command owner conflict",
                ));
            }
            let values = match command {
                CommandDescriptor::Compiled { .. } => {
                    if !trusted {
                        return Err(error(
                            E::CompiledCommandForbidden,
                            "/commands",
                            "compiled marker requires mandatory Rust provenance",
                        ));
                    }
                    b.alloc(id.len() as u64 + 32)?;
                    compiled.push(id.to_owned());
                    None
                }
                CommandDescriptor::Recipe {
                    parameters,
                    operations,
                    selection,
                    stored_marks,
                    ..
                } => {
                    b.cap(parameters.len() as u64, 64, "recipe parameters")?;
                    b.cap(operations.len() as u64, 256, "recipe operations")?;
                    let mut fields = BTreeMap::new();
                    for (name, p) in parameters {
                        b.units(name.len() as u64 + 1)?;
                        if name.is_empty() || name.len() > 128 {
                            return Err(error(
                                E::InvalidRecipe,
                                "/commands/parameters",
                                "parameter name",
                            ));
                        }
                        if let Parameter::Value { schema } = p {
                            b.alloc(name.len() as u64 + 128)?;
                            fields.insert(
                                name.clone(),
                                AttributeField {
                                    required: true,
                                    value: schema.clone(),
                                },
                            );
                        }
                    }
                    let policy = CompiledAttributes::build(&fields, b, 1, "/commands/parameters")?;
                    let validator = RecipeValidator {
                        parameters,
                        operations,
                        nodes,
                        marks,
                    };
                    for (index, operation) in operations.iter().enumerate() {
                        validator.operation(operation, index, b)?;
                    }
                    if let RecipeSelection::Set { selection: Some(s) }
                    | RecipeSelection::MapFromUserResult { selection: Some(s) } =
                        selection.as_ref()
                    {
                        validator.position(&s.anchor, operations.len(), b)?;
                        validator.position(&s.focus, operations.len(), b)?;
                    }
                    if let RecipeStoredMarks::Set { marks } = stored_marks {
                        validator.mark_templates(marks, b)?;
                    }
                    Some(policy)
                }
            };
            b.alloc(id.len() as u64 + ext.id.len() as u64 + 192)?;
            commands.insert(
                id.to_owned(),
                CompiledCommand {
                    descriptor: command.clone(),
                    owner: ext.id.clone(),
                    values,
                },
            );
        }
    }
    b.alloc(commands.keys().map(|id| id.len() as u64 + 32).sum())?;
    let catalog = commands.keys().cloned().collect();
    compiled.sort();
    Ok(CommandTables {
        commands,
        catalog,
        compiled,
    })
}
struct RecipeValidator<'a> {
    parameters: &'a BTreeMap<String, Parameter>,
    operations: &'a [RecipeOperation],
    nodes: &'a BTreeMap<String, CompiledNode>,
    marks: &'a BTreeMap<String, CompiledMark>,
}
impl<'a> RecipeValidator<'a> {
    fn invalid(&self, detail: &'static str) -> RegistryDiagnostic {
        error(E::InvalidRecipe, "/commands", detail)
    }
    fn node_ref(
        &self,
        r: &NodeRef,
        index: usize,
        b: &mut Budget<'_>,
    ) -> Result<Option<&'a NodeTemplate>, RegistryDiagnostic> {
        b.units(1)?;
        match r {
            NodeRef::Argument { name } => {
                b.units(name.len() as u64)?;
                if !matches!(self.parameters.get(name), Some(Parameter::Node {})) {
                    return Err(self.invalid("node parameter reference"));
                }
                Ok(None)
            }
            NodeRef::Created { operation, path } => {
                b.cap(path.len() as u64, 128, "created path")?;
                if *operation as usize >= index || path.is_empty() {
                    return Err(self.invalid("created reference must name an earlier insertion"));
                }
                let Some(RecipeOperation::InsertFragment { fragment, .. }) =
                    self.operations.get(*operation as usize)
                else {
                    return Err(self.invalid("created reference does not create nodes"));
                };
                let mut node = fragment
                    .get(path[0] as usize)
                    .ok_or_else(|| self.invalid("created root path"))?;
                for part in &path[1..] {
                    b.units(1)?;
                    node = node
                        .children
                        .get(*part as usize)
                        .ok_or_else(|| self.invalid("created descendant path"))?;
                }
                Ok(Some(node))
            }
        }
    }
    fn value(&self, v: &ValueExpr, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        if let ValueExpr::Argument { name } = v {
            b.units(name.len() as u64)?;
            if !matches!(self.parameters.get(name), Some(Parameter::Value { .. })) {
                return Err(self.invalid("value parameter reference"));
            }
        }
        Ok(())
    }
    fn unsigned(&self, v: &UnsignedExpr, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        if let UnsignedExpr::Argument { name } = v {
            b.units(name.len() as u64)?;
            if !matches!(self.parameters.get(name), Some(Parameter::Value { .. })) {
                return Err(self.invalid("unsigned parameter reference"));
            }
        }
        Ok(())
    }
    fn text(&self, v: &ValueExpr, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        self.value(v, b)?;
        if let ValueExpr::Literal { value } = v
            && !value.is_string()
        {
            return Err(self.invalid("text literal must be string"));
        }
        Ok(())
    }
    fn literal_fields(
        &self,
        expressions: &BTreeMap<String, ValueExpr>,
        policy: &CompiledAttributes,
        b: &mut Budget<'_>,
    ) -> Result<(), RegistryDiagnostic> {
        let mut present = BTreeSet::new();
        let mut literals = Attributes::new();
        b.alloc(expressions.len() as u64 * 128)?;
        for (key, value) in expressions {
            b.units(key.len() as u64 + 1)?;
            self.value(value, b)?;
            present.insert(key.as_str());
            if let ValueExpr::Literal { value } = value {
                literals.insert(key.clone(), crate::copy_literal(value, b.work)?);
            }
        }
        policy
            .validate_literals(&present, &literals, "/commands/attributes", b.work)
            .map_err(static_error)
    }
    fn mark_templates(
        &self,
        templates: &[MarkTemplate],
        b: &mut Budget<'_>,
    ) -> Result<(), RegistryDiagnostic> {
        b.cap(
            templates.len() as u64,
            b.limits.node_mark_declarations,
            "template marks",
        )?;
        let mut seen = BTreeSet::new();
        b.alloc(templates.len() as u64 * 48)?;
        for template in templates {
            b.units(template.type_id.len() as u64 + 1)?;
            let mark = self
                .marks
                .get(&template.type_id)
                .ok_or_else(|| error(E::UnknownMark, "/commands/marks/type_id", "template mark"))?;
            if !seen.insert(template.type_id.as_str()) {
                return Err(self.invalid("duplicate template mark"));
            }
            self.literal_fields(&template.attributes, &mark.attrs, b)?;
        }
        for template in templates {
            for excluded in &self.marks[&template.type_id].descriptor.excludes {
                b.units(1)?;
                if seen.contains(excluded.as_str()) {
                    return Err(self.invalid("excluded template marks"));
                }
            }
        }
        Ok(())
    }
    fn node_template(
        &self,
        node: &NodeTemplate,
        depth: u64,
        b: &mut Budget<'_>,
    ) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        b.cap(depth, 128, "template node depth")?;
        b.cap(
            node.children.len() as u64,
            b.limits.json_values,
            "template children",
        )?;
        let spec = self.nodes.get(&node.type_id).ok_or_else(|| {
            error(
                E::UnknownType,
                "/commands/fragment/type_id",
                "template type",
            )
        })?;
        self.literal_fields(&node.attributes, &spec.attrs, b)?;
        self.mark_templates(&node.marks, b)?;
        for mark in &node.marks {
            if spec.allowed.binary_search(&mark.type_id).is_err() {
                return Err(self.invalid("template mark not allowed"));
            }
        }
        let shape = match spec.descriptor.primitive.core() {
            Primitive::Text => node.text.is_some() && node.children.is_empty(),
            Primitive::InlineAtom | Primitive::BlockAtom | Primitive::HardBreak => {
                node.text.is_none() && node.children.is_empty()
            }
            Primitive::Container | Primitive::TextBlock => node.text.is_none(),
        };
        if !shape {
            return Err(self.invalid("template primitive shape"));
        }
        if let Some(text) = &node.text {
            self.text(text, b)?;
        }
        spec.grammar
            .validate_labels(
                node.children.iter().map(|n| n.type_id.as_str()),
                "/commands/fragment/children",
                b.work,
            )
            .map_err(static_error)?;
        for child in &node.children {
            self.node_template(child, depth + 1, b)?;
        }
        Ok(())
    }
    fn operation(
        &self,
        op: &RecipeOperation,
        index: usize,
        b: &mut Budget<'_>,
    ) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        match op {
            RecipeOperation::ReplaceText {
                leaf,
                from,
                to,
                text,
            } => {
                self.node_ref(leaf, index, b)?;
                self.unsigned(from, b)?;
                self.unsigned(to, b)?;
                self.text(text, b)?;
                if let (UnsignedExpr::Literal { value: a }, UnsignedExpr::Literal { value: z }) =
                    (from, to)
                    && a > z
                {
                    return Err(self.invalid("reversed static text range"));
                }
            }
            RecipeOperation::SetAttribute { node, key, value } => {
                b.units(key.len() as u64 + 1)?;
                if key.is_empty() {
                    return Err(self.invalid("empty attribute key"));
                }
                let target = self.node_ref(node, index, b)?;
                if let AttributeEdit::Set { value } = value {
                    self.value(value, b)?;
                    if let (Some(target), ValueExpr::Literal { value }) = (target, value) {
                        let literal = crate::copy_literal(value, b.work)?;
                        self.nodes[&target.type_id]
                            .attrs
                            .validate_literal_field(key, &literal, "/commands/attribute", b.work)
                            .map_err(static_error)?;
                    }
                }
            }
            RecipeOperation::SetMarks { leaf, marks } => {
                let target = self.node_ref(leaf, index, b)?;
                self.mark_templates(marks, b)?;
                if let Some(target) = target {
                    for mark in marks {
                        if self.nodes[&target.type_id]
                            .allowed
                            .binary_search(&mark.type_id)
                            .is_err()
                        {
                            return Err(self.invalid("created target mark not allowed"));
                        }
                    }
                }
            }
            RecipeOperation::InsertFragment {
                parent,
                index: at,
                fragment,
            } => {
                self.node_ref(parent, index, b)?;
                self.unsigned(at, b)?;
                b.cap(
                    fragment.len() as u64,
                    b.limits.json_values,
                    "template fragment width",
                )?;
                for node in fragment {
                    self.node_template(node, 1, b)?;
                }
            }
        }
        Ok(())
    }
    fn position(
        &self,
        p: &PositionTemplate,
        index: usize,
        b: &mut Budget<'_>,
    ) -> Result<(), RegistryDiagnostic> {
        match p {
            PositionTemplate::Text { node, offset, .. } => {
                self.node_ref(node, index, b)?;
                self.unsigned(offset, b)?;
            }
            PositionTemplate::Child {
                parent, index: at, ..
            } => {
                self.node_ref(parent, index, b)?;
                self.unsigned(at, b)?;
            }
            PositionTemplate::Edge { node, .. } => {
                self.node_ref(node, index, b)?;
            }
        }
        Ok(())
    }
}
fn static_error(mut e: RegistryDiagnostic) -> RegistryDiagnostic {
    if e.code != E::ResourceLimitExceeded {
        e.code = E::InvalidRecipe;
    }
    e
}

impl FrozenRegistry {
    pub fn command(&self, id: &str) -> Option<CommandRef<'_>> {
        self.commands.get(id).map(|c| CommandRef {
            descriptor: &c.descriptor,
            owner: &c.owner,
            value_parameters: c.values.as_ref(),
        })
    }
    pub fn catalog_ids(&self) -> &[String] {
        &self.catalog
    }
    pub fn compiled_catalog_ids(&self) -> &[String] {
        &self.compiled_catalog
    }
}

pub(crate) fn preflight_commands(
    commands: &[CommandDescriptor],
    b: &mut Budget<'_>,
) -> Result<(), RegistryDiagnostic> {
    fn text(s: &str, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.cap(
            s.len() as u64,
            b.limits.descriptor_bytes,
            "recipe text bytes",
        )?;
        b.units(s.len() as u64 + 1)
    }
    fn node_ref(r: &NodeRef, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        match r {
            NodeRef::Argument { name } => text(name, b)?,
            NodeRef::Created { path, .. } => {
                b.cap(path.len() as u64, 128, "created path")?;
                b.units(path.len() as u64)?;
            }
        }
        Ok(())
    }
    fn expr(v: &ValueExpr, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        match v {
            ValueExpr::Argument { name } => text(name, b)?,
            ValueExpr::Literal { value } => {
                let remaining = b.work.limits();
                let used = b.work.usage();
                let usage = editor_core::admission::preflight_json(
                    value,
                    editor_core::admission::PreflightBudget {
                        payload_bytes: remaining.bytes.saturating_sub(used.bytes),
                        values: remaining.units.saturating_sub(used.units),
                        depth: b.limits.json_depth,
                    },
                )
                .map_err(|_| b.resource("typed literal preflight"))?;
                b.units(
                    usage
                        .values
                        .checked_add(usage.payload_bytes)
                        .ok_or_else(|| b.resource("typed literal work"))?,
                )?;
            }
        }
        Ok(())
    }
    fn unsigned(v: &UnsignedExpr, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        if let UnsignedExpr::Argument { name } = v {
            text(name, b)?;
        }
        Ok(())
    }
    fn fields(
        values: &BTreeMap<String, ValueExpr>,
        b: &mut Budget<'_>,
    ) -> Result<(), RegistryDiagnostic> {
        b.cap(values.len() as u64, b.limits.attr_rules, "template fields")?;
        for (key, value) in values {
            text(key, b)?;
            expr(value, b)?;
        }
        Ok(())
    }
    fn marks(values: &[MarkTemplate], b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.cap(
            values.len() as u64,
            b.limits.node_mark_declarations,
            "template marks",
        )?;
        for mark in values {
            text(&mark.type_id, b)?;
            fields(&mark.attributes, b)?;
        }
        Ok(())
    }
    fn node(n: &NodeTemplate, depth: u64, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        b.cap(depth, 128, "template depth")?;
        text(&n.type_id, b)?;
        fields(&n.attributes, b)?;
        marks(&n.marks, b)?;
        if let Some(t) = &n.text {
            expr(t, b)?;
        }
        b.cap(
            n.children.len() as u64,
            b.limits.json_values,
            "template child count",
        )?;
        for c in &n.children {
            node(c, depth + 1, b)?;
        }
        Ok(())
    }
    fn position(p: &PositionTemplate, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        match p {
            PositionTemplate::Text { node, offset, .. } => {
                node_ref(node, b)?;
                unsigned(offset, b)?;
            }
            PositionTemplate::Child { parent, index, .. } => {
                node_ref(parent, b)?;
                unsigned(index, b)?;
            }
            PositionTemplate::Edge { node, .. } => node_ref(node, b)?,
        }
        Ok(())
    }
    b.cap(commands.len() as u64, 256, "command catalog")?;
    for c in commands {
        text(c.id(), b)?;
        if let CommandDescriptor::Recipe {
            parameters,
            operations,
            selection,
            stored_marks,
            ..
        } = c
        {
            b.cap(parameters.len() as u64, 64, "recipe parameters")?;
            b.cap(operations.len() as u64, 256, "recipe operations")?;
            for name in parameters.keys() {
                text(name, b)?;
            }
            for op in operations {
                b.units(1)?;
                match op {
                    RecipeOperation::ReplaceText {
                        leaf,
                        from,
                        to,
                        text: v,
                    } => {
                        node_ref(leaf, b)?;
                        unsigned(from, b)?;
                        unsigned(to, b)?;
                        expr(v, b)?;
                    }
                    RecipeOperation::SetAttribute { node, key, value } => {
                        node_ref(node, b)?;
                        text(key, b)?;
                        if let AttributeEdit::Set { value } = value {
                            expr(value, b)?;
                        }
                    }
                    RecipeOperation::SetMarks { leaf, marks: m } => {
                        node_ref(leaf, b)?;
                        marks(m, b)?;
                    }
                    RecipeOperation::InsertFragment {
                        parent,
                        index,
                        fragment,
                    } => {
                        node_ref(parent, b)?;
                        unsigned(index, b)?;
                        b.cap(
                            fragment.len() as u64,
                            b.limits.json_values,
                            "template fragment count",
                        )?;
                        for n in fragment {
                            node(n, 1, b)?;
                        }
                    }
                }
            }
            if let RecipeSelection::Set { selection: Some(s) }
            | RecipeSelection::MapFromUserResult { selection: Some(s) } = selection.as_ref()
            {
                position(&s.anchor, b)?;
                position(&s.focus, b)?;
            }
            if let RecipeStoredMarks::Set { marks: m } = stored_marks {
                marks(m, b)?;
            }
        }
    }
    Ok(())
}
