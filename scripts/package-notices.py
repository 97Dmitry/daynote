#!/usr/bin/env python3
"""Collect installed dependency license texts for the Windows distribution."""
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build/bin/licenses"
OUT.mkdir(parents=True, exist_ok=True)
records = []


def collect(name, version, directory):
    directory = Path(directory)
    target = OUT / re.sub(r"[^a-zA-Z0-9._-]", "_", f"{name}@{version}")
    candidates = [p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(("license", "licence", "notice", "copyright", "copying"))]
    if not candidates:
        fallback = ROOT / "third_party/licenses" / name
        if fallback.is_dir():
            candidates = list(fallback.iterdir())
    if not candidates:
        raise RuntimeError(f"No license file found for {name} at {directory}")
    target.mkdir(exist_ok=True)
    for source in candidates:
        shutil.copyfile(source, target / source.name)
    records.append({"package": name, "version": version, "files": [p.name for p in candidates]})


raw = subprocess.check_output(["go", "list", "-m", "-json", "all"], cwd=ROOT, text=True)
decoder = json.JSONDecoder()
while raw.strip():
    module, end = decoder.raw_decode(raw.lstrip())
    raw = raw.lstrip()[end:]
    if not module.get("Main") and module.get("Dir"):
        collect(module["Path"], module["Version"], module["Dir"])

tree = json.loads(subprocess.check_output(["vp", "exec", "pnpm", "list", "--prod", "--json", "--depth", "Infinity"], cwd=ROOT / "frontend", text=True))
seen = set()


def visit(dependencies):
    for name, package in dependencies.items():
        identity = (name, package["version"])
        if identity in seen:
            continue
        seen.add(identity)
        collect(name, package["version"], package["path"])
        visit(package.get("dependencies", {}))


for project in tree:
    visit(project.get("dependencies", {}))
(OUT / "index.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Collected notices for {len(records)} dependencies")
