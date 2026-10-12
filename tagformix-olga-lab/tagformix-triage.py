"""TAGFORMIX pilot: seal a small verified Olga test baseline and triage actual-source
in-memory faults. NO claim that a real Olga repair or live installation occurred.
"""
from __future__ import annotations
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "aluma-tag"))
from aluma_tag import AlumaTag, verify_message
from care_seal import CareSealMonitor, BeamDesk, issue_care_seal, verify_care_seal

RESULT = HERE / "out" / "OLGA-REAL-SOURCE-RESULT.json"
report = json.loads(RESULT.read_text(encoding="utf-8"))
assert report["baseline_passed"] == 3
assert report["category_correct"] == 3
assert report["source_blob_sha1"] == "e9874ebc58be579ce50aae89fa566b0dba1b6384"
assert {x["area"] for x in report["baseline"]} == {"workflow", "runtime", "data"}
assert all(x["passed"] for x in report["baseline"])

# These are short-lived test fixtures, never deployable secrets.
app_key = bytes.fromhex("31" * 32)
issuer_key = bytes.fromhex("42" * 32)
app_id = "olga-lab-20261012"
now = 1781000000
baseline = {x["area"]: hashlib.sha256(
    (x["check"] + ":pass:" + report["source_sha256"]).encode()
).hexdigest() for x in report["baseline"]}
evidence = {
    "approved": True,
    "revision": report["source_commit"],
    "passed_checks": 3, "failed_checks": 0,
    "digest": hashlib.sha256(
        json.dumps(report["baseline"], sort_keys=True).encode()
    ).hexdigest(),
}
seal = issue_care_seal(
    tag_id=app_id, repair_id="LAB-ONLY-NO-REPAIR-20261012",
    seal_id="LAB-CHECKPOINT-20261012", revision=report["source_commit"],
    evidence=evidence, fingerprints=baseline, issued_at=now,
    issuer_secret=issuer_key
)
assert verify_care_seal(seal, issuer_key, tag_id=app_id)
tag = AlumaTag(app_id, app_key, enabled=True)
monitor = CareSealMonitor(tag, seal, issuer_key)
receiver = BeamDesk({app_id: app_key}, {app_id: seal["seal_id"]})

healthy = {
    "revision": report["source_commit"],
    "fingerprints": baseline,
    "checks": {area: True for area in baseline}
}
assert monitor.event(healthy, event_id="olga-healthy-001", at=now) is None

result_cases = []
for n, incident in enumerate(report["isolated_faults"], 1):
    expected = incident["diagnosed_area"]
    check_results = incident["fault_execution"]
    failing = [x for x in check_results if not x["passed"]]
    assert len(failing) == 1 and failing[0]["area"] == expected
    checks = {r["area"]: r["passed"] for r in check_results}
    fingerprints = dict(baseline)
    # Hash only boolean check outcome and its canonical test label, not code.
    fingerprints[expected] = hashlib.sha256(
        (failing[0]["check"] + ":failed").encode()
    ).hexdigest()
    snapshot = {
        "revision": report["source_commit"],
        "fingerprints": fingerprints, "checks": checks,
        # Deliberate private junk verifies no private values leave the signal.
        "admin_token": "DO_NOT_EXPORT_TOKEN",
        "private_users": "DO_NOT_EXPORT_USERS",
    }
    alert = monitor.event(snapshot,
                          event_id="olga-test-incident-%03d" % n, at=now)
    assert alert is not None and verify_message(app_key, alert)
    triage = receiver.receive(alert, now=now)
    assert triage["areas"] == [expected]
    assert triage["decision"] == "request_authorized_diagnosis"
    assert not triage["performed_repair"]
    assert set(alert) == {
        "v", "kind", "tag", "seal_id", "event_id", "at", "status",
        "areas", "failed_checks", "mac"
    }
    result_cases.append({
        "injected_function": incident["injected_function"],
        "fault_type_local": incident["diagnosed_fault_type"],
        "category_on_wire": alert["areas"],
        "beam_status": triage["status"],
        "beam_next_action": triage["decision"],
        "classification_correct": True,
        "no_external_execution": True,
    })

# Product owner controls whether the small signal includes the fault category.
# Off mode still reports that something failed, without location or count.
owner_hidden = CareSealMonitor(tag, seal, issuer_key, report_fault_area=False)
modified_checks = {area: True for area in baseline}
modified_checks["workflow"] = False
hidden_event = owner_hidden.event({
    "revision": report["source_commit"],
    "fingerprints": baseline, "checks": modified_checks,
}, event_id="olga-hidden-category-001", at=now)
assert hidden_event is not None and verify_message(app_key, hidden_event)
assert hidden_event["status"] == "fault"
assert hidden_event["areas"] == [] and hidden_event["failed_checks"] == 0
hidden_triage = receiver.receive(hidden_event, now=now)
assert hidden_triage["decision"] == "request_authorized_diagnosis"
assert hidden_triage["areas"] == []

summary = {
    "experiment": "TAGFORMIX-OLGA-FUNCTION-FAULT-LAB-01",
    "source": report["repo"] + "/" + report["app_path"],
    "original_source_pinned_commit": report["source_commit"],
    "original_source_blob": report["source_blob_sha1"],
    "baseline": "3/3 original source functions passed isolated tests",
    "seal": "LAB CHECKPOINT ONLY: no real repair was certified",
    "all_three_fault_types": result_cases,
    "correct_classifications": len(result_cases),
    "healthy_baseline_alerts": 0,
    "fault_category_enabled_test": True,
    "fault_category_disabled_test": {
        "transmitted_category": hidden_event["areas"],
        "transmitted_failed_check_count": hidden_event["failed_checks"],
        "fault_status_kept": hidden_event["status"],
        "triage_still_requests_authorized_diagnosis": True,
    },
    "real_olga_source_changed": False,
    "real_olga_production_tag_installed": False,
    "actual_remote_alerts_sent": 0,
    "fully_integrated_browser_test": False,
    "receiver_service_live": False,
    "what_would_be_needed_next": [
        "A CI/event hook actually authorized and installed in an Olga test deployment",
        "A hosted receiver with TLS and persistent anti-replay and revocation",
        "Verified full browser E2E and meaningful health checks",
        "A genuine post-repair verifier record before issuing a commercial seal"
    ]
}
body = json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
assert "DO_NOT_EXPORT" not in body
(HERE / "out" / "TAGFORMIX-OLGA-TRIAGE.json").write_text(body, encoding="utf-8")
print(json.dumps({
    "status": "PASS",
    "real_olga_function_baseline": 3,
    "controlled_breaks_detected": 3,
    "category_errors": 0,
    "categories": [x["category_on_wire"][0] for x in result_cases],
    "actual_olga_changed": False,
}, ensure_ascii=False))
