// SPDX-License-Identifier: MIT OR Apache-2.0
// Frozen specification, not implementation.
import type { DeepReadonly, CommandDto, SessionContextV2, StampDto, SelectionDto, Submission } from '@klenwriter/editor-sdk';
import type { DomRefusal, SelectionReadFailure, BookmarkRestore } from '@klenwriter/editor-dom';
export type CssRect = Readonly<{x:number;y:number;width:number;height:number}>;
export type GeometryRequest =
 | {readonly kind:'block';readonly stamp:StampDto;readonly node:string}
 | {readonly kind:'block_at_point';readonly stamp:StampDto;readonly x:number;readonly y:number}
 | {readonly kind:'selection';readonly stamp:StampDto};
export interface GeometrySnapshot {
 readonly status:'measured'; readonly stamp:DeepReadonly<StampDto>;
 readonly context:DeepReadonly<SessionContextV2>;
 readonly target:Readonly<{kind:'block';node:string}>
   | Readonly<{kind:'selection';selection:DeepReadonly<SelectionDto>}>;
 readonly rects:readonly CssRect[];
 readonly anchor:CssRect|null; readonly focus:CssRect|null;
 readonly clip:CssRect; readonly viewport:CssRect; readonly visible:boolean;
}
export type GeometryRead = GeometrySnapshot|DomRefusal|SelectionReadFailure;
export interface MountedGeometry {read(request:GeometryRequest):GeometryRead}
export interface MountedHostRequest {
 readonly stamp:DeepReadonly<StampDto>;
 readonly context:DeepReadonly<SessionContextV2>;
 readonly __mountedHostRequest:unique symbol;
}
export type MountedHostCapture = Readonly<{status:'captured';request:MountedHostRequest}>
 | DomRefusal|SelectionReadFailure;
export interface HostFocus {
 readonly status:'restored'|'not_requested'|'not_restored';
 readonly failure:DomRefusal|SelectionReadFailure|null;
}
export interface MountedHostRequests {
 status():Readonly<{status:'available';stamp:DeepReadonly<StampDto>;
   context:DeepReadonly<SessionContextV2>}>|DomRefusal;
 capture(options?:{readonly focusScope?:HTMLElement}):MountedHostCapture;
 complete(request:MountedHostRequest,command:CommandDto,
   options?:{readonly focus?:'native_result'|'none'}):
   Readonly<{status:'submitted';submission:Submission;focus:Promise<HostFocus>}>
   | DomRefusal|SelectionReadFailure;
 cancel(request:MountedHostRequest,options?:{readonly focus?:boolean}):
   Readonly<{status:'cancelled';restore:BookmarkRestore|null}>
   | DomRefusal|SelectionReadFailure;
 release(request:MountedHostRequest):boolean;
}
// MountedEditor adds readonly geometry and readonly hostRequests.
