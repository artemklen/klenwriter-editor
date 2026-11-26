# Build a release candidate

Use the [pinned tools and build prerequisites](../CONTRIBUTING.md) and the
source revision chosen for the coordinated release. The candidate builder
assembles Rust and npm archives, prebuilt WASM, the KWDJ registry, and the
versioned corpus. Its manifest binds the exact source, versions, and hashes.
Each archive has a corresponding SPDX inventory and NOTICE.

In a clean checkout, install the build dependencies. Create the bundle in a
new directory outside the checkout.

```sh
npm ci --ignore-scripts
cargo fetch --locked
output_parent="$(mktemp -d)"
node scripts/release/build-candidate.mjs "$output_parent/candidate"
node scripts/release/verify-candidate.mjs "$output_parent/candidate"
```

The builder records the pinned language tools and build platform. It sets the
archive epoch from the source commit and normalizes Rust source paths during
compilation. Package manifests are staged in scratch space for archive creation.

For reproducibility, run the same commands from two independent clean checkouts
of the exact revision on the same build platform. Verify both output directories
together.

```sh
node scripts/release/verify-candidate.mjs /absolute/path/to/first/candidate /absolute/path/to/second/candidate
```

This verifies every file against its recorded bytes and compares the two
manifests. Record the manifest SHA-256 with the candidate's local checks and
independent review. The GitHub candidate workflow provides the archives from the
pull request's exact head. [Versioning policy](versioning.md)

## Install and exercise the candidate

Prepare the pinned toolchain, the Playwright Chromium browser and the npm
cache for the two web quickstarts. The check uses separate scratch projects
and installs only the candidate's editor archives. The browser projects run
without Cargo, workspace packages or a CMS.

```sh
npx playwright install chromium
node scripts/release/check-consumers.mjs "$output_parent/candidate"
```

The JSON receipt records Rust installation and typed admission, Vanilla JS
and Angular edit/save/reopen, and the WASM bytes loaded by each browser
example. The Angular example also runs its production build. Installed
browser qualification has its own checks in the [support matrix](support.md).
