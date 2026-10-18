// SPDX-License-Identifier: MIT OR Apache-2.0
use crate::{attrs::normalize_bounds, *};
use editor_core::profile::{BindingError, ExtensionBinding, ProfileBinding};
use editor_core::transaction::WorkMeter;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RegistryDigest([u8; 32]);
impl RegistryDigest {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn to_hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}
#[derive(Debug)]
pub struct FrozenRegistry {
    binding: ProfileBinding,
    digest: RegistryDigest,
    order: Vec<ExtensionBinding>,
    usage: RegistryUsage,
    pub(crate) nodes: BTreeMap<String, CompiledNode>,
    pub(crate) marks: BTreeMap<String, CompiledMark>,
    pub(crate) root: CompiledGrammar,
    pub(crate) commands: BTreeMap<String, crate::recipes::CompiledCommand>,
    pub(crate) catalog: Vec<String>,
    pub(crate) compiled_catalog: Vec<String>,
}
#[derive(Debug)]
pub(crate) struct CompiledNode {
    pub descriptor: NodeDescriptor,
    pub owner: String,
    pub attrs: CompiledAttributes,
    pub grammar: CompiledGrammar,
    pub allowed: Vec<String>,
}
#[derive(Debug)]
pub(crate) struct CompiledMark {
    pub descriptor: MarkDescriptor,
    pub owner: String,
    pub attrs: CompiledAttributes,
}
#[derive(Debug, Clone, Copy)]
pub struct NodeDescriptorRef<'a> {
    pub descriptor: &'a NodeDescriptor,
    pub owner: &'a str,
    pub(crate) allowed: &'a [String],
}
impl<'a> NodeDescriptorRef<'a> {
    pub fn allowed_marks(self) -> &'a [String] {
        self.allowed
    }
}
#[derive(Debug, Clone, Copy)]
pub struct MarkDescriptorRef<'a> {
    pub descriptor: &'a MarkDescriptor,
    pub owner: &'a str,
}
impl FrozenRegistry {
    pub fn binding(&self) -> &ProfileBinding {
        &self.binding
    }
    pub fn digest(&self) -> RegistryDigest {
        self.digest
    }
    pub fn extension_order(&self) -> &[ExtensionBinding] {
        &self.order
    }
    pub fn usage(&self) -> RegistryUsage {
        self.usage
    }
    pub fn node(&self, id: &str) -> Option<NodeDescriptorRef<'_>> {
        self.nodes.get(id).map(|n| NodeDescriptorRef {
            descriptor: &n.descriptor,
            owner: &n.owner,
            allowed: &n.allowed,
        })
    }
    pub fn mark(&self, id: &str) -> Option<MarkDescriptorRef<'_>> {
        self.marks.get(id).map(|n| MarkDescriptorRef {
            descriptor: &n.descriptor,
            owner: &n.owner,
        })
    }
}
pub fn compile_json(
    input: &[u8],
    mandatory: &[ExtensionDescriptor],
    limits: CompilerLimits,
    work: &mut WorkMeter,
) -> Result<FrozenRegistry, RegistryDiagnostic> {
    let start = work.usage();
    let effective = limits.effective();
    let result = work.with_budget(
        editor_core::transaction::WorkLimits {
            units: effective.work_units,
            bytes: effective.owned_bytes,
        },
        |work| compile_json_inner(input, mandatory, effective, work),
    );
    finish_compile(result, start, work)
}
pub fn compile_descriptor(
    descriptor: &RegistryDescriptor,
    mandatory: &[ExtensionDescriptor],
    limits: CompilerLimits,
    work: &mut WorkMeter,
) -> Result<FrozenRegistry, RegistryDiagnostic> {
    let start = work.usage();
    let effective = limits.effective();
    let result = work.with_budget(
        editor_core::transaction::WorkLimits {
            units: effective.work_units,
            bytes: effective.owned_bytes,
        },
        |work| compile_descriptor_inner(descriptor, mandatory, effective, work),
    );
    finish_compile(result, start, work)
}
fn finish_compile(
    result: Result<FrozenRegistry, RegistryDiagnostic>,
    start: editor_core::transaction::WorkUsage,
    work: &WorkMeter,
) -> Result<FrozenRegistry, RegistryDiagnostic> {
    let end = work.usage();
    let delta = editor_core::transaction::WorkUsage {
        units: end.units.saturating_sub(start.units),
        bytes: end.bytes.saturating_sub(start.bytes),
    };
    crate::with_work_usage(
        result.map(|mut registry| {
            registry.usage.work = delta;
            registry
        }),
        start,
        work,
    )
}
fn compile_json_inner(
    input: &[u8],
    mandatory: &[ExtensionDescriptor],
    limits: CompilerLimits,
    work: &mut WorkMeter,
) -> Result<FrozenRegistry, RegistryDiagnostic> {
    let mut b = Budget::new(limits, work);
    b.units(1)?;
    b.cap(
        input.len() as u64,
        b.limits.descriptor_bytes,
        "descriptor bytes",
    )?;
    b.units(input.len() as u64)?;
    b.alloc(input.len() as u64 * 24 + 256)?;
    let usage = preflight_json(
        input,
        JsonLimits {
            bytes: b.limits.descriptor_bytes,
            depth: b.limits.json_depth,
            values: b.limits.json_values,
        },
        b.work,
    )?;
    b.usage.descriptor_bytes = usage.bytes;
    b.usage.json_values = usage.values;
    let descriptor: RegistryDescriptor = serde_json::from_slice(input).map_err(|_| {
        error(
            RegistryErrorCode::InvalidDescriptor,
            "",
            "closed registry descriptor",
        )
    })?;
    typed_depth(&descriptor, mandatory, &mut b)?;
    for e in mandatory {
        let len = count_serialized(e, &mut b)?;
        b.alloc(len * 24 + 256)?;
    }
    let result = assemble(&descriptor, mandatory, &mut b);
    result.map_err(|mut e| {
        e.usage = Box::new(b.usage);
        e
    })
}
fn compile_descriptor_inner(
    descriptor: &RegistryDescriptor,
    mandatory: &[ExtensionDescriptor],
    limits: CompilerLimits,
    work: &mut WorkMeter,
) -> Result<FrozenRegistry, RegistryDiagnostic> {
    let mut b = Budget::new(limits, work);
    b.units(1)?;
    typed_depth(descriptor, mandatory, &mut b)?;
    let length = count_serialized(descriptor, &mut b)?;
    b.usage.descriptor_bytes = length;
    b.alloc(length * 24 + 256)?;
    for e in mandatory {
        let len = count_serialized(e, &mut b)?;
        b.alloc(len * 24 + 256)?;
    }
    let result = assemble(descriptor, mandatory, &mut b);
    result.map_err(|mut e| {
        e.usage = Box::new(b.usage);
        e
    })
}
fn mapped(e: BindingError, path: &str) -> RegistryDiagnostic {
    error(
        match e {
            BindingError::InvalidVersion { .. } => RegistryErrorCode::InvalidVersion,
            BindingError::InvalidIdentifier { .. } => RegistryErrorCode::InvalidIdentifier,
            _ => RegistryErrorCode::ResourceLimitExceeded,
        },
        path,
        "profile binding identity",
    )
}
fn identity(id: &str, version: &str, path: &str) -> Result<ExtensionBinding, RegistryDiagnostic> {
    ExtensionBinding::new(id, version).map_err(|e| mapped(e, path))
}
fn assemble(
    d: &RegistryDescriptor,
    mandatory: &[ExtensionDescriptor],
    b: &mut Budget<'_>,
) -> Result<FrozenRegistry, RegistryDiagnostic> {
    use RegistryErrorCode as E;
    if d.format != "editor-registry/1" {
        return Err(error(E::UnsupportedFormat, "/format", "registry format"));
    }
    b.cap(
        (d.extensions.len() + mandatory.len()) as u64,
        b.limits.extensions,
        "extensions",
    )?;
    b.cap(
        d.selected_extensions.len() as u64,
        b.limits.extensions,
        "selected extensions",
    )?;
    let mut ext = BTreeMap::new();
    let mut ext_paths = BTreeMap::new();
    let mut public_nodes = BTreeSet::new();
    let mut public_marks = BTreeSet::new();
    for (i, e) in mandatory.iter().chain(d.extensions.iter()).enumerate() {
        b.units(1)?;
        let path = if i < mandatory.len() {
            format!("/mandatory/{i}")
        } else {
            format!("/extensions/{}", i - mandatory.len())
        };
        identity(&e.id, &e.version, &path)?;
        b.alloc(e.id.len() as u64 + 128)?;
        if ext.insert(e.id.clone(), e).is_some() {
            return Err(error(
                E::DuplicateExtension,
                &pointer(&path, "id"),
                "extension owner duplicated",
            ));
        }
        b.alloc(path.len() as u64 + 64)?;
        ext_paths.insert(e.id.as_str(), path.clone());
        for (index, node) in e.nodes.iter().enumerate() {
            let node_path = format!("{path}/nodes/{index}/id");
            b.units(node.id.len() as u64 + 1)?;
            if !identifier(&node.id) {
                return Err(error(E::InvalidIdentifier, &node_path, "node ID"));
            }
            b.alloc(node.id.len() as u64 + 64)?;
            if !public_nodes.insert(node.id.clone()) {
                return Err(error(E::DuplicateNode, &node_path, "node owner conflict"));
            }
        }
        for (index, mark) in e.marks.iter().enumerate() {
            let mark_path = format!("{path}/marks/{index}/id");
            b.units(mark.id.len() as u64 + 1)?;
            if !identifier(&mark.id) {
                return Err(error(E::InvalidIdentifier, &mark_path, "mark ID"));
            }
            b.alloc(mark.id.len() as u64 + 64)?;
            if !public_marks.insert(mark.id.clone()) {
                return Err(error(E::DuplicateMark, &mark_path, "mark owner conflict"));
            }
        }
        b.cap(
            (public_nodes.len() + public_marks.len()) as u64,
            b.limits.node_mark_declarations,
            "declarations",
        )?;
    }
    let mut selected = BTreeMap::new();
    for e in &d.selected_extensions {
        identity(&e.id, &e.version, "/selected_extensions")?;
        b.units(1)?;
        b.alloc(e.id.len() as u64 + 64)?;
        if selected.insert(e.id.clone(), e.version.as_str()).is_some() {
            return Err(error(
                E::DuplicateExtension,
                "/selected_extensions",
                "selected owner duplicated",
            ));
        }
        let offered = ext.get(&e.id).ok_or_else(|| {
            error(
                E::ExtensionMissing,
                "/selected_extensions",
                "extension missing",
            )
        })?;
        if offered.version != e.version {
            return Err(error(
                E::ExtensionVersionMismatch,
                "/selected_extensions",
                "exact extension version",
            ));
        }
    }
    if ext.keys().any(|id| !selected.contains_key(id)) {
        return Err(error(
            E::ExtensionMissing,
            "/selected_extensions",
            "unselected registration",
        ));
    }
    let mut pending = BTreeMap::new();
    for (id, e) in &ext {
        let mut deps = BTreeSet::new();
        b.cap(
            e.dependencies.len() as u64,
            b.limits.extensions,
            "dependency count",
        )?;
        for dep in &e.dependencies {
            b.units(1)?;
            identity(&dep.id, &dep.version, "/extensions/dependencies")?;
            let actual = ext.get(&dep.id).ok_or_else(|| {
                error(
                    E::DependencyMissing,
                    "/extensions/dependencies",
                    "explicit dependency missing",
                )
            })?;
            if actual.version != dep.version {
                return Err(error(
                    E::DependencyVersionMismatch,
                    "/extensions/dependencies",
                    "exact dependency version",
                ));
            }
            b.alloc(dep.id.len() as u64 + 64)?;
            if !deps.insert(dep.id.clone()) {
                return Err(error(
                    E::InvalidDescriptor,
                    "/extensions/dependencies",
                    "duplicate dependency",
                ));
            }
        }
        b.alloc(id.len() as u64 + 64)?;
        pending.insert(id.clone(), deps);
    }
    let mut order = Vec::new();
    let mut completed = BTreeSet::new();
    while !pending.is_empty() {
        b.units(pending.len() as u64 + 1)?;
        let mut next = None;
        for (id, deps) in &pending {
            b.units(deps.len() as u64 + 1)?;
            if deps.iter().all(|dep| completed.contains(dep)) {
                next = Some(id.as_str());
                break;
            }
        }
        let next = next.ok_or_else(|| {
            error(
                E::DependencyCycle,
                "/extensions/dependencies",
                "explicit dependency cycle",
            )
        })?;
        b.alloc(next.len() as u64 + 128)?;
        let next = next.to_owned();
        b.alloc(next.len() as u64 + 128)?;
        let e = ext[&next];
        order.push(identity(&e.id, &e.version, "/extensions")?);
        pending.remove(&next);
        completed.insert(next);
    }
    let bindings: Vec<_> = d
        .selected_extensions
        .iter()
        .map(|e| identity(&e.id, &e.version, "/selected_extensions"))
        .collect::<Result<_, _>>()?;
    let binding = ProfileBinding::new(
        &d.profile.id,
        &d.profile.version,
        &d.profile.codec_id,
        d.profile.wire_version,
        &bindings,
    )
    .map_err(|e| mapped(e, "/profile"))?;
    let root = CompiledGrammar::build(&d.root, &public_nodes, b, "/root")?;
    let mut nodes = BTreeMap::new();
    let mut marks = BTreeMap::new();
    for e in ext.values() {
        for (index, mark) in e.marks.iter().enumerate() {
            let path = format!("{}/marks/{index}", ext_paths[e.id.as_str()]);
            check_marks(
                &mark.excludes,
                &public_marks,
                &pointer(&path, "excludes"),
                b,
            )?;
            let attrs = CompiledAttributes::build(&mark.attrs, b, 1, &pointer(&path, "attrs"))?;
            marks.insert(
                mark.id.clone(),
                CompiledMark {
                    descriptor: mark.clone(),
                    owner: e.id.clone(),
                    attrs,
                },
            );
        }
        for (index, node) in e.nodes.iter().enumerate() {
            let path = format!("{}/nodes/{index}", ext_paths[e.id.as_str()]);
            check_marks(&node.marks, &public_marks, &pointer(&path, "marks"), b)?;
            let attrs = CompiledAttributes::build(&node.attrs, b, 1, &pointer(&path, "attrs"))?;
            let grammar = CompiledGrammar::build(
                &node.children,
                &public_nodes,
                b,
                &pointer(&path, "children"),
            )?;
            let mut allowed = d.mark_policy.get(&node.id).unwrap_or(&node.marks).clone();
            allowed.sort();
            nodes.insert(
                node.id.clone(),
                CompiledNode {
                    descriptor: node.clone(),
                    owner: e.id.clone(),
                    attrs,
                    grammar,
                    allowed,
                },
            );
        }
    }
    for (id, allowed) in &d.mark_policy {
        b.units(1)?;
        if !public_nodes.contains(id) {
            return Err(error(E::UnknownType, "/mark_policy", "policy node unknown"));
        }
        check_marks(allowed, &public_marks, &pointer("/mark_policy", id), b)?;
    }
    let command_tables = crate::recipes::compile_commands(&ext, mandatory, &nodes, &marks, b)?;
    let digest = canonical_digest(d, &ext, b)?;
    Ok(FrozenRegistry {
        binding,
        digest,
        order,
        usage: b.usage,
        nodes,
        marks,
        root,
        commands: command_tables.commands,
        catalog: command_tables.catalog,
        compiled_catalog: command_tables.compiled,
    })
}
fn check_marks(
    ids: &[String],
    known: &BTreeSet<String>,
    path: &str,
    b: &mut Budget<'_>,
) -> Result<(), RegistryDiagnostic> {
    let mut seen = BTreeSet::new();
    b.cap(
        ids.len() as u64,
        b.limits.node_mark_declarations,
        "mark references",
    )?;
    for (index, id) in ids.iter().enumerate() {
        let path = format!("{path}/{index}");
        b.units(id.len() as u64 + 1)?;
        if !identifier(id) {
            return Err(error(
                RegistryErrorCode::InvalidIdentifier,
                &path,
                "mark ID",
            ));
        }
        if !known.contains(id) {
            return Err(error(
                RegistryErrorCode::UnknownMark,
                &path,
                "unknown selected mark",
            ));
        }
        b.alloc(32)?;
        if !seen.insert(id) {
            return Err(error(
                RegistryErrorCode::InvalidDescriptor,
                &path,
                "duplicate mark reference",
            ));
        }
    }
    Ok(())
}
fn canonical_digest(
    d: &RegistryDescriptor,
    extensions: &BTreeMap<String, &ExtensionDescriptor>,
    b: &mut Budget<'_>,
) -> Result<RegistryDigest, RegistryDiagnostic> {
    // Precharged descriptor ownership includes this bounded semantic clone.
    let mut canonical = d.clone();
    canonical.extensions = extensions.values().map(|e| (*e).clone()).collect();
    canonical
        .selected_extensions
        .sort_by(|a, b| a.id.cmp(&b.id));
    for marks in canonical.mark_policy.values_mut() {
        marks.sort();
    }
    for e in &mut canonical.extensions {
        e.dependencies.sort_by(|a, b| a.id.cmp(&b.id));
        e.nodes.sort_by(|a, b| a.id.cmp(&b.id));
        e.marks.sort_by(|a, b| a.id.cmp(&b.id));
        e.commands.sort_by(|a, b| a.id().cmp(b.id()));
        for c in &mut e.commands {
            if let CommandDescriptor::Recipe { parameters, .. } = c {
                for p in parameters.values_mut() {
                    if let Parameter::Value { schema } = p {
                        normalize_bounds(schema, b)?;
                    }
                }
            }
        }
        for n in &mut e.nodes {
            n.marks.sort();
            for field in n.attrs.values_mut() {
                normalize_bounds(&mut field.value, b)?;
            }
        }
        for m in &mut e.marks {
            m.excludes.sort();
            for field in m.attrs.values_mut() {
                normalize_bounds(&mut field.value, b)?;
            }
        }
    }
    let mut writer = HashWriter {
        hash: Sha256::new(),
        b,
        refused: None,
    };
    writer
        .hash
        .update(b"klenwriter-editor-registry\0editor-registry/1\0");
    serde_json::to_writer(&mut writer, &canonical).map_err(|_| {
        writer.refused.take().unwrap_or_else(|| {
            error(
                RegistryErrorCode::InvalidDescriptor,
                "",
                "canonical registry encoding",
            )
        })
    })?;
    Ok(RegistryDigest(writer.hash.finalize().into()))
}
struct HashWriter<'a, 'b> {
    hash: Sha256,
    b: &'a mut Budget<'b>,
    refused: Option<RegistryDiagnostic>,
}
impl std::io::Write for HashWriter<'_, '_> {
    fn write(&mut self, s: &[u8]) -> std::io::Result<usize> {
        match self.b.units(s.len() as u64) {
            Ok(()) => {
                self.hash.update(s);
                Ok(s.len())
            }
            Err(e) => {
                self.refused = Some(e);
                Err(std::io::Error::other("registry work"))
            }
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn count_serialized<T: serde::Serialize>(
    value: &T,
    b: &mut Budget<'_>,
) -> Result<u64, RegistryDiagnostic> {
    struct Counter<'a, 'b> {
        b: &'a mut Budget<'b>,
        len: u64,
        refused: Option<RegistryDiagnostic>,
    }
    impl std::io::Write for Counter<'_, '_> {
        fn write(&mut self, s: &[u8]) -> std::io::Result<usize> {
            self.len = self
                .len
                .checked_add(s.len() as u64)
                .ok_or_else(|| std::io::Error::other("overflow"))?;
            if let Err(e) = self
                .b
                .cap(
                    self.len,
                    self.b.limits.descriptor_bytes,
                    "typed descriptor bytes",
                )
                .and_then(|()| self.b.units(s.len() as u64))
            {
                self.refused = Some(e);
                return Err(std::io::Error::other("registry cap"));
            }
            Ok(s.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut c = Counter {
        b,
        len: 0,
        refused: None,
    };
    serde_json::to_writer(&mut c, value).map_err(|_| {
        c.refused.take().unwrap_or_else(|| {
            error(
                RegistryErrorCode::ResourceLimitExceeded,
                "",
                "typed descriptor cap",
            )
        })
    })?;
    Ok(c.len)
}
fn typed_depth(
    d: &RegistryDescriptor,
    mandatory: &[ExtensionDescriptor],
    b: &mut Budget<'_>,
) -> Result<(), RegistryDiagnostic> {
    fn text(s: &str, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.cap(
            s.len() as u64,
            b.limits.descriptor_bytes,
            "typed string bytes",
        )?;
        b.units(s.len() as u64 + 1)
    }
    fn grammar(g: &Grammar, depth: u64, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        b.cap(depth, b.limits.grammar_depth, "typed grammar depth")?;
        match g {
            Grammar::Type { id } => text(id, b)?,
            Grammar::Sequence { items } | Grammar::Choice { items } => {
                b.cap(
                    items.len() as u64,
                    b.limits.grammar_operators,
                    "typed grammar width",
                )?;
                for item in items {
                    grammar(item, depth + 1, b)?;
                }
            }
            Grammar::Repeat { item, .. } => grammar(item, depth + 1, b)?,
            _ => {}
        }
        Ok(())
    }
    fn fields(
        f: &BTreeMap<String, AttributeField>,
        depth: u64,
        b: &mut Budget<'_>,
    ) -> Result<(), RegistryDiagnostic> {
        b.cap(f.len() as u64, b.limits.attr_rules, "typed field width")?;
        for (key, field) in f {
            text(key, b)?;
            attr(&field.value, depth, b)?;
        }
        Ok(())
    }
    fn attr(a: &AttributeSchema, depth: u64, b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.units(1)?;
        b.cap(depth, b.limits.attr_depth, "typed attr depth")?;
        match a {
            AttributeSchema::Nullable { inner } | AttributeSchema::List { item: inner, .. } => {
                attr(inner, depth + 1, b)?
            }
            AttributeSchema::Object { fields: f } => fields(f, depth + 1, b)?,
            AttributeSchema::Number { min, max } | AttributeSchema::Integer { min, max } => {
                for s in [min, max].into_iter().flatten() {
                    text(s, b)?;
                }
            }
            AttributeSchema::Enum { values } => {
                b.cap(
                    values.len() as u64,
                    b.limits.json_values,
                    "typed enum width",
                )?;
                for s in values {
                    text(s, b)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    fn ids(values: &[String], b: &mut Budget<'_>) -> Result<(), RegistryDiagnostic> {
        b.cap(
            values.len() as u64,
            b.limits.node_mark_declarations,
            "typed reference count",
        )?;
        for id in values {
            text(id, b)?;
        }
        Ok(())
    }
    b.cap(
        (d.extensions.len() + mandatory.len()) as u64,
        b.limits.extensions,
        "typed extensions",
    )?;
    b.cap(
        d.selected_extensions.len() as u64,
        b.limits.extensions,
        "typed selection",
    )?;
    text(&d.format, b)?;
    text(&d.profile.id, b)?;
    text(&d.profile.version, b)?;
    text(&d.profile.codec_id, b)?;
    for e in &d.selected_extensions {
        text(&e.id, b)?;
        text(&e.version, b)?;
    }
    grammar(&d.root, 1, b)?;
    b.cap(
        d.mark_policy.len() as u64,
        b.limits.node_mark_declarations,
        "typed policies",
    )?;
    for (id, marks) in &d.mark_policy {
        text(id, b)?;
        ids(marks, b)?;
    }
    let mut declarations = 0u64;
    let mut commands = 0u64;
    for e in d.extensions.iter().chain(mandatory) {
        commands = commands
            .checked_add(e.commands.len() as u64)
            .ok_or_else(|| b.resource("command count"))?;
        b.cap(commands, 256, "command catalog")?;
        crate::recipes::preflight_commands(&e.commands, b)?;
        for command in &e.commands {
            if let CommandDescriptor::Recipe { parameters, .. } = command {
                for parameter in parameters.values() {
                    if let Parameter::Value { schema } = parameter {
                        attr(schema, 1, b)?;
                    }
                }
            }
        }
        text(&e.id, b)?;
        text(&e.version, b)?;
        b.cap(
            e.dependencies.len() as u64,
            b.limits.extensions,
            "typed dependencies",
        )?;
        for dep in &e.dependencies {
            text(&dep.id, b)?;
            text(&dep.version, b)?;
        }
        declarations = declarations
            .checked_add(e.nodes.len() as u64)
            .and_then(|n| n.checked_add(e.marks.len() as u64))
            .ok_or_else(|| b.resource("typed declarations overflow"))?;
        b.cap(
            declarations,
            b.limits.node_mark_declarations,
            "typed declarations",
        )?;
        for n in &e.nodes {
            text(&n.id, b)?;
            ids(&n.marks, b)?;
            grammar(&n.children, 1, b)?;
            fields(&n.attrs, 1, b)?;
        }
        for m in &e.marks {
            text(&m.id, b)?;
            ids(&m.excludes, b)?;
            fields(&m.attrs, 1, b)?;
        }
    }
    Ok(())
}
