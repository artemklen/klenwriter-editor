# Recover a withdrawn or partial release

Use the [package map](../package-map.json) and accepted release manifest to
identify the exact family version and its registry members. This procedure
applies to npm, crates.io, and the associated GitHub release. See the
[support and deprecation policy](support-policy.md) for the public support
commitments. A registry action does not roll back installed code or stored
editor documents.

## Establish what reached consumers

1. Stop promotion and further uploads while investigating. Record the affected
   version, source SHA, expected digests, cause, current npm tags, and any
   previous stable family version verified across both registries. Retain the
   release manifest and the original Git tag.
2. Inventory every package in the manifest. Record an absent exact version as
   absent only after a reliable not-found response. Resolve authentication,
   timeout and stale-index results before treating a package as absent.
   Compare the actual registry integrity/checksum with the accepted manifest.
   Record any GitHub release and tag that already exist.
3. The release owner decides whether to resume the accepted release or withdraw
   it. Registry and GitHub writes are performed by authorized maintainers with
   current rights to the exact package, version or release. Authorization to
   publish a different version requires its own release approval. Keep
   credentials out of commands, logs, and release notes.

Example readback for a package from each family. Repeat for the entries in the
accepted manifest and retain the output.

```sh
affected=1.0.0
npm_pkg=@klenwriter/editor
crate=klenwriter-editor-core
npm_registry=https://registry.npmjs.org

npm view "$npm_pkg@$affected" version dist.integrity dist.tarball deprecated \
  --json --prefer-online --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
npm dist-tag ls "$npm_pkg" --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
curl -fsS -A 'KlenWriter-release-readback/1.0' \
  "https://crates.io/api/v1/crates/$crate/$affected" |
  jq -e --arg version "$affected" \
    '.version | select(.num == $version) | {num, checksum, yanked}'
```

Validate the metadata against the manifest. To check the bytes independently,
download the exact tarball URL returned by npm and the corresponding crates.io
archive. Compute each download’s SHA-256 from a fresh directory and compare it
with the manifest. For npm, also verify the advertised SHA-512 integrity. Treat
a mismatch as an incident. Preserve the actual digest and block the affected
version from stable promotion. When a partial set contains only
accepted bytes, the owner may authorize continuing with the missing entries
from the same manifest. Skip already present versions whose bytes match.
If an uploaded entry needs changed bytes, withdraw or deprecate the affected
set and prepare a reviewed successor at a new version. After a clean readback
of the entire family, mark the approved release stable. A nonstable npm tag
records the promotion state. Public versions can already be selected by npm
version ranges. crates.io exposes versions as they are published and has no
equivalent promotion tag.
[npm dist-tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/).

## Withdraw or redirect selection

Publish or update a public notice when the withdrawal is decided. State the
affected exact versions, whether existing installs still resolve, and the
verified replacement or recovery path. Keep the original release identifier
so consumers can match their lockfiles. Put the notice in the release notes
when they exist. Otherwise, publish the notice through the public repository
using the support policy. Link to the notice from npm deprecation messages.

### npm

With a verified previous stable release, point `latest` for each affected
package to its corresponding verified stable version. Restore the family in
dependency order, then deprecate the affected exact versions. In the example
below, set `stable` from the verified previous manifest and `notice` to the
approved public message. Repeat only for entries the inventory shows are
affected and published.

```sh
npm dist-tag add "$npm_pkg@$stable" latest --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
npm deprecate "$npm_pkg@$affected" "$notice" --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
npm dist-tag ls "$npm_pkg" --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
npm view "$npm_pkg@$affected" deprecated --json --prefer-online \
  --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
```

For the first release there is no previous stable version. Leave unpromoted
packages off `latest`. Deprecate the published affected versions. Remove
project-controlled promotion tags that still select them where npm permits
tag removal. If `latest` points to the affected version,
attempt removal and read back the result. If the registry leaves `latest` in
place, record that a default install can still resolve the deprecated
version. Even with `latest` unset, a fresh install or dependency range can
still select a published deprecated version. State the observed resolution
in the notice. Only a verified published stable family qualifies as a
replacement for `latest`.

```sh
npm deprecate "$npm_pkg@$affected" "$notice" --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
npm dist-tag rm "$npm_pkg" "$affected_tag" --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
npm dist-tag ls "$npm_pkg" --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
npm view "$npm_pkg@$affected" deprecated --json --prefer-online \
  --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"
```

Set `affected_tag` only after confirming it currently selects `affected`.
Deprecation leaves exact versions downloadable and warns during installation.
An erroneous deprecation can be reversed by the authorized publisher with
`npm deprecate "$npm_pkg@$affected" "" --registry "$npm_registry" "--@klenwriter:registry=$npm_registry"`.
Unpublishing is an exceptional, separately approved action subject to npm's
current policy. It removes the version for downstream users and is
irreversible. npm does not permit reusing a name/version pair after removal.
[npm deprecate](https://docs.npmjs.com/cli/v11/commands/npm-deprecate/),
[npm unpublish policy](https://docs.npmjs.com/policies/unpublish/).

### crates.io

Yank each published exact crate version that must be withdrawn. Include
released entry points that depend on the withdrawn versions so a fresh
resolution does not select a broken family. Keep known-good earlier
versions available.

```sh
cargo yank --registry crates-io --version "$affected" "$crate"
curl -fsS -A 'KlenWriter-release-readback/1.0' \
  "https://crates.io/api/v1/crates/$crate/$affected" |
  jq -e --arg version "$affected" \
    '.version | select(.num == $version and .yanked == true) | {num, checksum, yanked}'
```

For a first release, yanking may leave no version available for a new Cargo
resolution. State this in the public notice. Existing lockfiles and direct
downloads can still use yanked bytes. A broken artifact must be
replaced by a new version. If a yank was erroneous, `cargo yank --registry
crates-io --version "$affected" --undo "$crate"` restores eligibility,
subject to owner approval. Verify that `yanked` is false afterward.
[Cargo yank](https://doc.rust-lang.org/cargo/commands/cargo-yank.html).

### GitHub release

If the affected release already exists, update its notes so the original tag,
checksums, withdrawal notice and recovery instructions remain discoverable.
Use `announcement_file` containing the full updated notes, including release
history. Confirm a previous stable GitHub release exists before marking it
latest. During a partial first publication, the notice can state that there is
no verified stable release yet.

```sh
repo=artemklen/klenwriter-editor
gh release edit "$affected_release_tag" --repo "$repo" --latest=false \
  --notes-file "$announcement_file"
gh release view "$affected_release_tag" --repo "$repo" --json tagName,body,url

# Only when a verified stable GitHub release exists:
gh release edit "$stable_release_tag" --repo "$repo" --latest

# Read back latest in either case. A repository without a latest release can return HTTP 404.
gh api "repos/$repo/releases/latest" --jq .tag_name
```

Record the published note URL and the latest-release readback. Retain the
original release assets and Git tag so their bytes remain attributable.
[GitHub release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository),
[GitHub CLI release edit](https://cli.github.com/manual/gh_release_edit).

## Verify consumer recovery

- Preserve the user's last readable document and drafts before changing
  dependencies. Restore the last verified application deployment if it can
  read those document bytes. With no safe previous deployment or stable
  package set, pause affected installs or editing and use the application's
  verified export/recovery path. Wait for a verified successor when none is
  available.
- Pin all editor packages to one verified version and restore or regenerate
  the matching lockfile in a clean consumer. For npm, inspect the exact
  versions and integrity in `package-lock.json`, then run `npm ci` on it.
  For Cargo, apply exact crate pins, verify the crates.io checksums in
  `Cargo.lock`, and run `cargo build --locked`. With a prior stable set,
  prove a fresh consumer resolves that set. Without one, verify the fresh
  resolution or documented limitation from the withdrawal readback. Use a new
  directory with no lockfile to test selection. For Cargo, an exact pin to a
  yanked version should make `cargo generate-lockfile` fail in that directory.
- Run the native, vanilla and Angular quickstarts on the recovered set.
  Confirm the expected package versions and a save/reopen round trip with an
  existing document. Publish the replacement guidance with the same version,
  compatibility information and verified artifacts. Retain before/after
  registry readback and consumer results in the recovery record.
  [Compatibility and limitations](support.md).
