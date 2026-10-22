// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-first parser expectations: inert data and application-visible logical limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseClipboardHtml,clipboardParserLimits as limits} from '../packages/kwdj/dist/clipboard-parser.js';
const element=(tagName,children,attributes=[])=>({kind:'element',tagName,namespaceURI:'http://www.w3.org/1999/xhtml',attributes,children});
const text=value=>({kind:'text',value});
function parsed(source){const r=parseClipboardHtml(source);assert.equal(r.status,'parsed');return r;}
function bounded(r){assert.ok(r.usage.nodeRequests<=limits.nodeRequests);assert.ok(r.usage.workUnits<=limits.workUnits);assert.ok(r.usage.stringCopyUnits<=limits.stringCopyUnits);}
function immutableData(v){if(v&&typeof v==='object'){assert.equal(Object.isFrozen(v),true);for(const k of Object.keys(v)){assert.ok(!['parentNode','ownerDocument','nodeType'].includes(k));immutableData(v[k]);}}}
test('CPAR01 entities CRLF and marks become an immutable independent data tree',()=>{
 const r=parsed('<p>A&amp;B\r\ne\u0301<strong>X</strong><br></p>');
 assert.deepEqual(r.nodes,[element('p',[text('A&B\ne\u0301'),element('strong',[text('X')]),element('br',[])])]);immutableData(r);bounded(r);
});
test('CPAR02 source cap checked before construction; exact maximum is not truncated',()=>{
 const exact='x'.repeat(524288),r=parsed(exact);assert.deepEqual(r.nodes,[text(exact)]);bounded(r);
 const over=parseClipboardHtml(exact+'y');assert.equal(over.status,'refused');assert.equal(over.reason,'input_limit');assert.deepEqual(over.usage,{nodeRequests:0,attributes:0,workUnits:0,stringCopyUnits:0,maximumDepth:0});
});
test('CPAR03 nesting and broad construction have finite logical receipts',()=>{
 const deep=parseClipboardHtml('<div>'.repeat(80)+'x'+'</div>'.repeat(80));assert.equal(deep.status,'refused');assert.equal(deep.reason,'depth_limit');assert.equal(deep.usage.maximumDepth,65);bounded(deep);
 const wide=parseClipboardHtml('<br>'.repeat(50001));assert.equal(wide.status,'refused');assert.ok(['tree_limit','work_limit'].includes(wide.reason));bounded(wide);
});
test('CPAR04 attributes enforce per-element and per-value bounds',()=>{
 const attrs=Array.from({length:128},(_,i)=>`a${i}="x"`).join(' ');assert.equal(parsed('<p '+attrs+'>x</p>').nodes[0].attributes.length,128);
 const over=parseClipboardHtml('<p '+attrs+' more="x">x</p>');assert.equal(over.status,'refused');assert.equal(over.reason,'attribute_limit');
 assert.equal(parsed('<p title="'+'x'.repeat(8192)+'">x</p>').nodes[0].attributes[0].value.length,8192);
 const value=parseClipboardHtml('<p title="'+'x'.repeat(8193)+'">x</p>');assert.equal(value.status,'refused');assert.equal(value.reason,'attribute_limit');
});
test('CPAR05 templates and table foster text retain inert structure without live nodes',()=>{
 const template=parsed('<template><p>inner</p></template>');assert.deepEqual(template.nodes,[element('template',[element('p',[text('inner')])])]);
 const table=parsed('<table>before<tr><td>cell</td></tr>after</table>');assert.deepEqual(table.nodes,[text('beforeafter'),element('table',[element('tbody',[element('tr',[element('td',[text('cell')])])])])]);immutableData(table);
});
test('CPAR06 script and resource attributes remain data; parsing performs no host action',()=>{
 globalThis.__clipboardParserObserved=0;
 const r=parsed('<script>globalThis.__clipboardParserObserved=1</script><img src="https://example.test/image">');
 assert.deepEqual(r.nodes,[element('script',[text('globalThis.__clipboardParserObserved=1')]),element('img',[],[{name:'src',value:'https://example.test/image',namespace:null,prefix:null}])]);
 assert.equal(globalThis.__clipboardParserObserved,0);delete globalThis.__clipboardParserObserved;immutableData(r);
});
test('CPAR07 parse errors are bounded and never replaced by a partial successful tree',()=>{
 const r=parseClipboardHtml('<p a="x" a="y">x</p>'.repeat(40));assert.equal(r.status,'refused');assert.equal(r.reason,'parse_error');bounded(r);assert.equal('nodes'in r,false);
});
