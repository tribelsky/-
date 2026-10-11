#!/usr/bin/env python3
"""Cross-App Metamorphosis v0.1: validate two adaptations of one new skill.

This validates capability lineage, a shared contract and both selected adapter
plans. It does not load either application, use paid models or modify projects.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
MANIFEST = ROOT / "lineage.json"
SKILL = REPO / ".agents/skills/cross-app-contract-builder-verifier/SKILL.md"
OUTPUT = ROOT / "out"

COMMON = [
    "observe_contract_and_current_behavior",
    "define_typed_input_output_and_authorization_invariants",
    "design_smallest_native_integration_change",
    "construct_negative_and_compatibility_tests",
    "collect_reproducible_before_after_evidence",
    "preserve_auditable_lineage_and_scope",
]
HOSTS = {
    "OpenHands": [
        "check_frontend_client_and_server_ownership",
        "verify_auth_persistence_and_local_cloud_compatibility",
        "choose_real_project_api_state_tests"
    ],
    "Activepieces": [
        "inspect_existing_piece_auth_and_actions",
        "plan_action_trigger_registration_and_version_bump",
        "choose_real_project_build_lint_integration_tests"
    ]
}
ORIGINS = {
    "OpenHands": ["typed_api_contracts", "authentication_invariants"],
    "Activepieces": ["action_trigger_design", "auth_mapping"],
}

def evaluate(host, lineage):
    parents = {p["platform"]: p for p in lineage["parent_skills"]}
    if host not in HOSTS or host not in parents:
        raise ValueError("Unsupported target platform")
    if len(set(lineage["offspring"]["adapter_targets"])) != 2:
        raise AssertionError("Both target adapters required")
    for origin, required_traits in ORIGINS.items():
        if not set(required_traits).issubset(set(parents[origin]["traits"])):
            raise AssertionError("Trait mapping missing for parent " + origin)
    # The two-origin contribution is required for BOTH output adapters.
    return {
        "experiment": lineage["experiment"],
        "host": host,
        "skill": lineage["offspring"]["name"],
        "example_task": "Add or validate an authorized read-only status operation",
        "shared_workflow": COMMON,
        "native_adapter": HOSTS[host],
        "lineage_used": {key: {"repo": parents[key]["repo"],
                              "skill_id": parents[key]["id"],
                              "traits": ORIGINS[key]} for key in sorted(ORIGINS)},
        "scope": "NO_REPOSITORY_WRITES",
        "status": "adapter_plan_validated_only",
        "executed_in_real_application": False,
        "has_confirmed_cross_app_execution": False,
    }

def main():
    lineage = json.loads(MANIFEST.read_text(encoding="utf-8"))
    skill = SKILL.read_text(encoding="utf-8")
    assert skill.startswith("---\nname: cross-app-contract-builder-verifier\n"), "Invalid SKILL.md"
    assert "Host adapter A: OpenHands" in skill
    assert "Host adapter B: Activepieces" in skill
    assert lineage["offspring"]["external_write_authorized"] is False
    all_plans = [evaluate(host, lineage) for host in ["OpenHands", "Activepieces"]]
    assert all(x["shared_workflow"] == COMMON for x in all_plans)
    assert all(len(x["lineage_used"]) == 2 for x in all_plans)
    assert all(x["executed_in_real_application"] is False for x in all_plans)
    assert all_plans[0]["native_adapter"] != all_plans[1]["native_adapter"]
    try:
        evaluate("UnrelatedHost", lineage)
    except ValueError:
        pass
    else:
        raise AssertionError("Unknown platform silently accepted")
    OUTPUT.mkdir(exist_ok=True)
    for result in all_plans:
        (OUTPUT / (result["host"].lower() + "-plan.json")).write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {
        "experiment": lineage["experiment"],
        "read_only_plan_checks": "PASS",
        "common_workflow_adapters": 2,
        "parent_skills_verified_in_manifest": 2,
        "real_app_integration_tests": 0,
        "claim": "Structure and routing prototype only, NOT a running skill in both apps",
    }
    (OUTPUT / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary))

if __name__ == "__main__":
    main()
