# Release pipeline

- Only the `main` push release job may publish, after both `checks` and `windows-tests` pass. Keep `contents: write` scoped to that job and all actions pinned to full commit SHAs.
- Download the exact `checks` artifact ID. Publication must never rebuild the EXE; the full artifact includes dependency licenses, notices and Windows acceptance docs.
- `scripts/publish-release.py` expects `build/bin/` and `GH_REPO`, `GITHUB_SHA`, `GITHUB_RUN_NUMBER`. Validate the artifact before GitHub calls; upload only to a matching `build-N` draft, never replace published assets. Check main head and tag target before publication.
- Verify changes offline with `python3 .github/scripts/test_publish_release.py`. Its stateful fake `gh` covers actual packaging and release transitions without GitHub access.
