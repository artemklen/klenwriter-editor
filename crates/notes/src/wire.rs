// SPDX-License-Identifier: MIT OR Apache-2.0
//! Canonical-v1 serialization borrows the candidate. Ordinary validation counts
//! bytes; explicit export alone owns the resulting byte buffer.
use std::io::{self, Write};

use editor_core::candidate::CandidateRead;
use editor_core::document::{Attribute, Attributes, Mark};
use editor_core::transaction::{WorkMeter, WorkPhase};
use serde::ser::{Error, SerializeMap, SerializeSeq, SerializeStruct};
use serde::{Serialize, Serializer};

use crate::{NotesError, NotesErrorCode as E, NotesLimits};

struct Attr<'a>(&'a Attribute);
impl Serialize for Attr<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Attribute::Null => serializer.serialize_none(),
            Attribute::Boolean(value) => serializer.serialize_bool(*value),
            Attribute::Number(value) => value.serialize(serializer),
            Attribute::String(value) => serializer.serialize_str(value),
            Attribute::List(values) => {
                let mut output = serializer.serialize_seq(Some(values.len()))?;
                for value in values {
                    output.serialize_element(&Attr(value))?;
                }
                output.end()
            }
            Attribute::Object(values) => Attrs(values).serialize(serializer),
        }
    }
}
struct Attrs<'a>(&'a Attributes);
impl Serialize for Attrs<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut output = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in self.0 {
            output.serialize_entry(key, &Attr(value))?;
        }
        output.end()
    }
}
struct MarkWire<'a>(&'a Mark);
impl Serialize for MarkWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut output = serializer.serialize_struct("Mark", 2)?;
        output.serialize_field("attrs", &Attrs(&self.0.attributes))?;
        output.serialize_field("type", &self.0.type_id)?;
        output.end()
    }
}
struct Marks<'a>(&'a [Mark]);
impl Serialize for Marks<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut output = serializer.serialize_seq(Some(self.0.len()))?;
        for mark in self.0 {
            output.serialize_element(&MarkWire(mark))?;
        }
        output.end()
    }
}
struct Children<'a, V: CandidateRead> {
    view: &'a V,
    ids: &'a [V::Id],
}
impl<V: CandidateRead> Serialize for Children<'_, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut output = serializer.serialize_seq(Some(self.ids.len()))?;
        for id in self.ids {
            output.serialize_element(&NodeWire {
                view: self.view,
                id: *id,
            })?;
        }
        output.end()
    }
}
struct NodeWire<'a, V: CandidateRead> {
    view: &'a V,
    id: V::Id,
}
impl<V: CandidateRead> Serialize for NodeWire<'_, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let node = self
            .view
            .node(self.id)
            .ok_or_else(|| S::Error::custom("missing candidate node"))?;
        let mut output = serializer.serialize_struct("Node", 5)?;
        output.serialize_field("attrs", &Attrs(node.attributes))?;
        output.serialize_field(
            "children",
            &Children {
                view: self.view,
                ids: node.children,
            },
        )?;
        output.serialize_field("marks", &Marks(node.marks))?;
        output.serialize_field("text", &node.text)?;
        output.serialize_field("type", node.type_id)?;
        output.end()
    }
}
struct Envelope<'a, V: CandidateRead>(&'a V);
impl<V: CandidateRead> Serialize for Envelope<'_, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let root = self
            .0
            .roots()
            .first()
            .ok_or_else(|| S::Error::custom("missing semantic root"))?;
        let mut output = serializer.serialize_struct("Envelope", 2)?;
        output.serialize_field(
            "root",
            &NodeWire {
                view: self.0,
                id: *root,
            },
        )?;
        output.serialize_field("schema_version", &1u64)?;
        output.end()
    }
}

struct Sink<'a> {
    work: &'a mut WorkMeter,
    maximum: u64,
    length: u64,
    output: Option<Vec<u8>>,
    failure: Option<NotesError>,
}
impl Write for Sink<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let result = (|| {
            let next = self
                .length
                .checked_add(bytes.len() as u64)
                .ok_or_else(|| NotesError::new(E::ResourceLimitExceeded, ""))?;
            if next > self.maximum {
                return Err(NotesError::new(E::ResourceLimitExceeded, ""));
            }
            self.work.charge_bytes(bytes.len() as u64)?;
            self.work
                .note_phase(WorkPhase::Serialization, 0, bytes.len() as u64);
            if let Some(output) = &mut self.output {
                output.extend_from_slice(bytes);
            }
            self.length = next;
            Ok(())
        })();
        if let Err(error) = result {
            self.failure = Some(error);
            return Err(io::Error::other("notes serialization budget"));
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(crate) fn encode<V: CandidateRead>(
    view: &V,
    limits: NotesLimits,
    work: &mut WorkMeter,
    own_bytes: bool,
) -> Result<(u64, Option<Vec<u8>>), NotesError> {
    let output = if own_bytes {
        // Determine and charge the exact requested buffer capacity before its
        // allocation. Ordinary validation takes only the counting branch.
        let (length, _) = encode(view, limits, work, false)?;
        work.charge_bytes(length)?;
        Some(Vec::with_capacity(length as usize))
    } else {
        None
    };
    // Precharge every borrowed field before serde scans strings for escaping.
    crate::borrowed::walk(view, limits, work, |_, node, _, work| {
        crate::borrowed::metadata(node, work)?;
        work.charge_units(node.text.map_or(0, |text| text.len() as u64))?;
        work.note_phase(WorkPhase::Serialization, 1, 0);
        Ok(())
    })?;
    let mut sink = Sink {
        work,
        maximum: limits.document_bytes,
        length: 0,
        output,
        failure: None,
    };
    let result = serde_json::to_writer(&mut sink, &Envelope(view));
    if let Some(error) = sink.failure {
        return Err(error);
    }
    result.map_err(|_| NotesError::new(E::InvalidStructure, ""))?;
    Ok((sink.length, sink.output))
}
