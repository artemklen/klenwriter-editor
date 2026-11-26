#!/usr/bin/env python3
# SPDX-License-Identifier: MIT OR Apache-2.0
"""Package and run the native quickstart against local Cargo archives."""

import argparse
from hashlib import sha256
from io import BytesIO
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib


EXAMPLE = Path(__file__).resolve().parent
ROOT = EXAMPLE.parents[1]
IDENTITY = json.loads((ROOT / "package-map.json").read_text())
VERSION = IDENTITY["versions"]["packageSemver"]
CRATES = [IDENTITY["rust"][role]["name"] for role in ("core", "registry", "kwdj", "engine")]
CARGO = ["cargo", "+1.97.1"]
EXAMPLE_SOURCE = "examples/native-quickstart/examples/quickstart.rs"
EXAMPLE_MANIFEST = "examples/native-quickstart/Cargo.toml"
QUICKSTART = "docs/quickstart-rust.md"


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def archive_name(name, version=VERSION):
    return f"{name}-{version}.crate"


def unpack(archive, destination, name, version=VERSION, publish=False):
    with tarfile.open(fileobj=BytesIO(archive), mode="r:gz") as package:
        package.extractall(destination, filter="data")
    path = destination / f"{name}-{version}"
    metadata = tomllib.loads((path / "Cargo.toml").read_text())["package"]
    assert (metadata["name"], metadata["version"], metadata["publish"]) == (name, version, publish)
    return path


def cargo_patches(paths):
    return [
        argument
        for name, path in paths.items()
        for argument in ("--config", f"patch.crates-io.{name}.path={json.dumps(str(path))}")
    ]


def pack(directory):
    directory.mkdir()
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    with tempfile.TemporaryDirectory(prefix="kwe-native-producer-") as temporary:
        isolated = Path(temporary)
        source = isolated / "source"
        source.mkdir()
        exact_source = isolated / "source.tar"
        with exact_source.open("wb") as archive:
            subprocess.run(["git", "archive", head], cwd=ROOT, stdout=archive, check=True)
        with tarfile.open(exact_source) as archive:
            archive.extractall(source, filter="data")
        shutil.copyfile(source / "Cargo.lock", directory / "Cargo.lock")
        target = isolated / "target"
        paths = {}
        for name in CRATES:
            subprocess.run([
                *CARGO, "package", "--offline", "--no-verify", "--target-dir", str(target),
                "-p", name, *cargo_patches(paths),
            ], cwd=source, check=True)
            archive = directory / archive_name(name)
            shutil.copyfile(target / "package" / archive.name, archive)
            paths[name] = unpack(archive.read_bytes(), isolated / "packages", name)
    receipt = {
        "source": head,
        "version": VERSION,
        "archives": {archive_name(name): digest(directory / archive_name(name)) for name in CRATES},
        "lockSha256": digest(directory / "Cargo.lock"),
    }
    (directory / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


def registry_pins(lock):
    return {
        (pkg["name"], pkg["version"], pkg["source"], pkg.get("checksum"))
        for pkg in tomllib.loads(lock.decode())["package"]
        if "source" in pkg
    }


def execute_example(archives, source_file, version, publish):
    snippet = source_file(QUICKSTART).decode().split("```rust\n")[1].split("```")[0]
    example = source_file(EXAMPLE_SOURCE)
    assert snippet.encode() == example, "Rust snippet must match the example"

    frozen_lock = source_file("Cargo.lock")
    with tempfile.TemporaryDirectory(prefix="kwe-native-consumer-") as temporary:
        consumer = Path(temporary).resolve()
        assert not consumer.is_relative_to(ROOT)
        packages = {
            name: unpack(archive, consumer / "packages", name, version, publish)
            for name, archive in archives.items()
        }
        (consumer / "examples").mkdir()
        (consumer / "examples/quickstart.rs").write_bytes(example)
        (consumer / "Cargo.toml").write_bytes(source_file(EXAMPLE_MANIFEST))
        lock = consumer / "Cargo.lock"
        lock.write_bytes(frozen_lock)
        env = {
            **os.environ,
            "CARGO_TARGET_DIR": str(consumer / "target"),
            "CARGO_BUILD_BUILD_DIR": str(consumer / "build"),
            "RUSTC_WRAPPER": "",
            "RUSTC_WORKSPACE_WRAPPER": "",
        }
        patches = cargo_patches(packages)
        metadata = json.loads(subprocess.check_output([
            *CARGO, "metadata", "--offline", "--format-version", "1", *patches,
        ], cwd=consumer, env=env))
        resolved = {
            row["name"]: (Path(row["manifest_path"]).parent, row["version"], row["source"])
            for row in metadata["packages"] if row["name"].startswith("klenwriter-editor-")
        }
        assert resolved == {
            name: (path, version, None) for name, path in packages.items()
        }, "Every editor crate must resolve to its exact unpacked archive"
        assert all(
            not Path(row["manifest_path"]).is_relative_to(ROOT)
            for row in metadata["packages"]
        ), "Consumer depends on the source checkout"
        resolved_lock = lock.read_bytes()
        assert registry_pins(resolved_lock) <= registry_pins(frozen_lock), "Consumer changed a pinned registry dependency"
        output = subprocess.check_output([
            *CARGO, "run", "--offline", "--locked", "--example", "quickstart", *patches,
        ], cwd=consumer, env=env, text=True)
        assert lock.read_bytes() == resolved_lock, "Cargo run changed the resolved lock"
        return output, sha256(resolved_lock).hexdigest()


def run(directory):
    receipt = json.loads((directory / "receipt.json").read_text())
    assert receipt["version"] == VERSION
    assert receipt["lockSha256"] == digest(directory / "Cargo.lock")
    archives = {}
    for name in CRATES:
        filename = archive_name(name)
        archive = (directory / filename).read_bytes()
        assert sha256(archive).hexdigest() == receipt["archives"][filename]
        archives[name] = archive

    def source_file(path):
        return (directory / path if path == "Cargo.lock" else ROOT / path).read_bytes()

    output, _ = execute_example(archives, source_file, VERSION, False)
    print(output, end="")
    print(json.dumps(receipt, indent=2))
    print("PASS native admit, edit, canonical export, typed refusal and documentation parity")


def run_candidate(directory, manifest):
    assert manifest["format"] == "klenwriter-editor-release-candidate/1"
    commit = manifest["source"]["commit"]
    assert re.fullmatch(r"[a-f0-9]{40}", commit), "Invalid candidate source commit"
    resolved_commit = subprocess.check_output(["git", "rev-parse", f"{commit}^{{commit}}"], cwd=ROOT, text=True).strip()
    assert resolved_commit == commit, "Candidate source must identify a commit"
    tree = subprocess.check_output(["git", "rev-parse", f"{commit}^{{tree}}"], cwd=ROOT, text=True).strip()
    assert tree == manifest["source"]["tree"], "Candidate tree mismatch"

    def source_file(path):
        return subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=ROOT)

    package_map = json.loads(source_file("package-map.json"))
    version = manifest["version"]
    assert version == package_map["versions"]["packageSemver"], "Candidate version differs from its source"
    catalogue = {entry["name"] for entry in package_map["rust"].values()}
    records = [item for item in manifest["artifacts"] if item["kind"] == "crate"]
    assert len(records) == len(catalogue) and {item["name"] for item in records} == catalogue
    selected = [package_map["rust"][role]["name"] for role in ("core", "registry", "kwdj", "engine")]
    archives = {}
    receipts = {}
    for item in records:
        name = item["name"]
        expected = "crates/" + archive_name(name, version)
        assert item["path"] == expected and item["version"] == version, "Incorrect candidate crate record"
        archive_path = directory / expected
        assert archive_path.resolve() == archive_path and archive_path.is_file(), "Unsafe candidate crate path"
        archive = archive_path.read_bytes()
        actual = sha256(archive).hexdigest()
        assert len(archive) == item["bytes"] and actual == item["sha256"], f"Archive digest mismatch: {name}"
        if name in selected:
            archives[name] = archive
            receipts[name] = {"name": name, "version": version, "sha256": actual}

    output, resolved = execute_example(archives, source_file, version, ["crates-io"])
    exported, refusal = output.splitlines()
    json.loads(exported)
    assert refusal == "kwdj.unsupported_schema at /schema", "Expected typed document refusal"
    return {
        "status": "pass",
        "sourceCommit": commit,
        "version": version,
        "installedCrates": [receipts[name] for name in selected],
        "sourceLockSha256": sha256(source_file("Cargo.lock")).hexdigest(),
        "resolvedLockSha256": resolved,
        "exportedDocument": exported,
        "exportedDocumentSha256": sha256(exported.encode()).hexdigest(),
        "typedRefusal": refusal,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("pack", "run", "run-candidate"))
    parser.add_argument("archives", type=Path)
    args = parser.parse_args()
    directory = args.archives.resolve()
    if args.action == "pack":
        pack(directory)
    elif args.action == "run":
        run(directory)
    else:
        print(json.dumps(run_candidate(directory, json.load(sys.stdin))))


if __name__ == "__main__":
    main()
