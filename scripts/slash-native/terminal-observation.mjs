// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';

export function untrustedTerminalObservation(preedit,after,action){
 // Qualified UNOBSERVED only; all fixed semantic/history checks run first.
 // Rule frozen before this candidate in v1.1/installed-observed-terminal.md.
 assert.equal(action.action,'complete-e');assert.equal(action.status,'completed');
 assert.equal(action.caseId,after.caseId);assert.equal(preedit.id,after.id);assert.equal(preedit.caseId,after.caseId);
 assert.equal(preedit.composition.starts,1);assert.equal(preedit.composition.open,true);assert.equal(preedit.composition.ends,0);
 assert.equal(preedit.composition.observedEnded,false);assert.deepEqual(preedit.composition.terminals,[]);
 assert.equal(after.composition.starts,1);assert.equal(after.composition.open,true);assert.equal(after.composition.ends,0);assert.equal(after.composition.observedEnded,true);
 const terminalEvents=after.inputTrace.filter(row=>row.event==='compositionend');assert.equal(terminalEvents.length,1);
 const terminal=terminalEvents[0];assert.equal(terminal.isTrusted,false);assert.equal(terminal.mountId,after.id);
 assert.equal(after.composition.terminals.length,1);const recorded=after.composition.terminals[0];
 assert.deepEqual(recorded,{ordinal:terminal.ordinal,time:terminal.time,isTrusted:false,mountId:after.id,clock:terminal.clock});
 assert.deepEqual(preedit.observation.clock,after.observation.clock);assert.deepEqual(terminal.clock,after.observation.clock);
 const {trustedDown, trustedUp}=action.domAcknowledgement;assert.equal(trustedDown.length,1);assert.equal(trustedUp.length,1);
 const down=trustedDown[0],up=trustedUp[0];
 for(const row of [down,up]){assert.equal(row.isTrusted,true);assert.equal(row.code,'KeyE');assert.equal(row.mountId,after.id);assert.deepEqual(row.clock,terminal.clock);assert.deepEqual(after.inputTrace[row.ordinal-1],row);}
 assert.ok(down.ordinal>action.inputTraceBefore&&down.ordinal<terminal.ordinal&&terminal.ordinal<up.ordinal);
 assert.ok(down.time<=terminal.time&&terminal.time<=up.time);
 return {classification:'UNOBSERVED',reason:'original_complete_e_observed_untrusted_terminal_missing_trusted_end',
  mountId:after.id,clock:terminal.clock,terminal,originalKey:{down,up},trustedCountersUnchanged:true,
  scope:'Exact fixed native settlement/history verified separately; no trusted-end, still-open generation or positive composition claim'};
}
