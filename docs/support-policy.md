# Support and deprecation policy

## Supported releases

Maintenance and security fixes target the latest stable release listed in the
[compatibility matrix](support.md). The matrix records covered environments,
release evidence, known limitations and any maintained earlier release line.

Match your Rust or npm packages to the version and archive set for your
release. The quickstarts describe how to verify and install local archives.
Use the [public issue chooser](https://github.com/artemklen/klenwriter-editor/issues/new/choose)
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
