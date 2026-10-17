// SPDX-License-Identifier: MIT OR Apache-2.0
// Independent, test-only reference. No Rust/WASM import, runtime package or CMS input.
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN_MAGNITUDE = 1n << 63n;
class NumericToken {
  constructor(token) { this.token = token; }
}

function requireScalars(text) {
  for (const scalar of text) {
    const code = scalar.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) throw new SyntaxError('Unpaired surrogate');
  }
  return text;
}

// Retain each number's lexical token before any JS Number conversion.
function parse(text) {
  let offset = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[offset] ?? '') && offset < text.length) offset++; };
  function string() {
    const start = offset++;
    while (offset < text.length) {
      const next = text[offset++];
      if (next === '\\') { offset++; continue; }
      if (next === '"') return requireScalars(JSON.parse(text.slice(start, offset)));
    }
    throw new SyntaxError('Unterminated string');
  }
  function value(depth = 0) {
    if (depth > 128) throw new RangeError('Reference tool depth');
    whitespace();
    const next = text[offset];
    if (next === '"') return string();
    if (next === '[' || next === '{') {
      offset++;
      const object = next === '{';
      const close = object ? '}' : ']';
      const result = object ? new Map() : [];
      whitespace();
      if (text[offset] === close) { offset++; return result; }
      while (true) {
        whitespace();
        let key;
        if (object) {
          if (text[offset] !== '"') throw new SyntaxError('Object key');
          key = string(); whitespace();
          if (text[offset++] !== ':') throw new SyntaxError('Object separator');
        }
        const child = value(depth + 1);
        if (object) result.set(key, child); else result.push(child);
        whitespace();
        const delimiter = text[offset++];
        if (delimiter === close) return result;
        if (delimiter !== ',') throw new SyntaxError('Container separator');
      }
    }
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, offset)) { offset += word.length; return literal; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(offset));
    if (!number) throw new SyntaxError('JSON value');
    offset += number[0].length;
    return new NumericToken(number[0]);
  }
  const result = value(); whitespace();
  if (offset !== text.length) throw new SyntaxError('Trailing input');
  return result;
}

// Pinned default serde_json parser representation: exact u64/i64 when possible;
// otherwise finite binary64, using a bounded decimal significand and powers of ten.
function representedNumber(token) {
  const parts = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  const [, minus, integer, fraction, explicitExponent] = parts;
  if (fraction === undefined && explicitExponent === undefined) {
    const magnitude = BigInt(integer);
    if ((!minus && magnitude <= U64_MAX) || (minus && magnitude > 0n && magnitude <= I64_MIN_MAGNITUDE)) {
      return { integer: minus ? -magnitude : magnitude };
    }
  }
  let significand = 0n;
  let exponent = 0;
  let full = false;
  for (const digit of integer) {
    const next = significand * 10n + BigInt(digit);
    if (full || next > U64_MAX) { full = true; exponent++; }
    else significand = next;
  }
  // An overflowing integer discards remaining integer digits; fraction processing
  // still starts with the retained significand, matching the pinned parse contract.
  full = false;
  for (const digit of fraction ?? '') {
    const next = significand * 10n + BigInt(digit);
    if (full || next > U64_MAX) full = true;
    else { significand = next; exponent--; }
  }
  const lexicalExponent = BigInt(explicitExponent ?? '0');
  if (lexicalExponent > 2147483647n || lexicalExponent < -2147483647n) {
    if (significand !== 0n && lexicalExponent > 0n) throw new RangeError('Number out of range');
    return { float: minus ? -0 : 0 };
  }
  exponent += Number(lexicalExponent);
  let number = Number(significand);
  while (Math.abs(exponent) > 308) {
    if (number === 0) break;
    if (exponent > 0) throw new RangeError('Number out of range');
    number /= 1e308; exponent += 308;
  }
  if (Math.abs(exponent) <= 308) {
    const power = Number(`1e${Math.abs(exponent)}`);
    number = exponent >= 0 ? number * power : number / power;
  }
  if (!Number.isFinite(number)) throw new RangeError('Number out of range');
  return { float: minus ? -number : number };
}

function formatNumber(token) {
  const represented = representedNumber(token);
  if ('integer' in represented) return represented.integer.toString();
  const number = represented.float;
  const sign = number < 0 || Object.is(number, -0) ? '-' : '';
  if (number === 0) return `${sign}0.0`;
  // V8 supplies an independent shortest round-trip decimal for the represented
  // binary64. Apply the pinned Rust formatting layout, not JSON.stringify's layout.
  const [coefficient, power] = Math.abs(number).toExponential().split('e');
  const exponent = Number(power);
  const digits = coefficient.replace('.', '');
  if (exponent < -5 || exponent > 15) return `${sign}${coefficient}e${exponent >= 0 ? '+' : ''}${exponent}`;
  const point = exponent + 1;
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function compareScalars(left, right) {
  const a = Array.from(left, scalar => scalar.codePointAt(0));
  const b = Array.from(right, scalar => scalar.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function serialize(value) {
  if (value instanceof NumericToken) return formatNumber(value.token);
  if (value instanceof Map) return `{${[...value.keys()].sort(compareScalars).map(key => `${JSON.stringify(key)}:${serialize(value.get(key))}`).join(',')}}`;
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  return JSON.stringify(value);
}

export function canonicalizeRaw(text) {
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new RangeError('Reference tool size');
  return serialize(parse(text));
}
