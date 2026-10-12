#!/usr/bin/env python3
"""ARGUS preventive Skill Foundry, wave 01.

Read-only on ten pinned external repositories. The output is a *candidate*
SKILL.md package and bounded inspection evidence, never a deployed patch.
No untrusted full repository build, credentials, customer files or writes to
external repositories. Limited previously-reviewed upstream helpers can run
inside CI with mocked dependencies.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "argus-lab"))
from probe import fetch_source, isolated_langflow_probe, isolated_anythingllm_probe  # noqa: E402

CATALOG = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
TARGETS = {
    item["id"]: item
    for item in json.loads((ROOT.parent / "argus-lab" / "targets.json").read_text(encoding="utf-8"))["targets"]
}
CAT_CASES = {item["id"]: item for item in CATALOG["cases"]}

def issue_link(case):
    return f'https://github.com/{case["repo"]}/issues/{case["issue"]}'

def skill_content(case, target, result):
    warnings = "\n".join("- " + x for x in case["earlySigns"])
    return f'''---
name: {case["slug"]}
description: {case["purpose"]}
---

# {case["name"]} | Preventive skill candidate

## Origin and evidence boundary

- Upstream repository: https://github.com/{case["repo"]}
- Git revision inspected: {target["commit"]}
- Original reported issue: {issue_link(case)}
- Source file: {case["primaryFile"]}
- Wave: ARGUS-PREVENTIVE-WAVE-01, 2026-10-12
- Evidence class: {result["classification"]}
- This skill is original guidance synthesized from public repository evidence.
  It is not installed in {case["name"]} and no future outage has been predicted.

## User-value mission

{case["purpose"]}

## Possible early warning signs

{warnings}

### Code 1 | Guardian / Diagnose

{case["preflight"]}

- Inspect the file at its actual current revision; do not blindly assume the
  pinned code still describes the latest release.
- Check the original issue status, relevant version, and available test suite.
- If there is no independent reproduction, report RISK SIGNAL only.
- Preserve original code; use a versioned, isolated test copy.

### Code 2 | Builder / Preventive capability

{case["prevention"]}

- Prefer creating a targeted regression test or small adapter over deploying
  an unverified fix. Keep code, data, secrets and privileges scoped.
- Never auto-install, patch, or push to the owner's upstream repo.

### Code 3 | Verify / Explain / Guard

Acceptance contract:
{case["acceptance"]}

Host-native integration gate:
{case["integration"]}

- Record versions, before/after assertions, positive + negative controls and
  false positives. Distinguish a future risk from a present reproduced defect.
- Reassess after upstream changes, using a fresh authorization and source pin.
- Give an operator the decision to approve any real application change.

## Mandatory safety stop

No third-party writes, production rollout, external traffic, credential access
or silent background watcher. No statement that the issue is fixed unless
the app's real integration tests pass. The selected skill is a testable plan,
not an independently running product integration.
'''

def behavior_khoj(source):
    """Run reviewed upstream helper with synthetic conversation rows, no imports."""
    parsed = ast.parse(source)
    funcs = [node for node in parsed.body
             if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
             and node.name == "construct_chat_history_for_operator"]
    if len(funcs) != 1:
        return {"status": "not_run", "reason": "helper not found"}
    fn = funcs[0]
    if not isinstance(fn, ast.FunctionDef):
        return {"status": "not_run", "reason": "unexpected async helper"}
    # Enforce an inspected function signature and allowed attributes.
    body = ast.get_source_segment(source, fn)
    if not body or "for chat in conversation_history:" not in body or "chat_history" not in body:
        return {"status": "not_run", "reason": "helper changed; review needed"}
    class AgentMessage:
        def __init__(self, role, content):
            self.role, self.content = role, content
    ns = {"AgentMessage": AgentMessage}
    module = ast.Module(body=[ast.ImportFrom(module="__future__",
                                             names=[ast.alias(name="annotations")],
                                             level=0), fn], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), "<reviewed-khoj-function>", "exec"), ns)
    turns = []
    for i in range(1, 4):
        turns.extend([SimpleNamespace(by="you", message=f"USER-{i}", queryFiles=[]),
                      SimpleNamespace(by="khoj", message=f"ASSISTANT-{i}", queryFiles=[])])
    actual = ns[fn.name](turns, n=2)
    actual_users = [str(m.content[0]["text"]) for m in actual if m and m.role == "user"]
    actual_assistants = [str(m.content) for m in actual if m and m.role == "assistant"]
    # Docstring specifies 'last n completed turns', hence last two pairs expected.
    expected_users = ["USER-2", "USER-3"]
    expected_assistants = ["ASSISTANT-2", "ASSISTANT-3"]
    return {
        "status": "isolated_upstream_function_executed",
        "input_completed_turns": 3, "requested_completed_turns": 2,
        "actual_user_turns": actual_users, "actual_assistant_turns": actual_assistants,
        "expected_user_turns": expected_users,
        "expected_assistant_turns": expected_assistants,
        "mismatch_reproduced": actual_users != expected_users or actual_assistants != expected_assistants,
        "scope": "Single upstream helper; chronological mocked records; not full operator",
    }

def inspect_target(id_, evidence_dir, generated_dir):
    if id_ not in CAT_CASES or id_ not in TARGETS:
        raise KeyError("Target not configured: " + id_)
    case, target = CAT_CASES[id_], TARGETS[id_]
    assert case["repo"] == target["repo"]
    assert case["issue"] == int(target["issue"])
    read_list = [case["primaryFile"]]
    if id_ == "05":
        read_list += ["internal/agent/templates/title_chunker.json",
                      "internal/ingestion/pipeline/pipeline_params.go"]
    elif id_ == "06":
        read_list += []
    seen = {}
    metadata = []
    for path in read_list:
        try:
            body, receipt = fetch_source(case["repo"], target["commit"], path)
            seen[path] = body
            metadata.append({"state": "fetched", **receipt})
        except Exception as exc:
            metadata.append({"state": "unavailable", "path": path,
                             "reason": str(exc)[:250]})
    src = seen.get(case["primaryFile"], "")
    anchor = case["positive"]
    found = bool(src and anchor in src)
    signature_control = {
        "anchor_found": found,
        "positive_control": found and anchor in (src + "\n# harmless comment\n"),
        "negative_control": found and anchor not in src.replace(anchor, "__REMOVED_ANCHOR__", 1),
        "note": "Signature controls only: do not certify a bug from these.",
    }
    behavior = {"status": "not_run", "reason": "needs host-native integration fixture"}
    extra = {}
    if id_ == "03" and src:
        behavior = isolated_langflow_probe(src)
    if id_ == "04" and src:
        behavior = isolated_anythingllm_probe(src)
    if id_ == "07" and src:
        behavior = behavior_khoj(src)
    if id_ == "05" and all(x in seen for x in read_list):
        templates = {}
        for path in read_list[:2]:
            data = json.loads(seen[path])
            comps = data.get("dsl", {}).get("components", {})
            extractors = [node.get("obj", {}).get("params", {})
                          for node in comps.values()
                          if node.get("obj", {}).get("component_name") == "Extractor"]
            templates[Path(path).name] = {
                "extractors": len(extractors),
                "legacy_fields": sorted(set().union(*(set(x).intersection(
                    {"field_name", "prompts", "sys_prompt", "tenant_llm_id"})
                    for x in extractors))) if extractors else [],
            }
        go = seen[read_list[2]]
        extra = {"templates": templates,
                 "go_legacy_drop_rule_present": "dropping legacy flat field" in go,
                 "go_unknown_drop_rule_present": "dropping unknown param" in go}
    if id_ == "06" and src:
        extra = {"raw_json_parse_seen": "jsonParse(data" in src,
                 "followup_string_json_parse_seen": "JSON.parse(returnItem.body)" in src,
                 "note": "Structural double-parse exposure, not behavioral proof"}
    if id_ == "01" and src:
        extra = {"react_key_name_only": "key={plugin.name}" in src}
    if id_ == "08" and src:
        extra = {"pinned_version_contains_unconditional_randomuuid":
                 "crypto.randomUUID()" in src,
                 "upstream_issue_reported_closed": True}

    if behavior.get("mismatch_reproduced") is True:
        classification = "ISOLATED_BEHAVIORAL_MISMATCH"
    elif case["kind"] == "upstream_fix_reported":
        classification = "HISTORICAL_SOURCE_RISK_AND_MAINTAINER_FIX_REPORTED"
    elif case["kind"] == "source_risk" and found:
        classification = "STATIC_EARLY_WARNING_CANDIDATE"
    else:
        classification = "REQUIRES_HOST_NATIVE_INTEGRATION"
    result = {
        "experiment": CATALOG["experiment"], "id": id_, "app": case["name"],
        "repo": case["repo"], "issue": issue_link(case),
        "pinned_commit": target["commit"],
        "source_receipts": metadata, "signature": signature_control,
        "isolation_test": behavior, "extra_findings": extra,
        "classification": classification,
        "future_crisis_predicted": False, "production_issue_fixed": False,
        "upstream_repo_modified": False, "skill_installed_in_upstream_app": False,
        "action": case["prevention"], "next_acceptance_gate": case["integration"],
    }
    evidence_dir.mkdir(parents=True, exist_ok=True)
    generated = generated_dir / case["slug"]
    generated.mkdir(parents=True, exist_ok=True)
    skill_path = generated / "SKILL.md"
    skill_path.write_text(skill_content(case, target, result), encoding="utf-8")
    result["generated_skill_path"] = str(skill_path)
    result["skill_sha256"] = hashlib.sha256(skill_path.read_bytes()).hexdigest()
    (evidence_dir / (id_ + ".json")).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"id": id_, "app": case["name"], "classification": classification,
                      "sources": len(seen), "signature": found,
                      "behavior": behavior["status"],
                      "mismatch": behavior.get("mismatch_reproduced"),
                      "skill": case["slug"]}, ensure_ascii=False))
    return 0 if seen and found else 2

def aggregate(evidence_dir, out_dir):
    rows = []
    for fp in sorted(evidence_dir.glob("*.json")):
        obj = json.loads(fp.read_text(encoding="utf-8"))
        if obj.get("experiment") == CATALOG["experiment"]:
            rows.append(obj)
    ids = [x["id"] for x in rows]
    assert len(ids) == 10 and set(ids) == set(CAT_CASES), "Ten distinct cases required"
    assert all(x["signature"]["anchor_found"] and x["signature"]["negative_control"]
               and x["signature"]["positive_control"] for x in rows)
    assert all(x["skill_sha256"] for x in rows)
    counts = Counter(x["classification"] for x in rows)
    summary = {
        "experiment": CATALOG["experiment"],
        "cases_scanned": len(rows), "skills_generated": len(rows),
        "isolated_function_mismatches": sum(x["isolation_test"].get("mismatch_reproduced") is True
                                            for x in rows),
        "verified_future_outages_prevented": 0,
        "full_upstream_integration_tests": 0,
        "upstream_repositories_modified": 0,
        "counts": dict(counts),
        "disclaimer": "Early warnings and generated SKILL.md files are NOT upstream installations or verified future fixes.",
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "SUMMARY.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# ARGUS Preventive Wave 01 — Candidate Skills, not deployed repairs", "",
        "## Evidence summary", "",
        f"- Inspected applications: {len(rows)}/10",
        f"- Host-targeted preventive SKILL.md candidates created: {len(rows)}/10",
        f"- Isolated upstream helper behavioral mismatches: {summary['isolated_function_mismatches']}",
        "- Full product integration tests: 0",
        "- Confirmed future outages prevented: 0",
        "- External repository writes: 0", "",
        "| App | Level | Target preventive Skill |",
        "|---|---|---|"
    ]
    for row in sorted(rows, key=lambda x: x["id"]):
        lines.append(f"| {row['app']} | {row['classification']} | {CAT_CASES[row['id']]['slug']} |")
    lines += [
        "", "## Next stage",
        "For the first two repair candidates (Langflow and AnythingLLM), run complete",
        "project tests around proposed diffs. For Khoj, confirm the isolated window",
        "reproduction using upstream pytest. For other apps, build host-native fixtures",
        "to test the hypothesized prevention rather than predicting a future fault.",
        "", "Prevention means a regression guard blocks a bad change before release.",
        "It is not evidence of discovering an unknowable future event."
    ]
    (out_dir / "SUMMARY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--id")
    p.add_argument("--evidence-dir", default="preventive/out/evidence")
    p.add_argument("--skill-dir", default="preventive/out/skills")
    p.add_argument("--aggregate", action="store_true")
    p.add_argument("--out-dir", default="preventive/out")
    args = p.parse_args()
    if args.aggregate:
        aggregate(Path(args.evidence_dir), Path(args.out_dir))
        return
    if not args.id:
        p.error("--id is required unless --aggregate")
    sys.exit(inspect_target(args.id, Path(args.evidence_dir), Path(args.skill_dir)))

if __name__ == "__main__":
    main()
