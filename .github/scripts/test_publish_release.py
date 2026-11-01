"""Run real packaging/publication decisions against an offline, stateful gh fake."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name("publish-release.py").resolve()
SHA = "a" * 40
OTHER_SHA = "b" * 40
FAKE_GH = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import shutil
import sys
args = sys.argv[1:]
root = Path(os.environ["FAKE_GH_ROOT"])
state_path = root / "state.json"
state = json.loads(state_path.read_text())
with (root / "calls.jsonl").open("a") as log:
    log.write(json.dumps(args) + "\n")
def save():
    state_path.write_text(json.dumps(state))
if args[0] == "api":
    endpoint = args[1]
    if "branches/main" in endpoint:
        state["head_calls"] = state.get("head_calls", 0) + 1
        save()
        if state.get("fail") == "head":
            sys.exit(1)
        print(json.dumps({"commit": {"sha": state.get("later_head" if state["head_calls"] > 1 else "head", os.environ["GITHUB_SHA"])}}))
    elif "releases?" in endpoint:
        if state.get("fail") == "query":
            sys.exit(1)
        print(state.get("raw_releases", json.dumps([state["releases"]])))
    elif "git/matching-refs/" in endpoint:
        if state.get("fail") == "refs":
            sys.exit(1)
        print(json.dumps([{"ref": "refs/tags/build-42"}] if state.get("tag_sha") else []))
    elif "commits/" in endpoint:
        if state.get("fail") == "commit":
            sys.exit(1)
        print(json.dumps({"sha": state.get("tag_sha", os.environ["GITHUB_SHA"])}))
    else:
        sys.exit(2)
elif args[:2] == ["release", "create"]:
    if state.get("fail") == "create":
        sys.exit(1)
    assert "--draft" in args
    assert "--target" in args
    assert not state["releases"]
    state["releases"] = [{"tag_name": args[2], "draft": True, "target_commitish": args[args.index("--target") + 1]}]
    save()
elif args[:2] == ["release", "upload"]:
    assert state["releases"][0]["draft"] is True
    assert "--clobber" in args
    if state.get("fail") == "upload":
        sys.exit(1)
    for name in args[3:]:
        if name != "--clobber":
            shutil.copyfile(name, root / "remote" / Path(name).name)
elif args[:2] == ["release", "edit"]:
    assert "--draft=false" in args and "--latest" in args
    if state.get("fail") == "publish":
        sys.exit(1)
    state["releases"][0]["draft"] = False
    state["tag_sha"] = os.environ["GITHUB_SHA"]
    save()
else:
    sys.exit(2)
'''


class PublishReleaseTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.binary = self.root / "build/bin"
        self.binary.mkdir(parents=True)
        self.exe = b"checked Windows executable\x00"
        self.files = {
            "Daynote.exe": self.exe,
            "README.md": b"Daynote documentation",
            "THIRD_PARTY_NOTICES.md": b"Third party notices",
            "docs/windows-acceptance.md": b"Manual Windows checks",
            "docs/screenshots/settings.png": b"image fixture",
            "licenses/example/LICENSE": b"Dependency license",
            "licenses/index.json": b"[]",
            "SHA256SUMS.txt": f"{hashlib.sha256(self.exe).hexdigest()}  Daynote.exe\n".encode(),
        }
        for name, data in self.files.items():
            path = self.binary / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.fake_root = self.root / "github"
        self.fake_root.mkdir()
        (self.fake_root / "remote").mkdir()
        self.state = {"releases": []}
        fake = self.root / "gh"
        fake.write_text(FAKE_GH)
        fake.chmod(0o755)

    def run_release(self, **updates):
        self.state.update(updates)
        (self.fake_root / "state.json").write_text(json.dumps(self.state))
        env = dict(os.environ, PATH=f"{self.root}:{os.environ['PATH']}",
                   GH_REPO="owner/daynote", GITHUB_SHA=SHA,
                   GITHUB_RUN_NUMBER="42", FAKE_GH_ROOT=str(self.fake_root))
        result = subprocess.run([sys.executable, str(SCRIPT)], cwd=self.root,
                                env=env, text=True, capture_output=True, check=False)
        self.state = json.loads((self.fake_root / "state.json").read_text())
        calls_file = self.fake_root / "calls.jsonl"
        self.calls = [json.loads(line) for line in calls_file.read_text().splitlines()] if calls_file.exists() else []
        return result

    def mutations(self):
        return [call for call in self.calls if call[0] == "release"]

    def test_new_release_has_checked_exe_full_zip_and_verifiable_checksums(self):
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        remote = self.fake_root / "remote"
        self.assertEqual({p.name for p in remote.iterdir()},
                         {"Daynote.exe", "Daynote-windows-x64.zip", "SHA256SUMS.txt"})
        self.assertEqual((remote / "Daynote.exe").read_bytes(), self.exe)
        with zipfile.ZipFile(remote / "Daynote-windows-x64.zip") as archive:
            self.assertEqual(set(archive.namelist()), set(self.files))
            for name, data in self.files.items():
                self.assertEqual(archive.read(name), data, name)
        for line in (remote / "SHA256SUMS.txt").read_text().splitlines():
            digest, name = line.split("  ")
            self.assertEqual(hashlib.sha256((remote / name).read_bytes()).hexdigest(), digest)
        self.assertEqual(len((remote / "SHA256SUMS.txt").read_text().splitlines()), 2)
        self.assertFalse(self.state["releases"][0]["draft"])
        self.assertEqual([call[1] for call in self.mutations()], ["create", "upload", "edit"])
        self.assertIn(SHA, self.mutations()[0])
        self.assertEqual((self.binary / "SHA256SUMS.txt").read_bytes(), self.files["SHA256SUMS.txt"])

    def test_corrupt_or_malformed_checksum_fails_before_github(self):
        for checksum in (b"invalid\n", b"0" * 64 + b"  Daynote.exe\n", b"", self.files["SHA256SUMS.txt"] * 2,
                         self.files["SHA256SUMS.txt"].replace(b"Daynote.exe", b"../Daynote.exe")):
            with self.subTest(checksum=checksum):
                (self.binary / "SHA256SUMS.txt").write_bytes(checksum)
                result = self.run_release()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls, [])

    def test_missing_distribution_documentation_fails_before_github(self):
        (self.binary / "THIRD_PARTY_NOTICES.md").unlink()
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls, [])

    def test_changed_executable_fails_before_github(self):
        (self.binary / "Daynote.exe").write_bytes(b"not the checked executable")
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls, [])

    def test_stale_head_skips_all_release_mutations(self):
        result = self.run_release(head=OTHER_SHA)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.mutations(), [])

    def test_main_advancing_during_upload_keeps_draft(self):
        result = self.run_release(later_head=OTHER_SHA)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.state["releases"][0]["draft"])
        self.assertNotIn("edit", [call[1] for call in self.mutations()])

    def test_api_failures_never_create_or_modify_release(self):
        for failure in ("head", "query", "refs", "commit"):
            with self.subTest(failure=failure):
                result = self.run_release(fail=failure, tag_sha=SHA)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.mutations(), [])
                (self.fake_root / "calls.jsonl").unlink(missing_ok=True)

    def test_failed_create_or_upload_or_publication_fails_safely(self):
        for failure in ("create", "upload", "publish"):
            with self.subTest(failure=failure):
                result = self.run_release(fail=failure, releases=[])
                self.assertNotEqual(result.returncode, 0)
                if failure != "create":
                    self.assertEqual(len(self.state["releases"]), 1)
                    self.assertTrue(self.state["releases"][0]["draft"])
                if failure != "publish":
                    self.assertNotIn("edit", [call[1] for call in self.mutations()])
                (self.fake_root / "calls.jsonl").unlink(missing_ok=True)

    def test_retry_completes_matching_draft(self):
        result = self.run_release(releases=[{"tag_name": "build-42", "draft": True, "target_commitish": SHA}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.state["releases"][0]["draft"])
        self.assertEqual([call[1] for call in self.mutations()], ["upload", "edit"])

    def test_retry_recovers_actual_failed_upload(self):
        result = self.run_release(fail="upload")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.state["releases"][0]["draft"])
        (self.fake_root / "calls.jsonl").unlink()
        result = self.run_release(fail="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.state["releases"][0]["draft"])
        self.assertEqual([call[1] for call in self.mutations()], ["upload", "edit"])
        self.assertEqual({p.name for p in (self.fake_root / "remote").iterdir()},
                         {"Daynote.exe", "Daynote-windows-x64.zip", "SHA256SUMS.txt"})

    def test_retry_does_not_replace_published_assets(self):
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        original = {p.name: p.read_bytes() for p in (self.fake_root / "remote").iterdir()}
        (self.fake_root / "calls.jsonl").unlink(missing_ok=True)
        (self.binary / "README.md").write_text("a rerun must not replace original assets")
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.mutations(), [])
        self.assertEqual({p.name: p.read_bytes() for p in (self.fake_root / "remote").iterdir()}, original)

    def test_conflicting_draft_or_published_tag_fails_without_mutations(self):
        for draft, target, tag_sha in ((True, OTHER_SHA, SHA), (True, SHA, OTHER_SHA),
                                       (False, "main", OTHER_SHA)):
            with self.subTest(draft=draft, target=target, tag_sha=tag_sha):
                result = self.run_release(releases=[{"tag_name": "build-42", "draft": draft, "target_commitish": target}], tag_sha=tag_sha)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.mutations(), [])
                (self.fake_root / "calls.jsonl").unlink(missing_ok=True)

    def test_preexisting_conflicting_tag_without_release_fails(self):
        result = self.run_release(tag_sha=OTHER_SHA)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_malformed_release_api_response_fails_without_mutations(self):
        for raw in ("not JSON", "null", "[[{}]]", '[[{"tag_name":"build-42","draft":"false","target_commitish":"main"}]]'):
            with self.subTest(raw=raw):
                result = self.run_release(raw_releases=raw)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.mutations(), [])
                (self.fake_root / "calls.jsonl").unlink(missing_ok=True)

    def test_symlink_is_not_packaged(self):
        (self.binary / "linked-secret").symlink_to(self.fake_root / "state.json")
        result = self.run_release()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
