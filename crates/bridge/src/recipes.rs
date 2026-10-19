// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded typed recipe transport, sharing the profile's exact frozen registry.
use crate::{
    BridgeAdapter,
    convert::{attrs_in, diagnostic},
};
use editor_core::{
    commands::CommandProvider,
    transaction::{WorkLimits, WorkMeter},
};
use editor_engine::{NodeId, SessionKey};
use editor_extensions::{ExtensionError, Intent, RecipeIntent, Recipes};
use editor_protocol::{AttributeDto, CommandDto, DiagnosticDto};
use editor_registry::{
    CommandDescriptor, FrozenRegistry, JsonLimits, Parameter, RegistryDiagnostic, RegistryProfile,
    preflight_json,
};
use serde::Deserialize;
use std::{collections::BTreeMap, sync::Arc};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Payload {
    Recipe { arguments: Arguments },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments {
    nodes: BTreeMap<String, String>,
    values: BTreeMap<String, AttributeDto>,
}

fn wire(payload: &str) -> Result<Arguments, DiagnosticDto> {
    if payload.len() > 65_536 {
        return Err(diagnostic("sdk.payload_limit", "command.payload_json"));
    }
    preflight_json(
        payload.as_bytes(),
        JsonLimits {
            bytes: 65_536,
            depth: 96,
            values: 65_536,
        },
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .map_err(|error| registry_diagnostic(&error))?;
    let Payload::Recipe { arguments } = crate::decode(payload)?;
    Ok(arguments)
}
pub fn registry_diagnostic(error: &RegistryDiagnostic) -> DiagnosticDto {
    let mut value = diagnostic(error.code.as_str(), &error.path);
    value.category = "registry".into();
    value.details.insert("reason".into(), error.detail.into());
    if let Some(index) = error.child_index {
        value
            .details
            .insert("child_index".into(), index.to_string());
    }
    value
}

fn intent(
    id: &str,
    args: Arguments,
    key: SessionKey,
    parameters: Option<&BTreeMap<String, Parameter>>,
) -> Result<RecipeIntent<NodeId>, DiagnosticDto> {
    let values = attrs_in(&args.values)?;
    if let Some(parameters) = parameters {
        for name in args.nodes.keys() {
            if args.values.contains_key(name)
                || matches!(parameters.get(name), Some(Parameter::Value { .. }))
            {
                return Err(diagnostic(
                    "registry.argument_type_mismatch",
                    &format!("arguments/{name}"),
                ));
            }
            if !parameters.contains_key(name) {
                return Err(diagnostic(
                    "registry.unknown_argument",
                    &format!("arguments/{name}"),
                ));
            }
        }
        for name in args.values.keys() {
            match parameters.get(name) {
                Some(Parameter::Node {}) => {
                    return Err(diagnostic(
                        "registry.argument_type_mismatch",
                        &format!("arguments/{name}"),
                    ));
                }
                None => {
                    return Err(diagnostic(
                        "registry.unknown_argument",
                        &format!("arguments/{name}"),
                    ));
                }
                _ => {}
            }
        }
        for name in parameters.keys() {
            if !args.nodes.contains_key(name) && !args.values.contains_key(name) {
                return Err(diagnostic(
                    "registry.required_argument_missing",
                    &format!("arguments/{name}"),
                ));
            }
        }
    }
    let nodes = args
        .nodes
        .into_iter()
        .map(|(name, token)| {
            let id = key.parse_node_token(&token).map_err(|_| {
                diagnostic(
                    "registry.invalid_node_argument",
                    &format!("arguments/nodes/{name}"),
                )
            })?;
            Ok((name, id))
        })
        .collect::<Result<_, DiagnosticDto>>()?;
    Ok(RecipeIntent {
        id: id.into(),
        nodes,
        values,
    })
}

/// Transport decoding alone confers no argument-schema or execution privilege.
/// The real provider always revalidates native intents under PlanBuilder's meter.
pub fn decode_recipe_payload(
    id: &str,
    payload: &str,
    key: SessionKey,
) -> Result<RecipeIntent<NodeId>, DiagnosticDto> {
    intent(id, wire(payload)?, key, None)
}

pub struct RecipeAdapter<A> {
    inner: A,
    registry: Arc<FrozenRegistry>,
}
impl<A> RecipeAdapter<A> {
    pub fn new(inner: A, registry: Arc<FrozenRegistry>) -> Self {
        Self { inner, registry }
    }
    pub fn inner_mut(&mut self) -> &mut A {
        &mut self.inner
    }
}
impl<P, A> BridgeAdapter<Recipes<P>> for RecipeAdapter<A>
where
    P: CommandProvider + RegistryProfile,
    A: BridgeAdapter<P>,
{
    fn selection_text<V: editor_core::candidate::CandidateRead<Id = NodeId>>(
        &self,
        view: &V,
        selection: editor_core::positions::Selection<NodeId>,
        max_bytes: u32,
        work: &mut WorkMeter,
    ) -> Result<crate::SelectionTextData, DiagnosticDto> {
        self.inner.selection_text(view, selection, max_bytes, work)
    }
    fn decode_command(
        &self,
        key: SessionKey,
        command: &CommandDto,
    ) -> Result<Intent<NodeId, P::Intent<NodeId>>, DiagnosticDto> {
        match self
            .registry
            .command(&command.id)
            .map(|value| value.descriptor)
        {
            Some(CommandDescriptor::Compiled { .. }) => self
                .inner
                .decode_command(key, command)
                .map(Intent::Compiled),
            Some(CommandDescriptor::Recipe { parameters, .. }) => intent(
                &command.id,
                wire(&command.payload_json)?,
                key,
                Some(parameters),
            )
            .map(Intent::Recipe),
            // A valid unknown intent reaches the real engine catalog guard.
            None => {
                decode_recipe_payload(&command.id, &command.payload_json, key).map(Intent::Recipe)
            }
        }
    }
    fn profile_error(error: &ExtensionError<P::Error>) -> DiagnosticDto {
        match error {
            ExtensionError::Profile(error) => A::profile_error(error),
            ExtensionError::Registry(error) => registry_diagnostic(error),
        }
    }
}
