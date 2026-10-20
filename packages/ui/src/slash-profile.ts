// SPDX-License-Identifier: MIT OR Apache-2.0
import type { UiSlashChoice, UiSlashProfile } from './types.js';
import { fields, id, text, UiError } from './data.js';

function closedList(value:unknown,limit=32):readonly unknown[] {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)throw new UiError('ui.invalid_options');
  if(value.length>limit)throw new UiError('ui.limit');
  const descriptors=Object.getOwnPropertyDescriptors(value), keys=Reflect.ownKeys(descriptors);
  if(keys.length!==value.length+1)throw new UiError('ui.invalid_options');
  const result:unknown[]=[];
  for(let i=0;i<value.length;i++){
    const descriptor=descriptors[String(i)];
    if(!descriptor||!('value' in descriptor)||!descriptor.enumerable)throw new UiError('ui.invalid_options');
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

function keywords(value:unknown):readonly string[] {
  const values=closedList(value,16);
  return Object.freeze(values.map(item=>{
    if(typeof item!=='string'||!item.length)throw new UiError('ui.invalid_options');
    if(item.length>64)throw new UiError('ui.limit');
    return item;
  }));
}
/** Presentation metadata only. Every constructed command is queried natively. */
export function slashProfile(value:unknown):UiSlashProfile {
  const f=fields(value,['textBlockTypes','choices']);
  const types=closedList(f.textBlockTypes).map(id), seen=new Set<string>();
  if(new Set(types).size!==types.length)throw new UiError('ui.invalid_options');
  const choices=closedList(f.choices).map(value=>{
    const c=fields(value,['id','label','keywords','command']), key=id(c.id);
    if(seen.has(key)||typeof c.command!=='function')throw new UiError('ui.invalid_options');
    seen.add(key);
    const k=fields(c.keywords,['ru','en']);
    return Object.freeze({id:key,label:text(c.label),keywords:Object.freeze({ru:keywords(k.ru),en:keywords(k.en)}),
      command:c.command as UiSlashChoice['command']});
  });
  return Object.freeze({textBlockTypes:Object.freeze(types),choices:Object.freeze(choices)});
}
