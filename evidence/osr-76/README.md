# Historical codec delivery evidence

`codec-v1-report.json` records OSR-76 at reviewed source
`3c2d255399a4d638c3cf065baace4b272c3c7206`. Its source hashes describe that
revision, not the evolving checkout. The temporary data snapshot was replaced
by the single authoritative package in `contracts/kwdj/v1` under OSR-30;
the original snapshot and provenance remain available in Git history.

Current checks generate fresh `artifacts/codec-v1-report.json` against the
versioned package. This historical report is evidence, never a second expected
matrix or an input to current tests.
