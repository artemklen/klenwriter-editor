// SPDX-License-Identifier: MIT OR Apache-2.0
export interface SearchChoice {
  readonly id:string;
  readonly label:Readonly<{ru:string;en:string}>;
  readonly keywords:Readonly<{ru:readonly string[];en:readonly string[]}>;
}
export function foldSearch(value:string):string {
  let result='';
  for(const char of value){
    const code=char.codePointAt(0)!;
    result+=String.fromCodePoint(code>=65&&code<=90||code>=0x410&&code<=0x42f?code+32:code===0x401?0x451:code);
  }
  return result;
}
export function filterChoiceIds(choices:readonly SearchChoice[],query:string,locale:'ru'|'en'):readonly string[] {
  const needle=foldSearch(query);
  return Object.freeze(choices.filter(choice=>[choice.id,choice.label[locale],...choice.keywords[locale]]
    .some(value=>foldSearch(value).includes(needle))).map(choice=>choice.id));
}
