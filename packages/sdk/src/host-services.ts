// SPDX-License-Identifier: MIT OR Apache-2.0

export interface HostServiceContext {
  readonly signal: AbortSignal;
}

export type HostServiceReply<Value> =
  | Readonly<{ status: 'ok'; value: Value }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'unavailable' }>;

export type HostService<Request, Value> = (
  request: Readonly<Request>,
  context: HostServiceContext,
) => Promise<HostServiceReply<Value>>;

export type HostMediaPickerRequest =
  | Readonly<{ kind: 'insert' }>
  | Readonly<{ kind: 'replace'; assetId: string }>;

export interface HostMediaIdentity {
  readonly assetId: string;
}

export interface HostMediaMetadata extends HostMediaIdentity {
  readonly alt?: string;
}

export interface HostLink {
  readonly href: string;
  readonly title?: string;
}

export type HostLinkRequest =
  | Readonly<{ kind: 'create' }>
  | Readonly<{ kind: 'edit'; current: HostLink }>;

export type HostLinkChoice =
  | Readonly<{ kind: 'set'; link: HostLink }>
  | Readonly<{ kind: 'remove' }>;

export interface HostReferenceIdentity {
  readonly entityId: string;
}

export interface HostReferenceMetadata extends HostReferenceIdentity {
  readonly label?: string;
}

/** Host-owned services. Reference lookup uses an existing identity. */
export interface HostServices {
  readonly pickMedia?: HostService<HostMediaPickerRequest, HostMediaIdentity>;
  readonly mediaMetadata?: HostService<HostMediaIdentity, HostMediaMetadata>;
  readonly editLink?: HostService<HostLinkRequest, HostLinkChoice>;
  readonly lookupReference?: HostService<HostReferenceIdentity, HostReferenceMetadata>;
}
