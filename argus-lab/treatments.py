#!/usr/bin/env python3
"""Read-only upstream candidate treatments; edits and tests happen only in memory."""
import difflib
import json
import re
from pathlib import Path
from probe import fetch_source, isolated_anythingllm_probe, isolated_langflow_probe

OUT = Path("argus-lab-treatment")
OUT.mkdir(exist_ok=True)

def langflow_fix(src):
    old = ('    if detected_encoding in {"Windows-1252", "Windows-1254", "MacRoman"}:\n'
           '        detected_encoding = "utf-8"\n')
    new = ('    # Keep detected legacy encoding as a fallback after UTF-8.\n'
           '    legacy_detected = detected_encoding if detected_encoding in '
           '{"Windows-1252", "Windows-1254", "MacRoman"} else None\n'
           '    if legacy_detected:\n'
           '        detected_encoding = "utf-8"\n')
    if src.count(old) != 1:
        raise AssertionError("Langflow encoding signature changed")
    src = src.replace(old, new, 1)
    old = '    for fallback in ("utf-8", "gb18030"):\n        if fallback not in encodings:'
    new = '    for fallback in ("utf-8", legacy_detected, "gb18030"):\n        if fallback and fallback not in encodings:'
    if src.count(old) != 1:
        raise AssertionError("Langflow fallback signature changed")
    return src.replace(old, new, 1)

def anything_fix(src):
    start = src.index("  expandSystemPromptVariables:")
    end = src.index("\n  /**\n   * Internal function", start)
    method = src[start:end]
    old = '      const matches = str.match(/\\{([^}]+)\\}/g) || [];\n'
    new = (old +
           '      // Protect original positions before inserting variable values.\n'
           '      const markers = matches.map((_, i) => "__ARGUS_SLOT_" + i + "__");\n'
           '      let markerIndex = 0;\n'
           '      result = result.replace(/\\{([^}]+)\\}/g, () => markers[markerIndex++]);\n')
    if method.count(old) != 1:
        raise AssertionError("AnythingLLM matcher signature changed")
    method = method.replace(old, new, 1)
    loop = '      for (const match of matches) {\n'
    if method.count(loop) != 1:
        raise AssertionError("AnythingLLM loop signature changed")
    method = method.replace(loop,
        '      for (let i = 0; i < matches.length; i++) {\n'
        '        const match = matches[i];\n'
        '        const marker = markers[i];\n', 1)
    method, count = re.subn(r"result\.replace\(\s*match\s*,", "result.replace(marker,", method)
    if count != 7:
        raise AssertionError("Unexpected replacement count " + str(count))
    old = '      return result;\n'
    new = (
        '      // Restore unknown original placeholders, without recursing into values.\n'
        '      for (let i = 0; i < markers.length; i++) {\n'
        '        result = result.replace(markers[i], () => matches[i]);\n'
        '      }\n'
        '      return result;\n'
    )
    if method.count(old) != 1:
        raise AssertionError("AnythingLLM return signature changed")
    method = method.replace(old, new, 1)
    return src[:start] + method + src[end:]

def run_case(name, repo, commit, path, fix, tester):
    before_src, receipt = fetch_source(repo, commit, path)
    after_src = fix(before_src)
    before = tester(before_src)
    after = tester(after_src)
    diff = "".join(difflib.unified_diff(
        before_src.splitlines(True), after_src.splitlines(True),
        fromfile="a/" + path, tofile="b/" + path
    ))
    (OUT / (name + ".patch")).write_text(diff, encoding="utf-8")
    state = {
        "name": name, "repo": repo, "source": receipt["source_url"],
        "before": before, "after": after,
        "candidate_passes_isolated_fixture": (
            before.get("mismatch_reproduced") is True and
            after.get("mismatch_reproduced") is False
        ),
        "upstream_changed": False,
        "claim_boundary": "Not production tested or certified for full application."
    }
    (OUT / (name + ".json")).write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return state

def main():
    cases = [
        run_case("langflow-encoding", "langflow-ai/langflow",
                 "504c02fc47e76087b82b0e7cbe4186e9cdd916d4",
                 "src/lfx/src/lfx/base/data/utils.py",
                 langflow_fix, isolated_langflow_probe),
        run_case("anythingllm-placeholders", "Mintplex-Labs/anything-llm",
                 "2a10d052a1812d7be12c43f9024072cf26a27a8b",
                 "server/models/systemPromptVariables.js",
                 anything_fix, isolated_anythingllm_probe)
    ]
    report = {
        "experiment": "ARGUS-10 isolated treatments",
        "candidate_pass_count": sum(i["candidate_passes_isolated_fixture"] for i in cases),
        "tested": len(cases),
        "source_repos_written": 0,
        "cases": cases
    }
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"candidate_pass_count": report["candidate_pass_count"], "tested": len(cases)}))
    if report["candidate_pass_count"] != len(cases):
        raise SystemExit("An isolated treatment failed; do not claim a fixed application.")

if __name__ == "__main__":
    main()
