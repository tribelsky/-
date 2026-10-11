#!/usr/bin/env python3
"""Combine ten ARGUS research receipts into one inspectable evidence summary."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

folder = Path(sys.argv[1] if len(sys.argv) > 1 else "reports")
paths = sorted(folder.glob("*.json"))
data = []
for path in paths:
    try:
        row = json.loads(path.read_text(encoding="utf-8"))
        if row.get("experiment") == "ARGUS-10":
            data.append(row)
    except (OSError, ValueError):
        pass
data.sort(key=lambda x: x["id"])
stats = {
    "expected": 10,
    "received": len(data),
    "source_anchors_found": sum(
        s["result"] == "source_anchor_found"
        for r in data for s in r["source_signals"]
    ),
    "isolated_behavioral_mismatches": sum(
        r["isolated_behavioral_probe"].get("mismatch_reproduced", False)
        for r in data
    ),
    "confirmed_end_to_end_upstream_bugs": 0,
    "upstream_repositories_modified": 0,
}
payload = {
    "experiment": "ARGUS-10",
    "aggregated_utc": datetime.now(timezone.utc).isoformat(),
    "stats": stats,
    "disclaimer": "Static signatures and isolated helper tests do not establish that the reported bug remains reproducible end-to-end.",
    "targets": data,
}
Path("ARGUS-10-report.json").write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
lines = [
    "# ARGUS-10: read-only ten-repository diagnostics",
    "",
    "## Evidence counts",
    f"- Received: {stats['received']}/10 individual reports",
    f"- Source anchors found: {stats['source_anchors_found']}",
    f"- Isolated behavioral mismatches: {stats['isolated_behavioral_mismatches']}",
    "- Fully reproduced product bugs: **0** (not claimed)",
    "- Upstream changes: **0**",
    "",
    "## Per-repository findings",
    "",
    "| App | Source status | Isolated test | Original issue |",
    "|---|---|---|---|",
]
for r in data:
    behavior = r["isolated_behavioral_probe"]
    note = behavior["status"]
    if behavior.get("mismatch_reproduced"):
        note += " (mismatch)"
    lines.append(f"| {r['name']} | {r['inspection_state']} | {note} | [issue]({r['issue_report']}) |")
lines += [
    "",
    "## Next gate",
    "To certify a bug and propose a patch, reproduce behavior in an isolated checkout with real runtime tests, show a failing test before a change and a passing test after it, then review the patch with repository maintainers.",
    "",
    "These runs contain only read-only source requests to pinned public commits; no builds of third-party projects, writes to their repos, or contact with running services.",
]
Path("ARGUS-10-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(json.dumps(stats, ensure_ascii=False))
