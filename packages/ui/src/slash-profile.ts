// SPDX-License-Identifier: MIT OR Apache-2.0
import type { UiSlashChoice, UiSlashProfile } from './types.js';
import { fields, id, list, text, UiError } from './data.js';

function keywords(value:unknown):readonly string[] {
  const values=list(value);
  if(values.length>16)throw new UiError('ui.limit');
  return Object.freeze(values.map(item=>{
    if(typeof item!=='string'||!item.length)throw new UiError('ui.invalid_options');
    if(item.length>64)throw new UiError('ui.limit');
    return item;
  }));
}
/** Presentation metadata only. Every constructed command is queried natively. */
export function slashProfile(value:unknown):UiSlashProfile {
  const f=fields(value,['textBlockTypes','choices']);
  const types=list(f.textBlockTypes).map(id), seen=new Set<string>();
  if(new Set(types).size!==types.length)throw new UiError('ui.invalid_options');
  const choices=list(f.choices).map(value=>{
    const c=fields(value,['id','label','keywords','command']), key=id(c.id);
    if(seen.has(key)||typeof c.command!=='function')throw new UiError('ui.invalid_options');
    seen.add(key);
    const k=fields(c.keywords,['ru','en']);
    return Object.freeze({id:key,label:text(c.label),keywords:Object.freeze({ru:keywords(k.ru),en:keywords(k.en)}),
      command:c.command as UiSlashChoice['command']});
  });
  return Object.freeze({textBlockTypes:Object.freeze(types),choices:Object.freeze(choices)});
}
