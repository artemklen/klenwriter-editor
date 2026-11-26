# Contribute through the corpus

Start with a [clean checkout and the pinned toolchain](../CONTRIBUTING.md#чистая-сборка).
Use the public fixtures for the following sequence. A contribution can stop at
the layer where it reproduces the problem.

1. **Read a codec case.** Pick a positive and a negative case in the
   [KWDJ v1 corpus](../contracts/kwdj/v1/README.md). Run
   `npm run test:corpus` after the workspace build. Record each fixture ID,
   admission result and the matching canonical output or refusal. The
   [corpus manifest](../contracts/kwdj/v1/manifest.json) identifies the source
   fixtures.
2. **Follow an edit through the engine.** Choose one input and its expected
   command result from the [command parity guide](command-parity.md). Run
   `npm run test:commands` and find the matching native and WASM checks. For a
   new case, supply the input, command, expected outcome and canonical result
   as separate values so the test can compare them independently.
3. **Compare admission with the mounted result.** Follow the
   [mounted corpus instructions](mounted-corpus.md). Run
   `npm run test:mounted-corpus` and use its `run-binding.json` and
   `report.json` to name one scenario, browser, editing stage and outcome.
   Include a refusal or experimental gap when the run records one.
4. **Exercise an independent extension.** Follow the
   [extension tutorial](extension-tutorial.md). Run the public conformance
   testkit with the sample descriptor and record both the accepted sample and
   the rejection the tutorial checks. Include the descriptor identity and
   package version with the result.

Use synthetic or public example documents when sharing a reproduction. The
[roadmap](roadmap.md) describes the available extension surface and follow-on
work.
