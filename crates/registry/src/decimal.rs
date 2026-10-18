// SPDX-License-Identifier: MIT OR Apache-2.0
//! Exact comparison of bounded decimal spellings of represented JSON numbers.
use crate::{Budget, RegistryDiagnostic, RegistryErrorCode as E, error};
use std::cmp::Ordering;
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Decimal {
    negative: bool,
    digits: Vec<u8>,
    exponent: i64,
}
impl Decimal {
    pub fn parse(s: &str, b: &mut Budget<'_>, path: &str) -> Result<Self, RegistryDiagnostic> {
        b.cap(s.len() as u64, b.limits.decimal_bytes, "decimal bytes")?;
        b.units(s.len() as u64 + 1)?;
        b.alloc(s.len() as u64 + 32)?;
        let bytes = s.as_bytes();
        let mut i = 0usize;
        let negative = bytes.first() == Some(&b'-');
        if negative {
            i += 1;
        }
        let invalid = || error(E::InvalidNumericBound, path, "JSON decimal required");
        let mut digits = Vec::new();
        match bytes.get(i) {
            Some(b'0') => {
                digits.push(b'0');
                i += 1;
                if bytes.get(i).is_some_and(u8::is_ascii_digit) {
                    return Err(invalid());
                }
            }
            Some(b'1'..=b'9') => {
                while bytes.get(i).is_some_and(u8::is_ascii_digit) {
                    digits.push(bytes[i]);
                    i += 1;
                }
            }
            _ => return Err(invalid()),
        }
        let mut fraction = 0i64;
        if bytes.get(i) == Some(&b'.') {
            i += 1;
            let start = i;
            while bytes.get(i).is_some_and(u8::is_ascii_digit) {
                digits.push(bytes[i]);
                i += 1;
                fraction += 1;
            }
            if i == start {
                return Err(invalid());
            }
        }
        let mut exponent = 0i64;
        if matches!(bytes.get(i), Some(b'e' | b'E')) {
            i += 1;
            let mut sign = 1i64;
            if matches!(bytes.get(i), Some(b'+' | b'-')) {
                if bytes[i] == b'-' {
                    sign = -1;
                }
                i += 1;
            }
            let start = i;
            while bytes.get(i).is_some_and(u8::is_ascii_digit) {
                exponent = exponent
                    .checked_mul(10)
                    .and_then(|n| n.checked_add((bytes[i] - b'0') as i64))
                    .ok_or_else(|| b.resource("decimal exponent"))?;
                if exponent as u64 > b.limits.decimal_abs_exponent {
                    return Err(b.resource("decimal exponent"));
                }
                i += 1;
            }
            if start == i {
                return Err(invalid());
            }
            exponent *= sign;
        }
        if i != bytes.len() {
            return Err(invalid());
        }
        b.cap(
            digits.len() as u64,
            b.limits.decimal_digits,
            "decimal coefficient",
        )?;
        exponent -= fraction;
        let first = digits.iter().position(|d| *d != b'0');
        match first {
            None => Ok(Self {
                negative: false,
                digits: vec![b'0'],
                exponent: 0,
            }),
            Some(first) => {
                digits.drain(..first);
                while digits.len() > 1 && digits.last() == Some(&b'0') {
                    digits.pop();
                    exponent += 1;
                }
                Ok(Self {
                    negative,
                    digits,
                    exponent,
                })
            }
        }
    }
    pub fn cmp(&self, other: &Self) -> Ordering {
        let zero = self.digits == b"0";
        let other_zero = other.digits == b"0";
        if zero && other_zero {
            return Ordering::Equal;
        }
        if self.negative != other.negative {
            return self.negative.cmp(&other.negative).reverse();
        }
        let magnitude = if zero {
            Ordering::Less
        } else if other_zero {
            Ordering::Greater
        } else {
            let left = self.digits.len() as i64 + self.exponent;
            let right = other.digits.len() as i64 + other.exponent;
            left.cmp(&right).then_with(|| {
                for i in 0..self.digits.len().max(other.digits.len()) {
                    let order = self
                        .digits
                        .get(i)
                        .copied()
                        .unwrap_or(b'0')
                        .cmp(&other.digits.get(i).copied().unwrap_or(b'0'));
                    if order != Ordering::Equal {
                        return order;
                    }
                }
                Ordering::Equal
            })
        };
        if self.negative {
            magnitude.reverse()
        } else {
            magnitude
        }
    }
    pub fn canonical(&self) -> String {
        format!(
            "{}{}e{}",
            if self.negative { "-" } else { "" },
            std::str::from_utf8(&self.digits).expect("decimal digits"),
            self.exponent
        )
    }
}
