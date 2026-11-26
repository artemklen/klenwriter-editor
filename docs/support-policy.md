# Support and deprecation policy

## Supported releases

KlenWriter Editor is preparing its first `1.0.0` release. While registry
packages are unpublished, the quickstarts describe how to install and verify
local archives. The [compatibility matrix](support.md) records the covered
environments, release evidence and known limitations.

Once packages are published, maintenance and security fixes target the latest
stable release listed in the compatibility matrix. Any maintained earlier
release line will be listed there explicitly. Match your Rust or npm packages
to the version and archive set for your release. Use the
[public issue chooser](https://github.com/artemklen/klenwriter-editor/issues/new/choose)
for integration help and bug reports or the [security policy](../SECURITY.md)
for potential vulnerabilities.

## Deprecation and withdrawal

When a supported interface is deprecated, release notes identify the affected
interface, the release that introduces the deprecation and the recommended
replacement or migration path. Incompatible changes to supported package
interfaces follow the [versioning policy](versioning.md).

If a release is withdrawn, the withdrawal notice identifies the affected
versions and the verified replacement or recovery path. Registry tags,
deprecation and yanking follow the [release recovery procedure](release-rollback.md).
