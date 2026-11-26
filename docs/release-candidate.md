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
Rust archive staging also copies referenced public test fixtures and adjusts
their paths so the packaged tests and examples can run outside the checkout.

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

## Publish an approved release

Keep the independently reproduced candidate and its receipt after merge. The
release owner authorizes the exact version and manifest SHA-256. The publisher
checks current npm scope permissions, crates.io publishing rights and name
availability. Creating new crates requires a verified crates.io account and a
token with permission to publish new crates. Configure credentials in the
publisher environment and keep them out of logs and release assets.
[npm organization roles](https://docs.npmjs.com/organization-roles-and-permissions/),
[crates.io credentials](https://doc.rust-lang.org/cargo/reference/registry-authentication.html)

Run the publisher from a clean checkout after the candidate source reaches
public `main`. Pass the approved values and a new receipt path outside the
checkout. The default `check` operation reads both public registries without
publishing.

```sh
node scripts/release/publish-candidate.mjs "$candidate" "$version" "$manifest_sha256" "$receipt" check
node scripts/release/publish-candidate.mjs "$candidate" "$version" "$manifest_sha256" "$publish_receipt" publish
```

Publication uploads the original archives in dependency order and compares
each downloaded archive against the manifest. It promotes npm `latest` after
the complete registry set is readable. A partial release retains its receipt.
Resolve uncertain outcomes through public readback before continuing. Follow
the [recovery procedure](release-rollback.md) for approval to `resume` with
the same manifest and a new receipt. The resume operation skips versions it
has verified in the registry. Allow for crates.io rate limits on new names.
[Cargo upload protocol](https://doc.rust-lang.org/cargo/reference/registry-web-api.html#publish),
[npm tarball publication](https://docs.npmjs.com/cli/v11/commands/npm-publish/)

After registry readback and npm promotion, create the `v<version>` GitHub
release at the accepted source commit. Attach the manifest and preserved
candidate bundle, including the standalone WASM, KWDJ registry, corpus and
provenance. Include verified registry links and checksums in the release
notes. Confirm the public tag target and downloaded release assets match the
receipt. [GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
