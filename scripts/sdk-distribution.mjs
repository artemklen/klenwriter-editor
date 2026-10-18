// SPDX-License-Identifier: MIT OR Apache-2.0
// This producer choice is hashed into the SDK build identity. Cargo flags are
// explicit, so a different compiled module offer requires a different build.
export const defaultSdkDistribution = Object.freeze({
  package: 'klenwriter-editor-wasm', defaultFeatures: false,
  features: Object.freeze(['notes']),
  compiledModules: Object.freeze(['kwdj-sdk', 'notes-sdk']),
  compiledProfileIds: Object.freeze(['org.example.notes', 'org.klenwriter.kwdj']),
});
export const defaultSdkCargoFeatures = ['--no-default-features', '--features', defaultSdkDistribution.features.join(',')];
