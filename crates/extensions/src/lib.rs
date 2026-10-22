// SPDX-License-Identifier: MIT OR Apache-2.0
//! Finite registry recipes over the actual typed profile and command pipeline.
//! No engine, concrete profile, browser callback, or alternate publisher lives here.
mod expand;
use editor_core::cache::PreparedValidation;
use editor_core::candidate::{CandidateChanges, CandidateRead};
use editor_core::commands::{
    CommandCatalog, CommandDescriptor, CommandPresentation, CommandProvider, CommandState,
    PlanBuilder,
};
use editor_core::document::{Attributes, Document, Mark};
use editor_core::positions::Selection;
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{
    Operation, TransactionProfile, ValidationStats, WorkLimits, WorkMeter,
};
use editor_registry::{
    FrozenRegistry, Parameter, RegistryDiagnostic, RegistryErrorCode, RegistryProfile,
    RegistryUsage,
};
use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecipeIntent<I> {
    pub id: String,
    pub nodes: BTreeMap<String, I>,
    pub values: Attributes,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Intent<I, C> {
    Compiled(C),
    Recipe(RecipeIntent<I>),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExtensionError<E> {
    Profile(E),
    Registry(RegistryDiagnostic),
}
pub type Error<E> = ExtensionError<E>;
impl<E: fmt::Display> fmt::Display for ExtensionError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Profile(e) => e.fmt(f),
            Self::Registry(e) => e.fmt(f),
        }
    }
}
impl<E: std::error::Error + 'static> std::error::Error for ExtensionError<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(match self {
            Self::Profile(e) => e,
            Self::Registry(e) => e,
        })
    }
}

pub(crate) fn diagnostic(
    code: RegistryErrorCode,
    detail: &'static str,
    work: &WorkMeter,
) -> RegistryDiagnostic {
    RegistryDiagnostic {
        code,
        path: String::new(),
        detail,
        child_index: None,
        usage: Box::new(RegistryUsage {
            work: work.usage(),
            ..RegistryUsage::default()
        }),
    }
}
pub(crate) fn charge(
    work: &mut WorkMeter,
    units: u64,
    bytes: u64,
) -> Result<(), RegistryDiagnostic> {
    work.charge_units(units).map_err(|_| {
        diagnostic(
            RegistryErrorCode::ResourceLimitExceeded,
            "recipe work",
            work,
        )
    })?;
    work.charge_bytes(bytes).map_err(|_| {
        diagnostic(
            RegistryErrorCode::ResourceLimitExceeded,
            "recipe owned bytes",
            work,
        )
    })
}

pub struct Recipes<P: CommandProvider + RegistryProfile> {
    profile: P,
}
impl<P: CommandProvider + RegistryProfile> Recipes<P> {
    pub fn new(profile: P, work: &mut WorkMeter) -> Result<Self, RegistryDiagnostic> {
        let catalog = profile.command_catalog();
        let count = catalog.len();
        if count > 256 {
            return Err(diagnostic(
                RegistryErrorCode::ResourceLimitExceeded,
                "compiled catalog",
                work,
            ));
        }
        charge(
            work,
            (count as u64) * (count as u64) + 1,
            catalog
                .ids()
                .map(|id| id.len().min(129) as u64)
                .sum::<u64>()
                + (count * std::mem::size_of::<&str>()) as u64,
        )?;
        catalog.validate().map_err(|_| {
            diagnostic(
                RegistryErrorCode::InvalidRecipe,
                "invalid compiled catalog",
                work,
            )
        })?;
        let mut actual: Vec<_> = catalog.ids().collect();
        actual.sort_unstable();
        let expected = profile.registry().compiled_catalog_ids();
        if actual.len() != expected.len() || actual.iter().zip(expected).any(|(a, b)| *a != b) {
            return Err(diagnostic(
                RegistryErrorCode::InvalidRecipe,
                "compiled catalog differs from mandatory registry",
                work,
            ));
        }
        Ok(Self { profile })
    }
    pub fn profile(&self) -> &P {
        &self.profile
    }
    fn prepare_recipe<I: Copy + Eq + Ord>(
        &self,
        intent: &RecipeIntent<I>,
        plan: &mut PlanBuilder<'_, I>,
    ) -> Result<CommandPresentation, RegistryDiagnostic> {
        let command = self.registry().command(&intent.id).ok_or_else(|| {
            diagnostic(
                RegistryErrorCode::InvalidRecipe,
                "unknown recipe",
                plan.work(),
            )
        })?;
        let editor_registry::CommandDescriptor::Recipe {
            parameters,
            operations,
            selection,
            stored_marks,
            ..
        } = command.descriptor
        else {
            return Err(diagnostic(
                RegistryErrorCode::InvalidRecipe,
                "recipe targets compiled command",
                plan.work(),
            ));
        };
        charge(
            plan.work(),
            (intent.nodes.len() + intent.values.len() + parameters.len()) as u64,
            0,
        )?;
        if parameters.len() > 64 || operations.len() > 256 {
            return Err(diagnostic(
                RegistryErrorCode::ResourceLimitExceeded,
                "recipe parameters or operations",
                plan.work(),
            ));
        }
        for key in intent.nodes.keys() {
            charge(plan.work(), 1, key.len() as u64)?;
            match parameters.get(key) {
                Some(Parameter::Node {}) => {}
                Some(Parameter::Value { .. }) => {
                    return Err(diagnostic(
                        RegistryErrorCode::ArgumentTypeMismatch,
                        "node/value category",
                        plan.work(),
                    ));
                }
                None => {
                    return Err(diagnostic(
                        RegistryErrorCode::UnknownArgument,
                        "unknown node argument",
                        plan.work(),
                    ));
                }
            }
        }
        for key in intent.values.keys() {
            charge(plan.work(), 1, key.len() as u64)?;
            match parameters.get(key) {
                Some(Parameter::Value { .. }) if !intent.nodes.contains_key(key) => {}
                Some(_) => {
                    return Err(diagnostic(
                        RegistryErrorCode::ArgumentTypeMismatch,
                        "node/value category",
                        plan.work(),
                    ));
                }
                None => {
                    return Err(diagnostic(
                        RegistryErrorCode::UnknownArgument,
                        "unknown value argument",
                        plan.work(),
                    ));
                }
            }
        }
        for (key, kind) in parameters {
            charge(plan.work(), 1, key.len() as u64)?;
            let present = match kind {
                Parameter::Node {} => intent.nodes.contains_key(key),
                Parameter::Value { .. } => intent.values.contains_key(key),
            };
            if !present {
                return Err(diagnostic(
                    RegistryErrorCode::RequiredArgumentMissing,
                    "required recipe argument",
                    plan.work(),
                ));
            }
        }
        command
            .value_parameters
            .ok_or_else(|| {
                diagnostic(
                    RegistryErrorCode::InvalidRecipe,
                    "missing compiled parameter policy",
                    plan.work(),
                )
            })?
            .validate(&intent.values, "/arguments/values", plan.work())?;
        expand::prepare(
            self.registry(),
            intent,
            operations,
            selection,
            stored_marks,
            plan,
        )?;
        Ok(CommandPresentation::default())
    }
}
impl<P: CommandProvider + RegistryProfile> RegistryProfile for Recipes<P> {
    fn registry(&self) -> &FrozenRegistry {
        self.profile.registry()
    }
}
impl<P: CommandProvider + RegistryProfile> FrozenProfile for Recipes<P> {
    type Context = P::Context;
    type Admitted = P::Admitted;
    type Error = ExtensionError<P::Error>;
    type Cache<I: Copy + Eq + Ord> = P::Cache<I>;
    fn binding(&self) -> &ProfileBinding {
        self.profile.binding()
    }
    fn transaction_work_limits(&self) -> Option<WorkLimits> {
        self.profile.transaction_work_limits()
    }
    fn admission_cache_work_limits(&self) -> WorkLimits {
        self.profile.admission_cache_work_limits()
    }
    fn admit_bytes(
        &self,
        b: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
    ) -> Result<Self::Admitted, Self::Error> {
        self.profile
            .admit_bytes(b, input, mode)
            .map_err(Error::Profile)
    }
    fn context(&self, a: &Self::Admitted) -> Self::Context {
        self.profile.context(a)
    }
    fn to_document(&self, a: &Self::Admitted) -> Document {
        self.profile.to_document(a)
    }
    fn admit_snapshot(
        &self,
        c: &Self::Context,
        d: &Document,
    ) -> Result<Self::Admitted, Self::Error> {
        self.profile.admit_snapshot(c, d).map_err(Error::Profile)
    }
    fn canonical<'a>(&self, a: &'a Self::Admitted) -> &'a [u8] {
        self.profile.canonical(a)
    }
    fn seed_cache<V: CandidateRead>(
        &self,
        a: &Self::Admitted,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<Self::Cache<V::Id>, Self::Error> {
        self.profile.seed_cache(a, v, w).map_err(Error::Profile)
    }
}
impl<P: CommandProvider + RegistryProfile> TransactionProfile for Recipes<P> {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.profile
            .normalize_candidate(c, v, w)
            .map_err(Error::Profile)
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.profile
            .validate_candidate(c, v, w)
            .map_err(Error::Profile)
    }
    fn normalize_scoped<V: CandidateChanges>(
        &self,
        c: &Self::Context,
        v: &V,
        cache: &Self::Cache<V::Id>,
        w: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.profile
            .normalize_scoped(c, v, cache, w)
            .map_err(Error::Profile)
    }
    fn validate_scoped<V: CandidateChanges>(
        &self,
        c: &Self::Context,
        v: &V,
        cache: &Self::Cache<V::Id>,
        w: &mut WorkMeter,
    ) -> Result<PreparedValidation<Self::Cache<V::Id>>, Self::Error> {
        self.profile
            .validate_scoped(c, v, cache, w)
            .map_err(Error::Profile)
    }
}
impl<P: CommandProvider + RegistryProfile> CommandProvider for Recipes<P> {
    type Intent<I: Copy + Eq + Ord> = Intent<I, P::Intent<I>>;
    const COMMANDS: &'static [CommandDescriptor] = &[];
    fn command_catalog(&self) -> CommandCatalog<'_> {
        CommandCatalog::Runtime(self.registry().catalog_ids())
    }
    fn command_id<I: Copy + Eq + Ord>(intent: &Self::Intent<I>) -> &str {
        match intent {
            Intent::Compiled(i) => P::command_id(i),
            Intent::Recipe(i) => &i.id,
        }
    }
    fn supports_input_command<I: Copy + Eq + Ord>(&self, intent: &Self::Intent<I>) -> bool {
        match intent {
            Intent::Compiled(intent) => self.profile.supports_input_command(intent),
            Intent::Recipe(_) => false,
        }
    }
    fn prepare_input_command<V: CandidateRead>(
        &self,
        context: &Self::Context,
        view: &V,
        state: CommandState<'_, V::Id>,
        intent: &Self::Intent<V::Id>,
        policy: editor_core::commands::InputCommandPolicy,
        plan: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        let Intent::Compiled(intent) = intent else {
            return Err(Error::Registry(diagnostic(
                RegistryErrorCode::InvalidRecipe,
                "input requires compiled registration",
                plan.work(),
            )));
        };
        let id = P::command_id(intent);
        charge(plan.work(), 1, id.len().min(129) as u64).map_err(Error::Registry)?;
        if self
            .registry()
            .compiled_catalog_ids()
            .binary_search_by(|expected| expected.as_str().cmp(id))
            .is_err()
        {
            return Err(Error::Registry(diagnostic(
                RegistryErrorCode::InvalidRecipe,
                "input requires compiled registration",
                plan.work(),
            )));
        }
        self.profile
            .prepare_input_command(context, view, state, intent, policy, plan)
            .map_err(Error::Profile)
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        s: CommandState<'_, V::Id>,
        i: &Self::Intent<V::Id>,
        p: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        match i {
            Intent::Compiled(i) => {
                let id = P::command_id(i);
                charge(p.work(), 1, id.len().min(129) as u64).map_err(Error::Registry)?;
                if self
                    .registry()
                    .compiled_catalog_ids()
                    .binary_search_by(|expected| expected.as_str().cmp(id))
                    .is_err()
                {
                    return Err(Error::Registry(diagnostic(
                        RegistryErrorCode::InvalidRecipe,
                        "compiled intent targets non-compiled registration",
                        p.work(),
                    )));
                }
                self.profile
                    .prepare_command(c, v, s, i, p)
                    .map_err(Error::Profile)
            }
            Intent::Recipe(i) => self.prepare_recipe(i, p).map_err(Error::Registry),
        }
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        s: Option<Selection<V::Id>>,
        m: Option<&[Mark]>,
        w: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.profile
            .finalize_typing_override(c, v, s, m, w)
            .map_err(Error::Profile)
    }
    fn error_code(e: &Self::Error) -> &'static str {
        match e {
            Error::Profile(e) => P::error_code(e),
            Error::Registry(e) => e.code.as_str(),
        }
    }
}
