/** Legacy bootstrap diagnostic; SDK ABI1 and codec ABI1 are exported independently below. */
export const artifactStage = 'workspace-bootstrap' as const;
export * from './codec.js';
export * from './sdk-types.js';
export * from './sdk.js';
