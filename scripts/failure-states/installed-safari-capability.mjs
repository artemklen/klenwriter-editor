// SPDX-License-Identifier: MIT OR Apache-2.0
// Source/capability disposition, not a browser observation or acceptance result.
// No Safari/MCP call is performed when this module is imported.
export const installedSafariCapability={
  format:'osr67-installed-safari-capability-boundary/1',status:'NOT_RUN',methodGate:'BLOCKED',
  browser:'installed Safari',
  affected:{domRows:Array.from({length:11},(_,index)=>`AC1-${String(index+1).padStart(2,'0')}`),
    compiledRuntimePhases:['before_dispatch','after_publication']},
  sourceBasis:'Exposed Safari MCP tool descriptions and existing ordinary Safari Apple Events adapter; no browser probe performed',
  available:{
    list_network_requests:'Retrospective Inspector request summaries; optional clear/filter/since/tab',
    get_network_request:'Request detail with text response body only when available within the tool cap',
    evaluate_javascript:'Evaluation in an already active tab/frame',
    appleEvents:'JavaScript evaluation after a fixture document exists',
  },
  missingFromTheseInterfaces:[
    'Request interception before decision, with record then abort for every unexpected attempt',
    'Context initialization hook before the first page navigation and document script execution',
    'Complete exact delivered binary response bytes for source-hash verification',
  ],
  consequence:'These interfaces cannot supply the frozen exact AC1 request/CSP method. Functional page evaluation or retrospective network summaries must not be promoted to full installed PASS.',
  qualification:'This is a boundary of the currently exposed interfaces, not proof that every Safari automation interface lacks these capabilities. No assertions changed; no results or user disposition inferred.',
  physicalInput:false,osClipboard:false,capture:false,
};
