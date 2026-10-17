// SPDX-License-Identifier: MIT OR Apache-2.0
//! Borrow handles first, admit length, then explicitly copy bounded bytes.
use crate::codec::{self, Context, Operation, Response};
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
    let input = match context.copy_admitted(length as u64, || {
        let mut bytes = vec![0; length as usize];
        copy_input(input, &mut bytes)
            .map_err(|_| codec::transport("codec.input_unavailable", "/input"))?;
        Ok(bytes)
    }) {
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
