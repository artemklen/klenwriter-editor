// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, PositionDto, SelectionDto } from '@klenwriter/editor-sdk';
import type { DomView, GeometryRow } from './view.js';
import type { TableNavigationExit } from './types.js';

type TableKey = 'Tab' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
export type TableSelectionKey = TableKey | 'Escape';
export interface TableSlot { readonly table: string; readonly cell: string; readonly row: number; readonly column: number }
type TableView = Pick<DomView, 'geometryRow'>;
type TableArrow = Exclude<TableKey, 'Tab'>;
interface CellBounds extends TableSlot { readonly bottom: number; readonly right: number; readonly outer: HTMLElement }
interface TableGrid { readonly slots: CellBounds[][]; readonly cells: Map<string, CellBounds> }
export interface TableRoute {
  readonly point: PositionDto;
  readonly slot?: TableSlot;
  readonly exit?: TableNavigationExit;
}
const sameModelPoint = (left: DeepReadonly<PositionDto>, right: PositionDto): boolean => {
  if (left.kind === 'text' && right.kind === 'text') return left.node === right.node && left.offset === right.offset;
  if (left.kind === 'child' && right.kind === 'child') return left.parent === right.parent && left.index === right.index;
  return left.kind === 'edge' && right.kind === 'edge' && left.node === right.node && left.side === right.side;
};

function collapsed(selection: DeepReadonly<SelectionDto>): boolean {
  const {anchor,focus}=selection;
  return sameModelPoint(anchor,focus)
    && (anchor.kind==='edge' || focus.kind!=='edge' && anchor.affinity===focus.affinity);
}

function ownedChild(view: TableView, parent: GeometryRow, id: string|undefined): GeometryRow|null {
  const child = id === undefined ? null : view.geometryRow(id);
  return child && child.view.parent === parent.view.id && child.outer.parentElement === parent.content ? child : null;
}

function endpoint(view: TableView, start: GeometryRow, end: boolean): PositionDto|null {
  let row: GeometryRow|null = start;
  for (let depth = 0; row && depth < 128; depth++) {
    const node = row.view;
    if (node.primitive === 'text' && node.text !== null) {
      return {kind:'text',node:node.id,offset:end ? node.text.length : 0,affinity:'after'};
    }
    if (node.primitive === 'hard_break' || node.primitive === 'inline_atom' || node.primitive === 'block_atom') {
      return {kind:'edge',node:node.id,side:end ? 'after' : 'before'};
    }
    if (node.primitive === 'text_block' && !node.children.length) {
      return {kind:'child',parent:node.id,index:0,affinity:'after'};
    }
    row = ownedChild(view, row, node.children.at(end ? -1 : 0));
  }
  return null;
}

// Only these native wires implement the table rectangle marker. A renderer may
// choose table tags for otherwise unrelated container nodes.
type TableTag = 'table' | 'tr' | 'td' | 'th';
const mountedTableTags: ReadonlyMap<string, TableTag> = new Map([
  ['org.klenwriter.kwdj/table', 'table'],
  ['org.klenwriter.kwdj/table_row', 'tr'],
  ['org.klenwriter.kwdj/table_cell', 'td'],
  ['org.klenwriter.kwdj/table_header', 'th'],
]);

function tableTag(row: GeometryRow): TableTag | undefined {
  const tag = mountedTableTags.get(row.view.type_id);
  return row.view.primitive === 'container' && row.outer.localName === tag ? tag : undefined;
}

function isTableCell(row: GeometryRow): boolean {
  const tag = tableTag(row);
  return tag === 'td' || tag === 'th';
}

function findCell(view: TableView, position: DeepReadonly<PositionDto>): GeometryRow|null {
  let row = view.geometryRow(position.kind === 'child' ? position.parent : position.node);
  for (let depth = 0; row && depth < 128; depth++) {
    if (isTableCell(row)) return row;
    row = row.view.parent === null ? null : view.geometryRow(row.view.parent);
  }
  return null;
}

function tableCell(view: TableView, position: DeepReadonly<PositionDto>) {
  const cell = findCell(view, position);
  const row = cell?.view.parent ? view.geometryRow(cell.view.parent) : null;
  const table = row?.view.parent ? view.geometryRow(row.view.parent) : null;
  return cell && row && table && tableTag(row) === 'tr' && tableTag(table) === 'table'
    && cell.outer.parentElement === row.content && row.outer.parentElement === table.content
    ? {cell, row, table} : null;
}

function span(cell: GeometryRow, key: 'rowspan'|'colspan', maximum: number): number {
  const attribute = cell.view.attributes[key];
  if (attribute === undefined) return 1;
  if (attribute.kind !== 'number') return 0;
  const size = Number(attribute.value);
  return Number.isInteger(size) && size >= 2 && size <= maximum && String(size) === attribute.value ? size : 0;
}

function tableGrid(view: TableView, table: GeometryRow): TableGrid | null {
  if (!table.view.children.length || table.view.children.length > 500) return null;
  const slots: (CellBounds|undefined)[][] = table.view.children.map(() => []);
  const cells = new Map<string, CellBounds>();
  for (const [rowIndex, rowId] of table.view.children.entries()) {
    const row = ownedChild(view, table, rowId);
    if (!row || tableTag(row) !== 'tr' || row.view.children.length > 50) return null;
    let column = 0;
    for (const id of row.view.children) {
      const block = ownedChild(view, row, id);
      if (!block || !isTableCell(block)) return null;
      while (slots[rowIndex]![column]) column++;
      const height = span(block,'rowspan',slots.length-rowIndex);
      const width = span(block,'colspan',50-column);
      if (!height || !width || column + width > 50) return null;
      const bounds = {table:table.view.id,cell:id,row:rowIndex,column,bottom:rowIndex+height,right:column+width,outer:block.outer};
      cells.set(id, bounds);
      for (let y = rowIndex; y < bounds.bottom; y++) {
        for (let x = column; x < bounds.right; x++) {
          if (slots[y]![x]) return null;
          slots[y]![x] = bounds;
        }
      }
      column = bounds.right;
    }
  }
  const width = slots[0]!.length;
  if (!width || slots.some(row => row.length !== width || row.includes(undefined))) return null;
  return {slots: slots as CellBounds[][], cells};
}

function adjacentSlot(grid: TableGrid, cell: GeometryRow, key: TableArrow, entry?: TableSlot) {
  const active = grid.cells.get(cell.view.id);
  if (!active) return null;
  const sameEntry = entry?.table === active.table && entry.cell === active.cell
    && entry.row >= active.row && entry.row < active.bottom && entry.column >= active.column && entry.column < active.right;
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  const row = vertical ? key === 'ArrowUp' ? active.row - 1 : active.bottom : sameEntry ? entry.row : active.row;
  const column = vertical ? sameEntry ? entry.column : active.column : key === 'ArrowLeft' ? active.column - 1 : active.right;
  if (vertical && (row < 0 || row >= grid.slots.length)) return {exit:true} as const;
  const next = grid.slots[row]?.[column];
  if (!next || next === active) return null;
  return {cell:next.cell,slot:{table:next.table,cell:next.cell,row,column}} as const;
}

function tableExit(view: TableView, table: GeometryRow, reverse: boolean): TableRoute|null {
  const parent = table.view.parent === null ? null : view.geometryRow(table.view.parent);
  const index = parent?.view.children.indexOf(table.view.id) ?? -1;
  if (!parent || index < 0) return null;
  const siblingId = parent.view.children[index + (reverse ? -1 : 1)];
  if (siblingId === undefined) {
    return {
      point:{kind:'child',parent:parent.view.id,index:index+Number(!reverse),affinity:'after'},
      exit:{kind:'add'},
    };
  }
  const sibling = ownedChild(view,parent,siblingId);
  const point = sibling && endpoint(view,sibling,reverse);
  if (!point) return null;
  if (point.kind === 'edge' && view.geometryRow(point.node)?.view.primitive === 'block_atom') {
    return {point,exit:{kind:'atom',node:point.node}};
  }
  return {point};
}

/** Read the already-admitted mounted table. The profile remains the model validator. */
function tableNavigation(view: TableView, position: DeepReadonly<PositionDto>, key: TableKey, shifted: boolean, entry?: TableSlot): TableRoute|null {
  const owned = tableCell(view, position);
  if (!owned) return null;
  const {cell, row, table} = owned;
  const reverse = key === 'ArrowUp' || key === 'ArrowLeft' || key === 'Tab' && shifted;
  if (key === 'Tab') {
    const index = row.view.children.indexOf(cell.view.id);
    const rowIndex = table.view.children.indexOf(row.view.id);
    if (index < 0 || rowIndex < 0) return null;
    const delta = reverse ? -1 : 1;
    const next = row.view.children[index+delta];
    const nextRow = table.view.children[rowIndex+delta];
    if (next === undefined && nextRow === undefined) return tableExit(view,table,reverse);
    const neighbour = next === undefined ? ownedChild(view,table,nextRow) : null;
    const target = next !== undefined ? ownedChild(view,row,next)
      : neighbour && tableTag(neighbour) === 'tr' ? ownedChild(view,neighbour,neighbour.view.children.at(reverse ? -1 : 0)) : null;
    const point = target && isTableCell(target) ? endpoint(view,target,reverse) : null;
    return point && {point};
  }
  const face = endpoint(view,cell,!reverse);
  if (!face || !sameModelPoint(position,face)) return null;
  const grid = tableGrid(view, table);
  const route = grid && adjacentSlot(grid, cell, key, entry);
  if (!route) return null;
  if ('exit' in route) return tableExit(view,table,reverse);
  const target = view.geometryRow(route.cell);
  const point = target && endpoint(view,target,reverse);
  return point && {point,slot:route.slot};
}


type TableRange = { readonly anchor: string; readonly focus: string };

function tableMarker(view: TableView, selection: DeepReadonly<SelectionDto> | null) {
  const anchor = selection?.anchor, focus = selection?.focus;
  if (anchor?.kind !== 'edge' || anchor.side !== 'before'
    || focus?.kind !== 'edge' || focus.side !== 'after' || anchor.node === focus.node) return null;
  const first = tableCell(view, anchor), last = tableCell(view, focus);
  return first && last && first.cell.view.id === anchor.node && last.cell.view.id === focus.node
    && first.table.view.id === last.table.view.id ? {first, last} : null;
}

function cellRange({anchor, focus}: TableRange): SelectionDto {
  return {anchor:{kind:'edge',node:anchor,side:'before'},focus:{kind:'edge',node:focus,side:'after'}};
}

export function tableSelectionFocus(view: TableView, selection: DeepReadonly<SelectionDto> | null): PositionDto | null {
  const marker = tableMarker(view, selection);
  return marker && endpoint(view, marker.last.cell, false);
}

export function tableSelectionBetween(view: TableView, anchor: DeepReadonly<PositionDto>, focus: DeepReadonly<PositionDto>): SelectionDto | null {
  const first = tableCell(view, anchor), last = tableCell(view, focus);
  if (!first || !last || first.table.view.id !== last.table.view.id || first.cell.view.id === last.cell.view.id) return null;
  return cellRange({anchor:first.cell.view.id,focus:last.cell.view.id});
}

function extendTableSelection(view: TableView, selection: DeepReadonly<SelectionDto>, key: TableArrow, entry?: TableSlot) {
  const marker = tableMarker(view, selection);
  if (!marker && !collapsed(selection)) return null;
  const active = marker?.last ?? tableCell(view, selection.focus);
  if (!active) return null;
  if (!marker) {
    const face = endpoint(view, active.cell, key === 'ArrowRight' || key === 'ArrowDown');
    if (!face || !sameModelPoint(selection.focus, face)) return null;
  }
  const grid = tableGrid(view, active.table);
  const next = grid && adjacentSlot(grid, active.cell, key, entry);
  if (!next || 'exit' in next) return grid && marker ? {selection,slot:entry} : null;
  const anchor = marker?.first.cell.view.id ?? active.cell.view.id;
  if (anchor !== next.cell) return {selection:cellRange({anchor,focus:next.cell}),slot:next.slot};
  const caret = marker && endpoint(view, marker.first.cell, false);
  return caret && {selection:{anchor:caret,focus:caret},slot:next.slot};
}

export function tableKeyboardSelection(
  view: TableView,
  selection: DeepReadonly<SelectionDto>,
  key: TableSelectionKey,
  shifted: boolean,
  entry?: TableSlot,
): {readonly selection: DeepReadonly<SelectionDto>; readonly slot?: TableSlot; readonly exit?: TableNavigationExit} | null {
  if (shifted && key !== 'Tab' && key !== 'Escape') return extendTableSelection(view, selection, key, entry);
  const tableFocus = tableSelectionFocus(view, selection);
  if (key === 'Escape') return tableFocus && !shifted ? {selection:{anchor:tableFocus,focus:tableFocus}} : null;
  if (!tableFocus && !collapsed(selection)) return null;
  if (tableFocus && key !== 'Tab') return {selection:{anchor:tableFocus,focus:tableFocus}};
  const route = tableNavigation(view, tableFocus ?? selection.focus, key, shifted, entry);
  return route && {selection:{anchor:route.point,focus:route.point},slot:route.slot,exit:route.exit};
}

export function tableSelectionCells(view: TableView, selection: DeepReadonly<SelectionDto> | null): readonly HTMLElement[] {
  const marker = tableMarker(view, selection);
  if (!marker) return [];
  const grid = tableGrid(view, marker.first.table);
  const first = grid?.cells.get(marker.first.cell.view.id), last = grid?.cells.get(marker.last.cell.view.id);
  if (!grid || !first || !last) return [];

  let top = Math.min(first.row,last.row), bottom = Math.max(first.bottom,last.bottom);
  let left = Math.min(first.column,last.column), right = Math.max(first.right,last.right);
  const seen = new Set<CellBounds>(), pending: CellBounds[] = [];
  const add = (r0: number, r1: number, c0: number, c1: number) => {
    for (let row = r0; row < r1; row++) for (let column = c0; column < c1; column++) {
      const cell = grid.slots[row]![column]!;
      if (!seen.has(cell)) { seen.add(cell); pending.push(cell); }
    }
  };
  add(top,bottom,left,right);
  // Every newly covered strip is examined once, including carried span slots.
  for (const cell of pending) {
    const oldTop=top, oldBottom=bottom, oldLeft=left, oldRight=right;
    top=Math.min(top,cell.row); bottom=Math.max(bottom,cell.bottom);
    left=Math.min(left,cell.column); right=Math.max(right,cell.right);
    add(top,oldTop,left,right);
    add(oldBottom,bottom,left,right);
    add(oldTop,oldBottom,left,oldLeft);
    add(oldTop,oldBottom,oldRight,right);
  }
  return [...seen].map(cell=>cell.outer);
}
