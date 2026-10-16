# First expanded-run failure

The first expanded 102-case run began at `2026-10-16T21:09:12.853Z` (00:09:12 Europe/Moscow on October 17). It completed with **101 passed and one failed**. In Chromium, single-host `typing and browser undo` typed ` test`; one native Undo left ` tes`, so the assertion expecting the original document failed.

Preserved evidence:

- [summary.json](summary.json): run metadata, source hashes, exact failing assertion and the failure's test identity. Extracted from the original report; the two full reports are identified by hashes rather than copied again.
- [trace.zip](trace.zip): original Playwright trace, including source and screencast frames.
- [error-context.md](error-context.md) and [test-failed-1.png](test-failed-1.png): original failure context and screenshot.
- [typing-undo-repeat.log](typing-undo-repeat.log): all three isolated repetitions subsequently passed. This narrows reproducibility; it does not explain the original failure or prove deterministic native history grouping.
- [manifest.json](manifest.json): SHA-256 and sizes for the preserved files.

The trace's recorded network requests are confined to `http://127.0.0.1:4173/` and the spike's own assets. The screenshot contains only the sample document and its diagnostics. The separate failure video is omitted because the trace already contains screencast frames. Later corrected-oracle results must be read separately; this historical failure remains evidence of the earlier test's one-Undo grouping assumption.
