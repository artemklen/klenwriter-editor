# Calibration pilots retained for provenance

These are development observations, excluded from the accepted adaptive-batch baseline.

- `chromium-run-1-first.json` and `metadata-first.json`: first pilot stopped on `near-node-limit`. Empty paragraphs lacked a `<br>` caret placeholder: trusted keydown occurred but no input. The renderer correction and independent single-key read-back are described in the protocol. Earlier measured corpus phases remain raw evidence, not completed acceptance.
- `quantized/`: three complete Chromium runs plus one partial Firefox run and source metadata from the fixed-batch version. Short core/scalar/export intervals were heavily quantized, including zero values; they must not be used as trustworthy individual latency results. The runner was deliberately terminated while Firefox was executing to revise batching. The reported closed-page error is an interruption artifact; it does not establish a Firefox failure.

The final baseline uses batches calibrated to ≥5ms, retains their actual operation counts and elapsed intervals, and explicitly calls the result amortized throughput. All native-DOM typing timings remain separate from the Rust microkernel.
