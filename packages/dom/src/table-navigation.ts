// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, PositionDto } from '@klenwriter/editor-sdk';
import type { DomView, GeometryRow } from './view.js';
import type { TableNavigationExit } from './types.js';

export type TableKey = 'Tab' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
export interface TableSlot { readonly table: string; readonly cell: string; readonly row: number; readonly column: number }
interface CellBounds extends TableSlot { readonly bottom: number; readonly right: number }
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

function ownedChild(view: DomView, parent: GeometryRow, id: string|undefined): GeometryRow|null {
  const child = id === undefined ? null : view.geometryRow(id);
  return child && child.view.parent === parent.view.id && child.outer.parentElement === parent.content ? child : null;
}

function endpoint(view: DomView, start: GeometryRow, end: boolean): PositionDto|null {
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

// Native KWDJ wire roles and their owned HTML projections define table navigation.
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

function findCell(view: DomView, position: DeepReadonly<PositionDto>): GeometryRow|null {
  let row = view.geometryRow(position.kind === 'child' ? position.parent : position.node);
  for (let depth = 0; row && depth < 128; depth++) {
    if (isTableCell(row)) return row;
    row = row.view.parent === null ? null : view.geometryRow(row.view.parent);
  }
  return null;
}

function span(cell: GeometryRow, key: 'rowspan'|'colspan', maximum: number): number {
  const attribute = cell.view.attributes[key];
  if (attribute === undefined) return 1;
  if (attribute.kind !== 'number') return 0;
  const size = Number(attribute.value);
  return Number.isInteger(size) && size >= 2 && size <= maximum && String(size) === attribute.value ? size : 0;
}

function verticalOrHorizontalRoute(view: DomView, table: GeometryRow, cell: GeometryRow, key: Exclude<TableKey,'Tab'>, entry?: TableSlot) {
  if (!table.view.children.length || table.view.children.length > 500) return null;
  const slots: (CellBounds|undefined)[][] = table.view.children.map(() => []);
  let active: CellBounds|undefined;
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
      const bounds = {table:table.view.id,cell:id,row:rowIndex,column,bottom:rowIndex+height,right:column+width};
      if (id === cell.view.id) active = bounds;
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
  if (!active || !width || slots.some(row => row.length !== width || row.includes(undefined))) return null;
  const sameEntry = entry?.table === active.table && entry.cell === active.cell
    && entry.row >= active.row && entry.row < active.bottom && entry.column >= active.column && entry.column < active.right;
  const vertical = key === 'ArrowUp' || key === 'ArrowDown';
  const row = vertical ? key === 'ArrowUp' ? active.row - 1 : active.bottom : sameEntry ? entry.row : active.row;
  const column = vertical ? sameEntry ? entry.column : active.column : key === 'ArrowLeft' ? active.column - 1 : active.right;
  if (vertical && (row < 0 || row >= slots.length)) return {exit:true} as const;
  const next = slots[row]?.[column];
  if (!next || next === active) return null;
  return {cell:next.cell,slot:{table:next.table,cell:next.cell,row,column}} as const;
}

function tableExit(view: DomView, table: GeometryRow, reverse: boolean): TableRoute|null {
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
export function tableNavigation(view: DomView, position: DeepReadonly<PositionDto>, key: TableKey, shifted: boolean, entry?: TableSlot): TableRoute|null {
  const cell = findCell(view,position);
  const row = cell?.view.parent ? view.geometryRow(cell.view.parent) : null;
  const table = row?.view.parent ? view.geometryRow(row.view.parent) : null;
  if (!cell || !row || tableTag(row) !== 'tr' || !table || tableTag(table) !== 'table'
    || cell.outer.parentElement !== row.content || row.outer.parentElement !== table.content) return null;
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
  const route = verticalOrHorizontalRoute(view,table,cell,key,entry);
  if (!route) return null;
  if ('exit' in route) return tableExit(view,table,reverse);
  const target = view.geometryRow(route.cell);
  const point = target && endpoint(view,target,reverse);
  return point && {point,slot:route.slot};
}
