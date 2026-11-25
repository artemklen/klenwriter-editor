// SPDX-License-Identifier: MIT OR Apache-2.0
//! Borrow handles first, admit length, then explicitly copy bounded bytes.
use crate::codec::{self, Context, Operation, Response};
use editor_kwdj::{IdentityResolver, IdentityResolverError, IdentityStatus, text_stats};
use serde::Serialize;
use uuid::Uuid;
use wasm_bindgen::prelude::*;

// Intrinsic getters do not trust shadowable .length/.buffer properties or
// user methods. Shared/resizable buffers and proxies are refused, so the
// synchronous admit/copy boundary cannot race another writer or resize.
#[wasm_bindgen(inline_js = "
const U8 = Uint8Array;
const typed = Object.getPrototypeOf(U8.prototype);
const getter = name => Object.getOwnPropertyDescriptor(typed, name).get;
const length = getter('length'), buffer = getter('buffer'), offset = getter('byteOffset');
const tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get;
const abLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const memoryBuffer = Object.getOwnPropertyDescriptor(WebAssembly.Memory.prototype, 'buffer').get;
const set = typed.set;
export function codecInputLength(value, memory) {
  try {
    if (tag.call(value) !== 'Uint8Array') return -1;
    const backing = buffer.call(value);
    abLength.call(backing); // refuses SharedArrayBuffer
    if (memory && backing === memoryBuffer.call(memory)) return -1;
    if (resizable && resizable.call(backing)) return -1;
    const count = length.call(value);
    new U8(backing, offset.call(value), count); // zero-copy detached-buffer check
    return count;
  } catch { return -1; }
}
export function codecOptionsLength(value) { return typeof value === 'string' ? value.length : -1; }
export function codecCopy(value, target) {
  if (codecInputLength(value) !== length.call(target)) throw new TypeError('codec input unavailable');
  set.call(target, value);
}
")]
extern "C" {
    #[wasm_bindgen(js_name = codecInputLength)]
    fn input_length(value: &JsValue, memory: &JsValue) -> f64;
    #[wasm_bindgen(js_name = codecOptionsLength)]
    fn options_length(value: &JsValue) -> f64;
    #[wasm_bindgen(catch, js_name = codecCopy)]
    fn copy_input(value: &JsValue, target: &mut [u8]) -> Result<(), JsValue>;
}

fn copy_admitted(
    context: &Context,
    input: &JsValue,
    length: f64,
) -> Result<Vec<u8>, Box<codec::Diagnostic>> {
    context.copy_admitted(length as u64, || {
        let mut bytes = vec![0; length as usize];
        copy_input(input, &mut bytes)
            .map_err(|_| codec::transport("codec.input_unavailable", "/input"))?;
        Ok(bytes)
    })
}

fn run(operation: Operation, input: &JsValue, options: &JsValue) -> String {
    // An alias of this module's memory could detach when options/Vec allocate.
    // Refuse it before any such allocation, preserving host-owned inputs.
    let length = input_length(input, &wasm_bindgen::memory());
    if length < 0.0 {
        return Response::refused(
            operation,
            codec::transport("codec.invalid_input_type", "/input"),
        )
        .json();
    }
    let option_length = options_length(options);
    if option_length < 0.0 {
        return Response::refused(
            operation,
            codec::transport("codec.invalid_options_type", "/options"),
        )
        .json();
    }
    if option_length > codec::MAX_OPTIONS_UTF16 as f64 {
        return Response::refused(
            operation,
            codec::transport("codec.options_too_large", "/options"),
        )
        .json();
    }
    // as_string copies only the bounded options; authored document still borrowed.
    let options = options
        .as_string()
        .expect("intrinsic checked primitive string");
    let context = match Context::parse(&options) {
        Ok(value) => value,
        Err(error) => return Response::refused(operation, error).json(),
    };
    let input = match copy_admitted(&context, input, length) {
        Ok(bytes) => bytes,
        Err(error) => return Response::refused(operation, error).json(),
    };
    context.run(operation, &input).json()
}

#[wasm_bindgen(js_name = kwdjValidateV1)]
pub fn validate(input: &JsValue, options: &JsValue) -> String {
    run(Operation::Validate, input, options)
}
#[wasm_bindgen(js_name = kwdjNormalizeV1)]
pub fn normalize(input: &JsValue, options: &JsValue) -> String {
    run(Operation::Normalize, input, options)
}
#[wasm_bindgen(js_name = kwdjCanonicalV1)]
pub fn canonical(input: &JsValue, options: &JsValue) -> String {
    run(Operation::Canonical, input, options)
}

// KWDJ has already parsed each authored identifier as a UUID at this boundary.
// Hosted tools check the document's structure. The server resolves identities
// against its own store when it accepts a save.
struct StructuralIdentities;

impl IdentityResolver for StructuralIdentities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }

    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
}

fn with_structural_input<T>(
    input: &JsValue,
    run: impl FnOnce(&Context, &[u8]) -> T,
) -> Result<T, Box<codec::Diagnostic>> {
    let length = input_length(input, &wasm_bindgen::memory());
    if length < 0.0 {
        return Err(codec::transport("codec.invalid_input_type", "/input"));
    }
    let context = Context::hosted();
    let input = copy_admitted(&context, input, length)?;
    Ok(run(&context, &input))
}

fn run_structural(operation: Operation, input: &JsValue) -> String {
    with_structural_input(input, |context, bytes| {
        context.run_with_identities(operation, bytes, &StructuralIdentities)
    })
    .unwrap_or_else(|error| Response::refused(operation, error))
    .json()
}

#[wasm_bindgen(js_name = kwdjAdmitStructurallyV1)]
pub fn admit_structurally(input: &JsValue) -> String {
    run_structural(Operation::Validate, input)
}

#[wasm_bindgen(js_name = kwdjNormalizeStructurallyV1)]
pub fn normalize_structurally(input: &JsValue) -> String {
    run_structural(Operation::Normalize, input)
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum TextStatsResponse {
    Accepted {
        full_text: String,
        word_count: u32,
        character_count: u32,
    },
    Refused {
        diagnostic: Box<codec::Diagnostic>,
    },
}

#[wasm_bindgen(js_name = kwdjProjectTextStatsV1)]
pub fn project_text_stats(input: &JsValue) -> String {
    let result = with_structural_input(input, |context, bytes| {
        let document = context.admit(Operation::Validate, bytes, &StructuralIdentities)?;
        let projected = document
            .project_text()
            .map_err(|error| codec::transport(error.code(), ""))?;
        let full_text = projected.full_text;
        Ok(TextStatsResponse::Accepted {
            word_count: text_stats::word_count(&full_text),
            character_count: text_stats::character_count(&full_text),
            full_text,
        })
    });
    let response = result
        .and_then(|response| response)
        .unwrap_or_else(|diagnostic| TextStatsResponse::Refused { diagnostic });
    serde_json::to_string(&response).expect("text statistics transport contains serializable DTOs")
}
