"""Tagformix Rescue Squad: automatically select bounded rescue Skills from signed
Olga lab fault alerts. This runs entirely in an owned CI sandbox.

This is a *policy checked simulation of dispatch*, not a remote dispatcher,
not a deployed agent, and not an actual customer authorization gateway.
"""
from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "aluma-tag"))
from aluma_tag import AlumaTag, SignalRejected, authenticated, verify_message
from care_seal import CareSealMonitor, BeamDesk, issue_care_seal

KEY = bytes.fromhex("31" * 32)      # Test key only, NEVER production
ISSUER = bytes.fromhex("42" * 32)   # Test key only, NEVER production
NOW = 1781000000
TAG_ID = "olga-lab-20261012"

def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()

def approved_lab_lease():
    return {
        "owner_opt_in": True,
        "allowed_tag_id": TAG_ID,
        "scope": "ISOLATED_LOCAL_CANDIDATE_ONLY",
        "allow_read_only_diagnosis": True,
        "allow_sandbox_candidate": True,
        "allow_live_write": False,
        "allowed_areas": ["workflow", "runtime", "data"],
        "max_skills": 3,
        "max_changed_functions": 1,
        "max_attempts_per_incident": 1,
        "expires_at": NOW + 1800,
    }

def choose_skills(triage: dict, lease: dict, registry: dict) -> dict:
    """The action lease gates *all* automatic work after authenticated triage."""
    incident = {"tag": triage["app"], "areas": triage["areas"],
                "decision": triage["decision"]}
    if not lease.get("owner_opt_in") or lease.get("allowed_tag_id") != TAG_ID:
        return {**incident, "status": "DENIED_NO_CONSENT", "skills": []}
    if type(lease.get("expires_at")) is not int or lease["expires_at"] < NOW:
        return {**incident, "status": "DENIED_LEASE_EXPIRED", "skills": []}
    if lease.get("allow_live_write") or lease.get("scope") != \
            "ISOLATED_LOCAL_CANDIDATE_ONLY":
        return {**incident, "status": "DENIED_UNSAFE_SCOPE", "skills": []}
    if not lease.get("allow_read_only_diagnosis"):
        return {**incident, "status": "DENIED_NO_DIAG_AUTHORITY", "skills": []}
    if type(lease.get("max_skills")) is not int or lease["max_skills"] < 2:
        return {**incident, "status": "DENIED_RESOURCE_BUDGET", "skills": []}
    if (type(lease.get("max_changed_functions")) is not int or
        lease["max_changed_functions"] != 1 or
        type(lease.get("max_attempts_per_incident")) is not int or
        lease["max_attempts_per_incident"] != 1):
        return {**incident, "status": "DENIED_RESOURCE_BUDGET", "skills": []}

    if triage["decision"] not in ("request_authorized_diagnosis",
                               "review_change_and_run_prevention_tests"):
        return {**incident, "status": "NEED_FRESH_HEALTH", "skills": []}
    if len(triage["areas"]) != 1:
        return {**incident, "status": "NEED_FOCUSED_DIAGNOSIS", "skills": []}
    area = triage["areas"][0]
    if area not in registry["domain_traits"] or area not in lease["allowed_areas"]:
        return {**incident, "status": "NEED_FOCUSED_DIAGNOSIS", "skills": []}

    traits = registry["domain_traits"][area]
    scout = {
        "role": "scout", "id": registry["roles"]["scout"]["skill_id"],
        "traits": [*registry["roles"]["scout"]["fixed_traits"], traits["trait_id"]],
        "authority": "READ_ONLY",
    }
    verifier = {
        "role": "verifier", "id": registry["roles"]["verifier"]["skill_id"],
        "traits": list(registry["roles"]["verifier"]["fixed_traits"]),
        "authority": "VERIFY_ONLY",
    }
    should_build = (triage["decision"] == "request_authorized_diagnosis"
                    and lease.get("allow_sandbox_candidate") is True
                    and lease["max_skills"] >= 3)
    skills = [scout]
    if should_build:
        skills.append({
            "role": "builder", "id": registry["roles"]["builder"]["skill_id"],
            "traits": list(registry["roles"]["builder"]["fixed_traits"]),
            "authority": "SANDBOX_WRITE_ONLY",
        })
    skills.append(verifier)
    return {
        **incident, "status": "CANDIDATE_ALLOWED" if should_build else "DIAG_ONLY",
        "traits_from_reservoir": [traits["trait_id"]],
        "target_function": traits["function"],
        "target_check": traits["check"],
        "target_fault_type": traits["fault_type"],
        "skills": skills,
        "max_changed_functions": lease["max_changed_functions"],
        "max_attempts_per_incident": lease["max_attempts_per_incident"],
        "deployment_authorized": False,
        "remote_skills_transmitted": False,
    }

def make_test_seal(report: dict):
    baseline = {r["area"]: sha(r["check"] + ":pass:" + report["source_sha256"])
                for r in report["baseline"]}
    evidence = {
        "approved": True, "revision": report["source_commit"],
        "passed_checks": 3, "failed_checks": 0,
        "digest": sha(json.dumps(report["baseline"], sort_keys=True)),
    }
    seal = issue_care_seal(
        tag_id=TAG_ID,
        repair_id="LAB-ONLY-NO-REPAIR-20261012",
        seal_id="LAB-CHECKPOINT-20261012",
        revision=report["source_commit"], evidence=evidence,
        fingerprints=baseline, issued_at=NOW, issuer_secret=ISSUER
    )
    return seal, baseline

def send_bounded_lab_alert(monitor, baseline, original, index):
    """Act as existing owner-approved CI event hook, without a network send."""
    failed = [x for x in original["fault_execution"] if not x["passed"]]
    assert len(failed) == 1
    area = failed[0]["area"]
    fingerprints = dict(baseline)
    fingerprints[area] = sha(failed[0]["check"] + ":failed")
    checks = {x["area"]: x["passed"] for x in original["fault_execution"]}
    current = {
        "revision": "6177a9144e4b6c8035e0224b90810e2241f6966d",
        "fingerprints": fingerprints,
        "checks": checks,
        "PRIVATE_USER_DATA": "NEVER_EXPORTED",
        "API_KEY": "NEVER_EXPORTED",
    }
    return monitor.event(current, event_id=f"local-rescue-incident-{index:03d}", at=NOW)

def main():
    registry = json.loads((HERE / "rescue-traits.json").read_text("utf8"))
    report = json.loads((HERE / "out/OLGA-REAL-SOURCE-RESULT.json").read_text("utf8"))
    assert report["source_commit"] == registry["limits"]["base_commit"]
    assert report["source_blob_sha1"] == registry["limits"]["base_blob"]
    assert report["baseline_passed"] == 3
    assert report["category_correct"] == 3
    assert report["no_production_app_changes"] is True
    assert len(report["isolated_faults"]) == 3

    seal, baseline = make_test_seal(report)
    tag = AlumaTag(TAG_ID, KEY, enabled=True)
    monitor = CareSealMonitor(tag, seal, ISSUER, report_fault_area=True)
    desk = BeamDesk({TAG_ID: KEY}, {TAG_ID: seal["seal_id"]})
    health = {"revision": report["source_commit"],
              "fingerprints": baseline,
              "checks": {area: True for area in baseline}}
    assert monitor.event(health, event_id="healthy-no-incident-000", at=NOW) is None
    plans = []
    for i, incident in enumerate(report["isolated_faults"], 1):
        alert = send_bounded_lab_alert(monitor, baseline, incident, i)
        assert alert and verify_message(KEY, alert)
        assert "NEVER_EXPORTED" not in json.dumps(alert)
        triage = desk.receive(alert, now=NOW)
        chosen = choose_skills(triage, approved_lab_lease(), registry)
        assert chosen["status"] == "CANDIDATE_ALLOWED"
        assert chosen["target_function"] == incident["injected_function"]
        assert len(chosen["skills"]) == 3
        assert chosen["target_fault_type"] == incident["diagnosed_fault_type"]
        plans.append(chosen)
        # Authenticated replay must fail before any new dispatch.
        try:
            desk.receive(alert, now=NOW)
        except SignalRejected:
            pass
        else:
            raise AssertionError("Same event was dispatched twice")

    # Control 1: customer opted out, zero dispatch
    no_consent = approved_lab_lease()
    no_consent["owner_opt_in"] = False
    assert choose_skills(triage, no_consent, registry)["status"] == \
           "DENIED_NO_CONSENT"

    # Control 2: details hidden on the Tagformix marker, no guessing.
    private_monitor = CareSealMonitor(tag, seal, ISSUER, report_fault_area=False)
    latest = report["isolated_faults"][0]
    new_area = latest["diagnosed_area"]
    bad = {"revision": report["source_commit"],
           "fingerprints": dict(baseline), "checks": {k: True for k in baseline}}
    bad["checks"][new_area] = False
    private_alert = private_monitor.event(bad,
                      event_id="hidden-type-incident-001", at=NOW)
    assert private_alert["areas"] == []
    private_triage = desk.receive(private_alert, now=NOW)
    assert choose_skills(private_triage, approved_lab_lease(), registry)["status"] == \
           "NEED_FOCUSED_DIAGNOSIS"

    # Control 3: limited authorization picks only 2 diagnostic/verification skills.
    no_build = approved_lab_lease()
    no_build["allow_sandbox_candidate"] = False
    duo = choose_skills(triage, no_build, registry)
    assert duo["status"] == "DIAG_ONLY"
    assert [s["role"] for s in duo["skills"]] == ["scout", "verifier"]

    # Control 4: deny broad write permission even if an incident is signed.
    too_broad = approved_lab_lease()
    too_broad["allow_live_write"] = True
    assert choose_skills(triage, too_broad, registry)["status"] == \
           "DENIED_UNSAFE_SCOPE"

    # Control 5: no budget, no rescue.
    broke_budget = approved_lab_lease()
    broke_budget["max_skills"] = 1
    assert choose_skills(triage, broke_budget, registry)["status"] == \
           "DENIED_RESOURCE_BUDGET"

    # Control 6: expired consent is denied.
    expired = approved_lab_lease()
    expired["expires_at"] = NOW - 1
    assert choose_skills(triage, expired, registry)["status"] == \
           "DENIED_LEASE_EXPIRED"

    # Control 7: forged signal rejected by the existing Beam receiver.
    forged = send_bounded_lab_alert(monitor, baseline, latest, 9)
    forged["mac"] = "0" * 64
    try:
        desk.receive(forged, now=NOW)
    except SignalRejected:
        pass
    else:
        raise AssertionError("Forged alert accepted")

    # Controls 8-9: stale alert and revoked seal fail independently.
    stale = send_bounded_lab_alert(monitor, baseline, latest, 10)
    try:
        desk.receive(stale, now=NOW + 400)
    except SignalRejected:
        pass
    else:
        raise AssertionError("Stale alert accepted")
    revoked = send_bounded_lab_alert(monitor, baseline, latest, 11)
    desk.active_seals[TAG_ID] = "revoked"
    try:
        desk.receive(revoked, now=NOW)
    except SignalRejected:
        pass
    else:
        raise AssertionError("Revoked seal accepted")

    out = {
        "experiment": registry["experiment"],
        "status": "LOCAL_AUTOMATED_DISPATCH_PROVEN",
        "dispatch_cause": "new authenticated owner-opted-in lab fault signal",
        "app": TAG_ID, "scope": "ISOLATED_LOCAL_CANDIDATE_ONLY",
        "source_commit": report["source_commit"],
        "rescue_plans": plans,
        "two_skill_no_build_path_passed": True,
        "hidden_fault_type_no_guessing": True,
        "negative_controls_passed": [
            "no_consent", "hidden_fault_type", "no_build_authority",
            "forbidden_live_write", "resource_budget", "expired_lease",
            "forged_signal", "stale_signal", "revoked_seal",
            "replay_rejected",
        ],
        "external_skills_transmitted": 0,
        "live_olga_modified": False,
        "third_party_repositories_modified": False,
        "root_causes_independently_discovered": False,
        "new_algorithms_invented": False,
        "real_network_listener": False,
        "real_production_lease": False,
        "next": "Execute candidate construction and held-out regression in CI only"
    }
    outfile = HERE / "out/RESCUE-AUTHORIZED-DISPATCH.json"
    outfile.write_text(json.dumps(out, indent=2, ensure_ascii=False)+"\n","utf8")
    print(json.dumps({"status": out["status"], "incidents":len(plans),
          "skills_per_incident":[len(p["skills"]) for p in plans],
          "areas":[p["areas"][0] for p in plans],
          "negative_controls":len(out["negative_controls_passed"]),
          "production_writes":0}))

if __name__ == "__main__":
    main()
