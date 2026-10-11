#!/usr/bin/env python3
"""ARGUS ten-repository, read-only, pinned-commit research probes.

Only fetches specific public source files. Never executes project builds,
uses credentials, sends traffic to running target apps, or changes their repos.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_SOURCE_BYTES = 400_000
FETCH_TIMEOUT_SEC = 20

def load_target(target_id: str) -> dict:
    doc = json.loads((ROOT / "targets.json").read_text(encoding="utf-8"))
    matches = [t for t in doc["targets"] if t["id"] == target_id]
    if len(matches) != 1:
        raise ValueError("Unknown target id: " + target_id)
    return matches[0]

def fetch_source(repo: str, commit: str, path: str) -> tuple[str, dict]:
    """Read a pinned public blob over HTTPS with strict size/time bounds."""
    if len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit):
        raise ValueError("Expected full immutable commit SHA")
    if path.startswith("/") or ".." in Path(path).parts:
        raise ValueError("Invalid source path")
    owner, project = repo.split("/", 1)
    url = "https://raw.githubusercontent.com/{}/{}/{}/{}".format(
        urllib.parse.quote(owner), urllib.parse.quote(project),
        commit, urllib.parse.quote(path, safe="/")
    )
    req = urllib.request.Request(url, headers={"User-Agent": "ARGUS-Lab-Research/0.1"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as response:
        data = response.read(MAX_SOURCE_BYTES + 1)
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError("Source exceeds read-only maximum")
    source = data.decode("utf-8")
    metadata = {
        "path": path,
        "source_url": "https://github.com/{}/blob/{}/{}".format(repo, commit, path),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    return source, metadata

def isolated_langflow_probe(source: str) -> dict:
    """Exercise *only* the real encoding-selection function in isolation.

    Mock exactly one chardet result (Windows-1252); no third-party deps or
    project code execution beyond this reviewed individual function.
    """
    try:
        parsed = ast.parse(source)
        nodes = [n for n in parsed.body if isinstance(n, ast.FunctionDef)
                 and n.name == "_detect_encoding_with_fallbacks"]
        if len(nodes) != 1:
            return {"status": "not_run", "reason": "function missing"}
        class MockChardet:
            @staticmethod
            def detect(data: bytes) -> dict:
                return {"encoding": "Windows-1252"}
        ns = {"chardet": MockChardet, "_CHARDET_SAMPLE_BYTES": 102400}
        fn_ast = ast.Module(body=nodes, type_ignores=[])
        exec(compile(fn_ast, "<isolated-upstream-function>", "exec"), ns)
        raw = b"\x93"
        encodings = ns["_detect_encoding_with_fallbacks"](raw)
        observed = None
        for encoding in encodings:
            try:
                observed = raw.decode(encoding)
                break
            except (UnicodeDecodeError, LookupError):
                continue
        expected = raw.decode("cp1252")
        return {
            "status": "isolated_function_executed",
            "condition": "Mock detector reports Windows-1252 for byte 0x93",
            "encoding_order": encodings,
            "expected_codepoint": "U+{:04X}".format(ord(expected)),
            "observed_codepoint": "U+{:04X}".format(ord(observed)) if observed else None,
            "mismatch_reproduced": observed != expected,
            "scope": "Isolated upstream helper, not application end-to-end",
        }
    except Exception as exc:
        return {"status": "probe_error", "error": "{}: {}".format(type(exc).__name__, exc)}

def isolated_anythingllm_probe(source: str) -> dict:
    """Run pinned JS function with dummy dependencies inside a restricted VM."""
    try:
        with tempfile.TemporaryDirectory(prefix="argus-source-") as td:
            path = Path(td) / "upstream.js"
            path.write_text(source, encoding="utf-8")
            proc = subprocess.run(
                ["node", str(ROOT / "probe_anything.cjs"), str(path)],
                capture_output=True, text=True, timeout=12, check=False,
            )
            if proc.returncode != 0:
                return {"status": "probe_error", "reason": proc.stderr[-600:]}
            return json.loads(proc.stdout)
    except Exception as exc:
        return {"status": "probe_error", "error": "{}: {}".format(type(exc).__name__, exc)}

def run(target: dict) -> dict:
    files: dict[str, str] = {}
    receipts: list[dict] = []
    for path in sorted({c["file"] for c in target["checks"]}):
        try:
            source, receipt = fetch_source(target["repo"], target["commit"], path)
            files[path] = source
            receipts.append({"state": "fetched", **receipt})
        except Exception as exc:
            receipts.append({
                "state": "unavailable", "path": path,
                "error": "{}: {}".format(type(exc).__name__, str(exc)[:250]),
            })
    signals = []
    for check in target["checks"]:
        source = files.get(check["file"])
        if source is None:
            signals.append({"meaning": check["meaning"], "result": "unknown_no_source",
                            "file": check["file"]})
            continue
        needle = check["needle"]
        idx = source.find(needle)
        if idx >= 0:
            line = source.count("\n", 0, idx) + 1
            signals.append({"meaning": check["meaning"], "result": "source_anchor_found",
                            "file": check["file"], "line": line,
                            "excerpt": source.splitlines()[line - 1][:240]})
        else:
            signals.append({"meaning": check["meaning"], "result": "source_anchor_absent",
                            "file": check["file"]})
    behavior = {"status": "not_run", "reason": "read-only static research only"}
    if target["id"] == "03" and "src/lfx/src/lfx/base/data/utils.py" in files:
        behavior = isolated_langflow_probe(files["src/lfx/src/lfx/base/data/utils.py"])
    elif target["id"] == "04" and "server/models/systemPromptVariables.js" in files:
        behavior = isolated_anythingllm_probe(files["server/models/systemPromptVariables.js"])

    found = sum(s["result"] == "source_anchor_found" for s in signals)
    state = ("static_anchors_found" if found == len(signals) else
             "static_partial" if found else "no_matching_static_anchors")
    return {
        "experiment": "ARGUS-10",
        "time_utc": datetime.now(timezone.utc).isoformat(),
        "id": target["id"], "name": target["name"], "repo": target["repo"],
        "pinned_commit": target["commit"],
        "issue_report": "https://github.com/{}/issues/{}".format(target["repo"], target["issue"]),
        "selected_tool": target["tool"], "proposed_treatment": target["treatment"],
        "inspection_state": state, "fetched_sources": receipts, "source_signals": signals,
        "isolated_behavioral_probe": behavior,
        "finding_certification": "NOT a confirmed upstream bug or proven fix",
        "target_modified": False,
    }

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--id", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    target = load_target(args.id)
    result = run(target)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"target": target["name"], "state": result["inspection_state"],
                      "behavior": result["isolated_behavioral_probe"]["status"],
                      "signals": len(result["source_signals"])}))
    return 0 if all(r["state"] == "fetched" for r in result["fetched_sources"]) else 2

if __name__ == "__main__":
    sys.exit(main())
