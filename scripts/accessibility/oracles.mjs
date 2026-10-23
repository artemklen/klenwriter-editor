// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-first expectations: accepted literals/specification, never candidate output.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),value:JSON.parse(bytes)};};
export const authority=read('contracts/ui/v1/native-oracles.json');
export const nestingAuthority=read('contracts/ui/v1/nesting-oracles.json');
export const checklistAuthority=read('contracts/accessibility/v1/checklist.json');
export const checklist=checklistAuthority.value;
export const keyboardErratumAuthority=read('contracts/accessibility/v1/macos-keyboard-authoring-erratum-001.json');
if(keyboardErratumAuthority.value.acceptedChecklist.sha256!==checklistAuthority.sha256||keyboardErratumAuthority.value.acceptedChecklist.bytes!==checklistAuthority.bytes)throw Error('Keyboard authoring erratum requires the exact original checklist');
export const editingKeys=Object.freeze(process.platform==='darwin'?keyboardErratumAuthority.value.resolvedDarwinEditingKeys:keyboardErratumAuthority.value.originalEditingKeys);
export const nativeCase=id=>{const value=authority.value.cases.find(row=>row.id===id);if(!value)throw Error(`Unknown authored case ${id}`);return structuredClone(value);};
export const copy=Object.freeze({
  en:{document:'Document',toolbar:'Text formatting',bold:'Bold',italic:'Italic',add:'Add block',move:'Move block',picker:'Choose a block type',paragraph:'Paragraph',quote:'Quote',dialog:'Block options',title:'Title',apply:'Apply',cancel:'Cancel',required:'Enter a title.',save:'Save document',reopen:'Reopen saved copy',saved:'Saved copy acknowledged.',loading:'Opening document…',loadError:'Could not open the editor.',runtimeError:'Editing stopped. Save a copy before restarting.',retry:'Retry',original:'Download original document'},
  ru:{document:'Документ',toolbar:'Форматирование текста',bold:'Полужирный',italic:'Курсив',add:'Добавить блок',move:'Переместить блок',picker:'Выберите тип блока',paragraph:'Абзац',quote:'Цитата',dialog:'Параметры блока',title:'Заголовок',apply:'Применить',cancel:'Отмена',required:'Введите заголовок.',save:'Сохранить документ',reopen:'Открыть сохранённую копию',saved:'Сохранённая копия подтверждена.',loading:'Открываем документ…',loadError:'Не удалось открыть редактор.',runtimeError:'Редактирование остановлено. Сохраните копию перед повторным запуском.',retry:'Повторить',original:'Скачать исходный документ'},
});
export const emptyCanonical='{"content":[{"content":[],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
export const plainCanonical='{"content":[{"content":[{"text":"ab","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
export const selectedAxe=Object.freeze({version:'4.14.0',tags:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'],qualification:'Selected A/AA automated rules on an explicit fixture scope; not full conformance or AT delivery.'});
export const limits=Object.freeze({textContrast:4.5,nonTextContrast:3,projectTarget:32,aaTarget:24,layoutTolerance:1,scanNodes:256});
export const roleSnapshot=(role,name,suffix='')=>`- ${role} ${JSON.stringify(name)}${suffix}`;
export function sourcePins(){return [authority,nestingAuthority,checklistAuthority,keyboardErratumAuthority].map(({path,bytes,sha256})=>({path,bytes,sha256}));}
