// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-authored before the first42 physical attempt. No candidate output is
// used to construct these expected canonical bytes, positions or paths.
const point=offset=>Object.freeze({kind:'text',node:'T',offset,affinity:'after'});
const caret=Object.freeze({anchor:point(2),focus:point(2)});
export const compositionSettlementLiterals=Object.freeze({
  kwdj:Object.freeze({
    source:Object.freeze({path:'contracts/ui/v1/geometry-fixtures.json',fixture:'F',sha256:'0e5c03c8b57802ad940e3c1e1c3b3ae3f3c972865879050ef6a394e33f1a017c'}),
    inputCanonical:'{"content":[{"content":[{"text":"A😀éאב","type":"text"}],"type":"paragraph"},{"content":[{"content":[{"text":"cd","type":"text"}],"type":"paragraph"}],"type":"blockquote"},{"type":"scene_break"},{"content":[{"text":"ef","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}',
    roles:Object.freeze({R:Object.freeze([]),P:Object.freeze([0]),T:Object.freeze([0,0]),Q:Object.freeze([1]),P2:Object.freeze([1,0]),U:Object.freeze([1,0,0]),S:Object.freeze([2]),P3:Object.freeze([3]),V:Object.freeze([3,0])}),
    selection:Object.freeze({anchor:point(1),focus:point(5)}),
    afterCanonical:'{"content":[{"content":[{"text":"Aéאב","type":"text"}],"type":"paragraph"},{"content":[{"content":[{"text":"cd","type":"text"}],"type":"paragraph"}],"type":"blockquote"},{"type":"scene_break"},{"content":[{"text":"ef","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}',
    afterSelection:caret,commandId:'org.klenwriter.kwdj/command/insert-text',afterText:'Aéאב',
  }),
  notes:Object.freeze({
    source:Object.freeze({path:'contracts/ui/v1/native-oracles.json',fixture:'V06-NC011-root-title-owned-metadata',sha256:'e064ba58d2c579c3cd9c58937a32a09591c8379a283543b40c2828919fe84470'}),
    inputCanonical:'{"root":{"attrs":{"tags":[],"title":""},"children":[{"attrs":{},"children":[{"attrs":{},"children":[],"marks":[],"text":"ab","type":"org.example.notes/text"}],"marks":[],"text":null,"type":"org.example.notes/paragraph"}],"marks":[],"text":null,"type":"org.example.notes/document"},"schema_version":1}',
    // The Notes semantic root is the synthetic engine root's first child.
    roles:Object.freeze({R:Object.freeze([]),D:Object.freeze([0]),P:Object.freeze([0,0]),T:Object.freeze([0,0,0])}),
    selection:Object.freeze({anchor:point(1),focus:point(1)}),
    afterCanonical:'{"root":{"attrs":{"tags":[],"title":""},"children":[{"attrs":{},"children":[{"attrs":{},"children":[],"marks":[],"text":"aéb","type":"org.example.notes/text"}],"marks":[],"text":null,"type":"org.example.notes/paragraph"}],"marks":[],"text":null,"type":"org.example.notes/document"},"schema_version":1}',
    afterSelection:caret,commandId:'org.example.notes/command/insert-text',afterText:'aéb',
  }),
});
export const compositionSettlementState=Object.freeze({stampDelta:Object.freeze({revision:1n,selection_epoch:1n,history_epoch:1n}),documentEvents:1,stateEvents:0,undoEntries:'1',redoEntries:'0',dirty:true,savedRevision:'0',storedMarks:null,payloadJson:'{"text":"é"}'});
