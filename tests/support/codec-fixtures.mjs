// SPDX-License-Identifier: MIT OR Apache-2.0
// Temporary immutable snapshot adapter; no CMS/DOM/import/render implementation.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalizeRaw } from '../../scripts/canonical-reference/reference.mjs';

export const options = extra => JSON.stringify({ abi: 'kwdj-codec/1', identities: { media: [], references: [] }, ...extra });
export const document = content => ({ schema: 'klenwriter.document', schema_version: 1, profile: 'prose', content });
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const canonical = value => canonicalizeRaw(JSON.stringify(value));
const measuredLimits = { document_bytes: 2097152, tree_depth: 32, node_count: 50000, text_length: 262144, table_rows: 500, table_effective_columns: 50, attribute_length: 8192 };

// Independent adapter from the snapshot's resource recipes. Exact metric checks
// below ensure a malformed generator cannot turn an over-limit case green.
function boundary(name, n) {
  switch (name) {
    case 'document_bytes': {
      const doc = document(Array.from({ length: 8 }, () => paragraph('')));
      let remaining = n - Buffer.byteLength(canonical(doc));
      for (const node of doc.content) { const count = Math.min(262144, remaining); node.content[0].text = 'a'.repeat(count); remaining -= count; }
      assert.equal(remaining, 0); return doc;
    }
    case 'tree_depth': { let node = paragraph('Depth'); for (let d = 2; d < n; d++) node = { type: 'blockquote', content: [node] }; return document([node]); }
    case 'node_count': return document([...(n % 2 ? [{ type: 'scene_break' }] : []), ...Array.from({ length: Math.floor(n / 2) }, () => paragraph('x'))]);
    case 'text_length': return document([paragraph('a'.repeat(n))]);
    case 'table_rows': return document([{ type: 'table', content: Array.from({ length: n }, () => ({ type: 'table_row', content: [{ type: 'table_cell', content: [paragraph('x')] }] })) }]);
    case 'table_effective_columns': return document([{ type: 'table', content: [{ type: 'table_row', content: Array.from({ length: n }, () => ({ type: 'table_cell', content: [paragraph('x')] })) }] }]);
    case 'attribute_length': return document([{ type: 'paragraph', content: [{ type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: '/x', title: 'a'.repeat(n) } }] }] }]);
    default: throw new Error(`Unknown boundary ${name}`);
  }
}
function measure(name, doc) {
  const nodes = [];
  const visit = (children, depth) => { for (const node of children) { nodes.push([node, depth]); visit(node.content ?? [], depth + 1); } };
  visit(doc.content, 1);
  switch (name) {
    // Generated boundary documents have ASCII keys/text and exact small integers;
    // sorting changes order, never byte length. Do not raise ADR004 tool's 2MiB cap.
    case 'document_bytes': return Buffer.byteLength(JSON.stringify(doc));
    case 'tree_depth': return Math.max(...nodes.map(([, d]) => d));
    case 'node_count': return nodes.length;
    case 'text_length': return Math.max(...nodes.map(([node]) => Buffer.byteLength(node.text ?? '')));
    case 'table_rows': return Math.max(...nodes.filter(([node]) => node.type === 'table').map(([node]) => node.content.length));
    case 'table_effective_columns': return Math.max(...nodes.filter(([node]) => node.type === 'table_row').map(([node]) => node.content.length));
    case 'attribute_length': return Math.max(...nodes.flatMap(([node]) => [node.attrs, ...(node.marks ?? []).map(mark => mark.attrs)]).flatMap(attrs => Object.values(attrs ?? {})).filter(v => typeof v === 'string').map(v => Buffer.byteLength(v)));
    default: throw new Error(name);
  }
}

export function corpus() {
  const provenance = JSON.parse(readFileSync('provenance/codec-fixtures.json'));
  assert.equal(provenance.sourceRevision, 'a7f8a081b7827dd31097ad6c9104654366ae6e04');
  const inputs = [], dispositions = [];
  let documents = 0, resourceCases = 0, resourceMeasurements = 0, deferred = 0, noCandidate = 0;
  for (const file of provenance.files) {
    const bytes = readFileSync(file.destination);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(bytes.length, file.bytes);
    for (const fixture of JSON.parse(bytes).fixtures) for (const c of fixture.cases) {
      const id = `${fixture.id}/${c.name}`, stages = c.pipeline_stages;
      const nonCodecStages = stages.filter(s => !['validate_normalize', 'determinism'].includes(s));
      if (c.expected.outcome === 'deferred') { deferred++; dispositions.push({ id, status: 'deferred', reason: 'Real later schema/converter absent; DOC-024 is not a codec pass', stages }); continue; }
      if (c.input.kind === 'resource_boundary') {
        resourceCases++;
        const recipe = c.input.value;
        assert.equal(recipe.limit_value, measuredLimits[recipe.limit_name]);
        for (const point of recipe.boundary_points) {
          const doc = boundary(recipe.limit_name, point.measured_value);
          assert.equal(measure(recipe.limit_name, doc), point.measured_value);
          const hostName = { text_length: 'text_leaf_bytes', attribute_length: 'authored_attribute_bytes' }[recipe.limit_name] ?? recipe.limit_name;
          // Attempted increases must still obey all seven normative ceilings.
          inputs.push({ id: `${id}/${point.position}`, input: JSON.stringify(doc), primary: 'normalize', options: options({ limits: { [hostName]: '18446744073709551615' } }),
            expectedStatus: point.position === 'over_limit' ? 'refused' : 'accepted',
            resource: { name: recipe.limit_name, maximum: String(recipe.limit_value), observed: String(point.measured_value) } });
          resourceMeasurements++;
        }
      } else if (c.kwdj == null) { noCandidate++; dispositions.push({ id, status: 'no_candidate', reason: 'Adapter/migration/clipboard stage has no KWDJ candidate', stages }); continue; }
      else {
        documents++;
        const preNormalized = c.input.kind === 'kwdj' && Object.hasOwn(c.input, 'value');
        const state = c.input.identity_state ?? {};
        const catalog = { media: (state.existing_media_ids ?? []).map(id => ({ id, status: 'exists' })), references: (state.existing_reference_ids ?? []).map(id => ({ id, status: 'exists' })) };
        inputs.push({ id, input: JSON.stringify(preNormalized ? c.input.value : c.kwdj), primary: preNormalized ? 'normalize' : 'validate', options: options({ identities: catalog }),
          expectedStatus: c.expected.outcome === 'accepted' ? 'accepted' : 'refused', expectedCanonical: c.expected.outcome === 'accepted' ? canonical(c.kwdj) : null,
          expectedCodes: c.expected.diagnostic_codes.filter(code => code.startsWith('kwdj.')), expectedManifests: { media: c.expected.media_manifest, references: c.expected.reference_manifest } });
      }
      dispositions.push({ id, status: 'codec_input', nonCodecStages: nonCodecStages.map(stage => ({ stage, status: 'not_executed', reason: 'Outside codec ABI76; full stage-aware gate belongs to OSR-30 and later owners' })) });
    }
  }
  assert.deepEqual({ documents, resourceCases, resourceMeasurements, deferred, noCandidate }, { documents: 39, resourceCases: 14, resourceMeasurements: 21, deferred: 1, noCandidate: 5 });
  assert.equal(dispositions.length, 59); assert.equal(inputs.length, 60);
  return { inputs, dispositions, summary: { documents, resourceCases, resourceMeasurements, deferred, noCandidate } };
}
