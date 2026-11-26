// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto, IdentityFactsDto, StampDto } from '@klenwriter/editor-wasm';
import { DataError, ownData } from './data.js';

const canonicalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const mediaCommandId = 'org.klenwriter.kwdj/command/media';
// This is also the native KWDJ cap. Refuse before calling the mutation wire.
const maxMediaFacts = 256;

export function verifyKwdjMediaCommand(request: { kind: string; command: CommandDto; history_hint: { kind: string } }, assetId: string): void {
  if (typeof assetId !== 'string' || assetId.length !== 36 || !canonicalId.test(assetId)) throw new DataError('sdk.invalid_identity');
  if (request.kind !== 'command' || request.history_hint?.kind !== 'isolated' || request.command?.id !== mediaCommandId) {
    throw new DataError('sdk.invalid_request_kind');
  }
  const payload = JSON.parse(request.command.payload_json);
  if ((payload?.kind !== 'insert_media' && payload?.kind !== 'replace_media') || payload.media_asset_id !== assetId) {
    throw new DataError('sdk.invalid_input');
  }
}

export function nextKwdjMediaFacts(profileOptionsJson: string, assetId: string, stamp: StampDto, requestBytes: number) {
  // The KWDJ factory has admitted this closed, profile-specific options string.
  // Its numeric options are bounded integers or decimal strings. Registry JSON
  // stays opaque and does not enter this round trip.
  const options = JSON.parse(profileOptionsJson) as { identities: IdentityFactsDto };
  const previous = options.identities.media.find(fact => fact.id === assetId);
  if (previous?.status === 'exists') return null;
  if (!previous && options.identities.media.length >= maxMediaFacts) throw new DataError('sdk.identity_limit');

  const verified = { id: assetId, status: 'exists' as const };
  const media = previous
    ? options.identities.media.map(fact => fact === previous ? verified : fact)
    : [...options.identities.media, verified];
  const identities: IdentityFactsDto = { media, references: options.identities.references };
  return {
    requestJson: ownData({ kind: 'update_facts', stamp, identities }, requestBytes).json,
    rollbackJson: ownData({ kind: 'update_facts', stamp, identities: options.identities }, requestBytes).json,
    profileOptionsJson: JSON.stringify({ ...options, identities }),
  };
}
