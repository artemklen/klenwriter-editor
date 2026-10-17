/** Unstable, codec-only ABI; lifecycle/session SDK is owned by OSR-63. */
export const codecAbiV1 = 'kwdj-codec/1' as const;
/** Canonical decimal u64 string. Runtime rejects signs, leading zeros and overflow. */
export type CodecU64 = string;
export type CodecOperationV1 = 'validate' | 'normalize' | 'canonical';
export interface CodecIdentityFactV1 {
  readonly id: string;
  readonly status: 'exists' | 'missing' | 'unavailable';
}
export interface CodecOptionsV1 {
  readonly abi: typeof codecAbiV1;
  readonly identities: {
    readonly media: readonly CodecIdentityFactV1[];
    readonly references: readonly CodecIdentityFactV1[];
  };
  readonly limits?: Partial<Record<'document_bytes' | 'tree_depth' | 'node_count' | 'text_leaf_bytes' | 'table_rows' | 'table_effective_columns' | 'authored_attribute_bytes', CodecU64>>;
  readonly budget?: Partial<Record<'raw_input_bytes' | 'preflight_payload_bytes' | 'preflight_values' | 'preflight_depth', CodecU64>>;
}
export interface CodecDiagnosticV1 {
  readonly code: string;
  readonly path: string;
  readonly category: string | null;
  readonly limit: string | null;
  readonly maximum: CodecU64 | null;
  readonly observed: CodecU64 | null;
}
export type CodecResponseV1 = {
  readonly abi: typeof codecAbiV1;
  readonly operation: CodecOperationV1;
} & ({
  readonly status: 'accepted';
  /** Original canonical UTF-8 JSON represented by a string; do not parse/re-encode authored u64 via Number. */
  readonly canonical_json: string;
  readonly normalization_events: readonly string[];
  readonly media_manifest: readonly { readonly id: string; readonly path: string }[];
  readonly reference_manifest: readonly { readonly id: string; readonly path: string }[];
} | {
  readonly status: 'refused';
  readonly diagnostic: CodecDiagnosticV1;
});
/** The generated artifact has these exports after explicit async initialization. */
export interface CodecExportsV1 {
  kwdjValidateV1(input: Uint8Array, optionsJson: string): string;
  kwdjNormalizeV1(input: Uint8Array, optionsJson: string): string;
  kwdjCanonicalV1(input: Uint8Array, optionsJson: string): string;
}
