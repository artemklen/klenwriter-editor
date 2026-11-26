#!/usr/bin/env python3
# SPDX-License-Identifier: MIT OR Apache-2.0
"""Package and run the native quickstart against local Cargo archives."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import tomllib


EXAMPLE = Path(__file__).resolve().parent
ROOT = EXAMPLE.parents[1]
IDENTITY = json.loads((ROOT / "package-map.json").read_text())
VERSION = IDENTITY["versions"]["packageSemver"]
CRATES = [IDENTITY["rust"][role]["name"] for role in ("core", "registry", "kwdj", "engine")]
CARGO = ["cargo", "+1.97.1"]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def archive_name(name):
    return f"{name}-{VERSION}.crate"


def unpack(archive, destination, name):
    with tarfile.open(archive) as package:
        package.extractall(destination, filter="data")
    path = destination / f"{name}-{VERSION}"
    metadata = tomllib.loads((path / "Cargo.toml").read_text())["package"]
    assert (metadata["name"], metadata["version"], metadata["publish"]) == (name, VERSION, False)
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
            paths[name] = unpack(archive, isolated / "packages", name)
    receipt = {
        "source": head,
        "version": VERSION,
        "archives": {archive_name(name): digest(directory / archive_name(name)) for name in CRATES},
        "lockSha256": digest(directory / "Cargo.lock"),
    }
    (directory / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


def run(directory):
    example_source = EXAMPLE / "examples/quickstart.rs"
    page = (ROOT / "docs/quickstart-rust.md").read_text()
    assert page.split("```rust\n")[1].split("```")[0] == example_source.read_text(), "Rust snippet must match the example"
    receipt = json.loads((directory / "receipt.json").read_text())
    assert receipt["version"] == VERSION
    assert receipt["lockSha256"] == digest(directory / "Cargo.lock")
    with tempfile.TemporaryDirectory(prefix="kwe-native-consumer-") as temporary:
        consumer = Path(temporary).resolve()
        assert not consumer.is_relative_to(ROOT)
        packages = {}
        for name in CRATES:
            archive = directory / archive_name(name)
            assert digest(archive) == receipt["archives"][archive.name]
            packages[name] = unpack(archive, consumer / "packages", name)
        (consumer / "examples").mkdir()
        shutil.copyfile(example_source, consumer / "examples/quickstart.rs")
        shutil.copyfile(EXAMPLE / "Cargo.toml", consumer / "Cargo.toml")
        shutil.copyfile(directory / "Cargo.lock", consumer / "Cargo.lock")
        patches = cargo_patches(packages)
        metadata = json.loads(subprocess.check_output([
            *CARGO, "metadata", "--offline", "--format-version", "1", *patches,
        ], cwd=consumer))
        resolved = {
            row["name"]: Path(row["manifest_path"]).parent
            for row in metadata["packages"] if row["name"].startswith("klenwriter-editor-")
        }
        assert resolved == packages, "Every editor crate must resolve to its unpacked archive"
        subprocess.run([
            *CARGO, "run", "--offline", "--locked", "--example", "quickstart", *patches,
        ], cwd=consumer, check=True)
    print(json.dumps(receipt, indent=2))
    print("PASS native admit, edit, canonical export, typed refusal and documentation parity")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("pack", "run"))
    parser.add_argument("archives", type=Path)
    args = parser.parse_args()
    directory = args.archives.resolve()
    if args.action == "pack":
        pack(directory)
    else:
        run(directory)


if __name__ == "__main__":
    main()
