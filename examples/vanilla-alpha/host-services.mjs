// SPDX-License-Identifier: MIT OR Apache-2.0
import { createLinkService } from './link-action.mjs';
import referenceDocument from './reference-document.json';

export const mediaAssetId = 'a2222222-2222-4222-8222-222222222222';
export const referenceEntityId = referenceDocument.content[0].content[0].marks[0].attrs.reference_entity_id;

/** @returns {import('@klenwriter/editor-sdk').HostServices} */
export function createMockHostServices(linkDialog) {
  return {
    editLink: createLinkService(linkDialog),
    async pickMedia(request, { signal }) {
      if (signal.aborted) return { status:'cancelled' };
      return request.kind === 'insert' ? { status:'ok',value:{assetId:mediaAssetId} } : { status:'unavailable' };
    },
    async mediaMetadata({ assetId }, { signal }) {
      if (signal.aborted) return { status:'cancelled' };
      return assetId === mediaAssetId ? { status:'ok',value:{assetId,alt:'Sample illustration'} } : { status:'unavailable' };
    },
    async lookupReference({ entityId }, { signal }) {
      if (signal.aborted) return { status:'cancelled' };
      return entityId === referenceEntityId ? { status:'ok',value:{entityId,label:'Sample reference'} } : { status:'unavailable' };
    },
  };
}
