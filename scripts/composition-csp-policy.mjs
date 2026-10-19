// SPDX-License-Identifier: MIT OR Apache-2.0
import {createHash} from 'node:crypto';

// Exact, non-executable declaration serialized by Chromium's native paragraph
// move with the default editor stylesheet. This is source-authored, never learned
// from an event/report/request or expanded at runtime. See docs/composition.md.
export const compositionUaStyle = 'white-space: pre-wrap; display: inline !important; float: none;';
export const compositionUaStyleHash = createHash('sha256').update(compositionUaStyle).digest('base64');
export const compositionStyleDirective = `style-src-attr 'unsafe-hashes' 'sha256-${compositionUaStyleHash}' 'report-sample'`;
