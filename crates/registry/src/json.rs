// SPDX-License-Identifier: MIT OR Apache-2.0
//! Borrowed syntax/duplicate-key preflight before descriptor ownership.
use crate::{RegistryDiagnostic, RegistryErrorCode as E, charge, error, pointer};
use editor_core::transaction::{WorkMeter, WorkPhase};
use std::collections::BTreeSet;
#[derive(Debug, Clone, Copy)]
pub struct JsonLimits {
    pub bytes: u64,
    pub depth: u64,
    pub values: u64,
}
#[derive(Debug, Clone, Copy, Default)]
pub struct JsonUsage {
    pub bytes: u64,
    pub depth: u64,
    pub values: u64,
}
pub fn preflight_json(
    input: &[u8],
    limits: JsonLimits,
    work: &mut WorkMeter,
) -> Result<JsonUsage, RegistryDiagnostic> {
    let start = work.usage();
    let result = preflight_json_inner(input, limits, work);
    crate::with_work_usage(result, start, work)
}
fn preflight_json_inner(
    input: &[u8],
    limits: JsonLimits,
    work: &mut WorkMeter,
) -> Result<JsonUsage, RegistryDiagnostic> {
    let limits = JsonLimits {
        bytes: limits.bytes.min(16 * 1024 * 1024),
        depth: limits.depth.min(128),
        values: limits.values.min(1_000_000),
    };
    if input.len() as u64 > limits.bytes {
        return Err(error(E::ResourceLimitExceeded, "", "JSON bytes"));
    }
    charge(work, input.len() as u64, 0)?;
    work.note_phase(WorkPhase::Preflight, 1, input.len() as u64);
    let mut s = Scan {
        input,
        pos: 0,
        limits,
        usage: JsonUsage {
            bytes: input.len() as u64,
            ..JsonUsage::default()
        },
        work,
    };
    s.value(1, "")?;
    s.ws();
    if s.pos != input.len() {
        return Err(error(E::InvalidJson, "", "trailing JSON"));
    }
    Ok(s.usage)
}
struct Scan<'a, 'b> {
    input: &'a [u8],
    pos: usize,
    limits: JsonLimits,
    usage: JsonUsage,
    work: &'b mut WorkMeter,
}
impl<'a> Scan<'a, '_> {
    fn ws(&mut self) {
        while self
            .input
            .get(self.pos)
            .is_some_and(|b| b" \r\n\t".contains(b))
        {
            self.pos += 1;
        }
    }
    fn byte(&mut self, b: u8) -> bool {
        self.ws();
        if self.input.get(self.pos) == Some(&b) {
            self.pos += 1;
            true
        } else {
            false
        }
    }
    fn string(&mut self) -> Result<&'a [u8], RegistryDiagnostic> {
        self.ws();
        let start = self.pos;
        if self.input.get(self.pos) != Some(&b'"') {
            return Err(error(E::InvalidJson, "", "JSON string"));
        }
        self.pos += 1;
        while let Some(&b) = self.input.get(self.pos) {
            self.pos += 1;
            match b {
                b'"' => return Ok(&self.input[start..self.pos]),
                b'\\' => {
                    if self.pos >= self.input.len() {
                        break;
                    }
                    self.pos += 1;
                }
                0..=31 => break,
                _ => {}
            }
        }
        Err(error(E::InvalidJson, "", "unterminated string"))
    }
    fn value(&mut self, depth: u64, path: &str) -> Result<(), RegistryDiagnostic> {
        self.ws();
        self.usage.values += 1;
        self.usage.depth = self.usage.depth.max(depth);
        if depth > self.limits.depth || self.usage.values > self.limits.values {
            return Err(error(E::ResourceLimitExceeded, path, "JSON values/depth"));
        }
        charge(self.work, 1, 0)?;
        match self.input.get(self.pos) {
            Some(b'{') => {
                self.pos += 1;
                let mut keys = BTreeSet::new();
                if self.byte(b'}') {
                    return Ok(());
                }
                loop {
                    let encoded = self.string()?;
                    let n = encoded.len() as u64;
                    charge(self.work, 1, n * 4 + 64)?;
                    let key: String = serde_json::from_slice(encoded)
                        .map_err(|_| error(E::InvalidJson, path, "invalid JSON key"))?;
                    charge(
                        self.work,
                        path.len() as u64 + key.len() as u64,
                        path.len() as u64 + key.len() as u64 * 2 + 1,
                    )?;
                    let child = pointer(path, &key);
                    if !keys.insert(key) {
                        return Err(error(
                            E::DuplicateJsonKey,
                            &child,
                            "duplicate JSON object key",
                        ));
                    }
                    if !self.byte(b':') {
                        return Err(error(E::InvalidJson, path, "missing colon"));
                    }
                    self.value(depth + 1, &child)?;
                    if self.byte(b'}') {
                        break;
                    }
                    if !self.byte(b',') {
                        return Err(error(E::InvalidJson, path, "missing comma"));
                    }
                }
            }
            Some(b'[') => {
                self.pos += 1;
                if self.byte(b']') {
                    return Ok(());
                }
                let mut i = 0u64;
                loop {
                    charge(self.work, path.len() as u64 + 1, path.len() as u64 + 32)?;
                    self.value(depth + 1, &format!("{path}/{i}"))?;
                    i += 1;
                    if self.byte(b']') {
                        break;
                    }
                    if !self.byte(b',') {
                        return Err(error(E::InvalidJson, path, "missing comma"));
                    }
                }
            }
            Some(b'"') => {
                let encoded = self.string()?;
                let _: serde::de::IgnoredAny = serde_json::from_slice(encoded)
                    .map_err(|_| error(E::InvalidJson, path, "invalid JSON string"))?;
            }
            Some(_) => {
                let start = self.pos;
                while self
                    .input
                    .get(self.pos)
                    .is_some_and(|b| !b" \r\n\t,]}".contains(b))
                {
                    self.pos += 1;
                }
                if start == self.pos {
                    return Err(error(E::InvalidJson, path, "missing value"));
                }
                let _: serde::de::IgnoredAny = serde_json::from_slice(&self.input[start..self.pos])
                    .map_err(|_| error(E::InvalidJson, path, "invalid JSON scalar"))?;
            }
            None => return Err(error(E::InvalidJson, path, "missing value")),
        }
        Ok(())
    }
}
