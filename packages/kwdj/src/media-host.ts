// SPDX-License-Identifier: MIT OR Apache-2.0
import { runMountedMediaHostService } from '@klenwriter/editor-dom';
import type { MountedHostRequests, MountedHostServiceStart } from '@klenwriter/editor-dom';
import type {
  HostMediaIdentity, HostMediaMetadata, HostMediaPickerRequest, HostService, HostServiceReply,
  HostServices, KwdjMediaAccessibilityV2, KwdjMediaAlignV2, KwdjMediaPlacementV2,
} from '@klenwriter/editor-sdk';
import { kwdjCommand } from './index.js';

export type KwdjMediaTarget =
  | Readonly<{ kind: 'insert'; placement?: KwdjMediaPlacementV2 }>
  | Readonly<{ kind: 'replace'; node: string; assetId: string }>;

export interface KwdjMediaMetadata extends HostMediaMetadata {
  /** Applies to insertion with explicit placement. */
  readonly align?: KwdjMediaAlignV2;
  readonly caption?: string;
}

export interface KwdjMediaPickerOptions {
  readonly target: KwdjMediaTarget;
  readonly services: Pick<HostServices, 'pickMedia'> & {
    readonly mediaMetadata?: HostService<HostMediaIdentity, KwdjMediaMetadata>;
  };
  readonly focusScope?: HTMLElement;
}

type MediaChoice = Readonly<{
  assetId: string;
  accessibility: KwdjMediaAccessibilityV2;
  align?: KwdjMediaAlignV2;
  caption?: string;
}>;

function ownField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('Invalid media service reply');
  }
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field) return undefined;
  if (!('value' in field)) throw new TypeError('Invalid media service reply');
  return field.value;
}

function replyValue(reply: unknown): HostServiceReply<unknown> {
  const status = ownField(reply, 'status');
  if (status === 'cancelled' || status === 'unavailable') return { status };
  if (status === 'ok') return { status, value: ownField(reply, 'value') };
  throw new TypeError('Invalid media service reply');
}

function accessibility(value: unknown): KwdjMediaAccessibilityV2 {
  const alt = ownField(value, 'alt'), decorative = ownField(value, 'decorative');
  if (typeof alt === 'string' && alt.length > 0 && decorative === undefined) return { kind: 'alt', alt };
  if (alt === undefined && decorative === true) return { kind: 'decorative' };
  throw new TypeError('Invalid media accessibility');
}

function insertionMetadata(value: unknown): Pick<MediaChoice, 'align' | 'caption'> {
  const align = ownField(value, 'align');
  const caption = ownField(value, 'caption');
  if (
    (align !== undefined && align !== 'none' && align !== 'center' && align !== 'wide')
    || (caption !== undefined && typeof caption !== 'string')
  ) throw new TypeError('Invalid media insertion metadata');
  return { ...(align === undefined ? {} : { align }), ...(caption === undefined ? {} : { caption }) };
}

/** Run an opt-in KWDJ picker and metadata lookup under one mounted host request. */
export function runKwdjMediaPicker(requests: MountedHostRequests, options: KwdjMediaPickerOptions): MountedHostServiceStart {
  const { target, focusScope, services: { pickMedia, mediaMetadata } } = options;
  const replacement = target.kind === 'replace' ? { node: target.node, current_asset_id: target.assetId } : null;
  const placement = target.kind === 'insert' && target.placement ? Object.freeze({ ...target.placement }) : undefined;
  const input: HostMediaPickerRequest = replacement ? { kind: 'replace', assetId: replacement.current_asset_id } : { kind: 'insert' };
  return runMountedMediaHostService<HostMediaPickerRequest, MediaChoice>(requests, {
    request: input,
    ...(focusScope === undefined ? {} : {focusScope}),
    restoreRefusalFocus: true,
    async service(request, context, isCurrent) {
      if (!pickMedia || !mediaMetadata) return { status: 'unavailable' };
      const picked = replyValue(await pickMedia(request, context));
      if (context.signal.aborted) return { status: 'cancelled' };
      if (picked.status !== 'ok') return picked;
      const assetId = ownField(picked.value, 'assetId');
      if (typeof assetId !== 'string' || !assetId) throw new TypeError('Invalid picked media identity');
      if (!isCurrent()) return { status: 'cancelled' };
      const metadata = replyValue(await mediaMetadata(Object.freeze({ assetId }), context));
      if (context.signal.aborted) return { status: 'cancelled' };
      if (metadata.status !== 'ok') return metadata;
      if (ownField(metadata.value, 'assetId') !== assetId) throw new TypeError('Media metadata identity changed');
      return {
        status: 'ok',
        value: {
          assetId,
          accessibility: accessibility(metadata.value),
          ...(placement === undefined ? {} : insertionMetadata(metadata.value)),
        },
      };
    },
    command(value) {
      const payload = { media_asset_id: value.assetId, accessibility: value.accessibility };
      return kwdjCommand(replacement ? { kind: 'replace_media', ...replacement, ...payload } : {
        kind: 'insert_media',
        ...payload,
        ...(placement === undefined ? {} : { placement }),
        ...(value.align === undefined ? {} : { align: value.align }),
        ...(value.caption === undefined ? {} : { caption: value.caption }),
      });
    },
  });
}
