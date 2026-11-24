// SPDX-License-Identifier: MIT OR Apache-2.0
import { runMountedHostService } from '@klenwriter/editor-dom';
import type { MountedHostRequests, MountedHostServiceStart } from '@klenwriter/editor-dom';
import type { HostLinkChoice, HostLinkRequest, HostServices } from '@klenwriter/editor-sdk';
import { kwdjCommand } from './index.js';

export interface KwdjLinkDialogOptions {
  readonly request: HostLinkRequest;
  readonly services: Pick<HostServices, 'editLink'>;
  readonly focusScope?: HTMLElement;
}

/** Apply a host dialog’s result to the original selected range. */
export function runKwdjLinkDialog(requests: MountedHostRequests, options: KwdjLinkDialogOptions): MountedHostServiceStart {
  const {request, services: {editLink}, focusScope} = options;
  const editing = request.kind === 'edit';
  return runMountedHostService<HostLinkRequest, HostLinkChoice>(requests, {
    request,
    service: (request,context) => editLink ? editLink(request,context) : Promise.resolve({status:'unavailable'}),
    ...(focusScope === undefined ? {} : {focusScope}),
    restoreRefusalFocus: true,
    command(choice) {
      if (choice.kind === 'set' && typeof choice.link?.href === 'string'
        && (choice.link.title === undefined || typeof choice.link.title === 'string')) {
        return kwdjCommand({kind:'set_link',href:choice.link.href,title:choice.link.title ?? null});
      }
      if (choice.kind === 'remove' && editing) return kwdjCommand({kind:'unset_link'});
      throw new TypeError('Invalid link dialog result');
    },
  });
}
