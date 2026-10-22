// SPDX-License-Identifier: MIT OR Apache-2.0
import type { ProfileDto, SessionContextV2 } from '@klenwriter/editor-wasm';
import { DataError, freezeData, ownData } from './data.js';

const object = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const digest = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
function identity(value: ProfileDto): string {
  return JSON.stringify([value.profile_id, value.profile_version, value.codec_id, value.wire_version,
    value.extensions.map(extension => [extension.id, extension.version]).sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)]);
}

/** Separate from the exact closed SDK1 response envelope. It conveys identity,
 * never freshness or permission to mutate/save; captured stamps do that. */
export function decodeSessionContext(raw: string, buildId: string, profile: ProfileDto): SessionContextV2 {
  try {
    if (typeof raw !== 'string' || raw.length > 64 * 1024) throw new DataError('sdk.invalid_response');
    const value = ownData(JSON.parse(raw), 64 * 1024).value;
    if (!object(value) || !keys(value, ['build_id', 'profile', 'registry_digest', 'capability_digest'])
      || value.build_id !== buildId || !digest(value.registry_digest) || !digest(value.capability_digest)
      || !object(value.profile) || !keys(value.profile, ['profile_id', 'profile_version', 'codec_id', 'wire_version', 'extensions'])
      || typeof value.profile.profile_id !== 'string' || typeof value.profile.profile_version !== 'string'
      || typeof value.profile.codec_id !== 'string' || !Number.isInteger(value.profile.wire_version)
      || (value.profile.wire_version as number) < 0 || (value.profile.wire_version as number) > 0xffff_ffff
      || !Array.isArray(value.profile.extensions) || value.profile.extensions.length > 64
      || value.profile.extensions.some(extension => !object(extension) || !keys(extension, ['id', 'version'])
        || typeof extension.id !== 'string' || typeof extension.version !== 'string')
      || identity(value.profile as unknown as ProfileDto) !== identity(profile)) throw new DataError('sdk.invalid_response');
    return freezeData(value) as unknown as SessionContextV2;
  } catch { throw new DataError('sdk.invalid_response'); }
}
