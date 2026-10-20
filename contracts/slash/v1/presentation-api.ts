// SPDX-License-Identifier: MIT OR Apache-2.0
// Internal module contract frozen independently of the implementation provider.
export interface SearchChoice {
  readonly id:string;
  readonly label:Readonly<{ru:string;en:string}>;
  readonly keywords:Readonly<{ru:readonly string[];en:readonly string[]}>;
}
export declare function foldSearch(value:string):string;
export declare function filterChoiceIds(choices:readonly SearchChoice[], query:string,
  locale:'ru'|'en'):readonly string[];
// query is the exact text AFTER the initial slash. See behavior.md fixed folding.
export interface SlashListItem {
  readonly id:string; readonly label:string;
  readonly available:boolean; readonly reason:string;
}
export declare class SlashList {
  readonly element:HTMLDivElement;
  constructor(document:Document,prefix:string);
  update(items:readonly SlashListItem[], activeId:string|null,
    label:string, emptyLabel:string, locale:'ru'|'en'):void;
  get activeOption():HTMLElement|null;
  optionFor(target:EventTarget|null):string|null;
  scrollActive():void;
  destroy():void;
}
// Render literal text only, one listbox and one aria-selected=true when active.
// Stable option objects/IDs survive refresh; hidden results are removed. Reason
// IDs are referenced by aria-describedby, empty status is never an option.
// No listeners/callbacks/native queries/focus/selection/document scrolling.
// scrollActive changes only the list's scrollTop within its own finite bounds;
// never scrollIntoView. Caller validates <=32 unique choices and text limits.
// optionFor accepts only actual owned option objects, never dataset/ID lookalikes.
// destroy removes DOM and all retained option references; all code is CSP-safe.
