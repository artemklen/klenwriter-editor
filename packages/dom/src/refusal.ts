// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, StampDto } from '@klenwriter/editor-sdk';
import type { DomCode, DomDiagnostic, DomRefusal } from './types.js';

/** Adapter failures never impersonate an atomic native response. */
export function domRefusal(code: DomCode, phase: DomDiagnostic['phase'], stamp: DeepReadonly<StampDto> | null = null,
  node: string | null = null, typeId: string | null = null, publication: DomDiagnostic['publication'] = 'none'): DomRefusal {
  return Object.freeze({ status: 'dom_refused', diagnostic: Object.freeze({ code, phase, stamp, node, typeId, publication }) });
}
export function isDomRefusal(value: unknown): value is DomRefusal {
  return value !== null && typeof value === 'object' && 'status' in value && value.status === 'dom_refused';
}
