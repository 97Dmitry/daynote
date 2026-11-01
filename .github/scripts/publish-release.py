#!/usr/bin/env python3
"""Publish only the checked Windows artifact; invoked by the gated main push job."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile


def gh(*args, cwd=None):
    return subprocess.check_output(["gh", *args], text=True, cwd=cwd)


def api(repo, endpoint, *args):
    return json.loads(gh("api", f"repos/{repo}/{endpoint}", *args))


def commit_sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Expected a complete commit SHA from GitHub")
    return value


def current_head(repo, sha):
    return commit_sha(api(repo, "branches/main")["commit"]["sha"]) == sha


def validate_tag(repo, tag, sha):
    refs = api(repo, f"git/matching-refs/tags/{tag}")
    if not isinstance(refs, list) or any(not isinstance(ref, dict) or not isinstance(ref.get("ref"), str) for ref in refs):
        raise ValueError("Unexpected GitHub tag metadata")
    if any(ref["ref"] == f"refs/tags/{tag}" for ref in refs):
        if commit_sha(api(repo, f"commits/{tag}")["sha"]) != sha:
            raise ValueError(f"Refuse to reuse {tag}: its commit differs from {sha}")


def checked_files(binary):
    files = sorted(binary.rglob("*"))
    if any(path.is_symlink() or not (path.is_file() or path.is_dir()) for path in files):
        raise ValueError("Artifact must contain only regular files and directories")
    for name in ("Daynote.exe", "SHA256SUMS.txt", "README.md", "THIRD_PARTY_NOTICES.md",
                 "docs/windows-acceptance.md", "licenses/index.json"):
        path = binary / name
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Missing or empty artifact file: {name}")
    checksum = re.fullmatch(r"([0-9a-fA-F]{64}) [ *]Daynote.exe\n?",
                            (binary / "SHA256SUMS.txt").read_text(encoding="ascii"))
    if checksum is None or checksum[1].lower() != hashlib.sha256((binary / "Daynote.exe").read_bytes()).hexdigest():
        raise ValueError("Checked artifact's Daynote.exe SHA-256 does not match")
    return [path for path in files if path.is_file()]


def package(binary, files, output):
    shutil.copyfile(binary / "Daynote.exe", output / "Daynote.exe")
    # Fixed ZIP metadata makes a draft retry independent of extraction timestamps.
    with zipfile.ZipFile(output / "Daynote-windows-x64.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            entry = zipfile.ZipInfo(path.relative_to(binary).as_posix())
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes())
    sums = []
    for name in ("Daynote.exe", "Daynote-windows-x64.zip"):
        digest = hashlib.sha256((output / name).read_bytes()).hexdigest()
        sums.append(f"{digest}  {name}\n")
    (output / "SHA256SUMS.txt").write_text("".join(sums), encoding="ascii")


def main():
    repo = os.environ["GH_REPO"]
    sha = commit_sha(os.environ["GITHUB_SHA"])
    number = os.environ["GITHUB_RUN_NUMBER"]
    if not re.fullmatch(r"[1-9][0-9]*", number):
        raise ValueError("Expected a positive workflow run number")
    tag = f"build-{number}"
    binary = Path("build/bin")
    files = checked_files(binary)

    # GitHub concurrency ordering is not guaranteed. Check under the release lock.
    if not current_head(repo, sha):
        print(f"Skip {tag}: main has advanced beyond {sha}.")
        return
    pages = api(repo, "releases?per_page=100", "--paginate", "--slurp")
    if not isinstance(pages, list) or any(not isinstance(page, list) for page in pages):
        raise ValueError("Unexpected GitHub release pages")
    releases = [release for page in pages for release in page]
    for release in releases:
        if (not isinstance(release, dict) or not isinstance(release.get("tag_name"), str)
                or type(release.get("draft")) is not bool
                or not isinstance(release.get("target_commitish"), str)):
            raise ValueError("Unexpected GitHub release metadata")
    existing = [release for release in releases if release["tag_name"] == tag]
    if len(existing) > 1:
        raise ValueError(f"Multiple releases found for {tag}")
    validate_tag(repo, tag, sha)
    if existing:
        release = existing[0]
        if not release["draft"]:
            if commit_sha(api(repo, f"commits/{tag}")["sha"]) != sha:
                raise ValueError(f"Refuse to reuse published {tag}: commit differs")
            print(f"{tag} is already published; keep its original assets.")
            return
        if release["target_commitish"] != sha:
            raise ValueError(f"Refuse to reuse {tag}: unexpected draft target")

    with tempfile.TemporaryDirectory(prefix="daynote-release-") as temporary:
        output = Path(temporary)
        package(binary, files, output)
        if not existing:
            gh("release", "create", tag, "--target", sha, "--title", f"Daynote {tag}",
               "--generate-notes", "--draft")
        # Replace assets only on a matching draft. A failed upload remains private.
        gh("release", "upload", tag, "Daynote.exe", "Daynote-windows-x64.zip",
           "SHA256SUMS.txt", "--clobber", cwd=output)
        if not current_head(repo, sha):
            print(f"Keep {tag} as draft: main advanced during upload.")
            return
        validate_tag(repo, tag, sha)
        gh("release", "edit", tag, "--draft=false", "--latest")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, TypeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release publication failed: {error}", file=sys.stderr)
        sys.exit(1)
