"""ALUMA-TAG Care Seal: entire post-repair lifecycle, local fixtures only."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from aluma_tag import AlumaTag, make_challenge, verify_message
from care_seal import BeamDesk, CareSealMonitor, issue_care_seal, verify_care_seal

HERE = Path(__file__).resolve().parent
NOW = 1781000000
REV = "c" * 40
TAG = "sample-fixed-app"
# The two following keys are synthetic test fixtures, never deployment secrets.
ISSUER_KEY = bytes.fromhex("20" * 32)
APP_KEY = bytes.fromhex("10" * 32)
baseline = {
    "runtime": hashlib.sha256(b"passing-runtime-tests-v1").hexdigest(),
    "dependencies": hashlib.sha256(b"lockfile-v1").hexdigest(),
    "workflow": hashlib.sha256(b"passing-flow-tests-v1").hexdigest()
}
verification = {
    "approved": True, "revision": REV, "passed_checks": 8, "failed_checks": 0,
    "digest": hashlib.sha256(b"trusted-verifier-fixture-report").hexdigest()
}

# Stage 1: independent verifier authorizes a scoped post-repair seal.
receipt = issue_care_seal(
    tag_id=TAG, seal_id="seal-repair-0001", repair_id="repair-20261012-0001",
    revision=REV, fingerprints=baseline,
    evidence=verification, issued_at=NOW, issuer_secret=ISSUER_KEY
)
tag = AlumaTag(TAG, APP_KEY, enabled=True)  # consent fixture
monitor = CareSealMonitor(tag, receipt, ISSUER_KEY)
desk = BeamDesk({TAG: APP_KEY}, {TAG: receipt["seal_id"]})
passed_snapshot = {
    "revision": REV, "fingerprints": baseline,
    "checks": {name: True for name in baseline}
}
assert monitor.event(passed_snapshot, event_id="baseline-no-event-001", at=NOW) is None

# Stage 2: in a later simulated CI job, one existing test becomes red.
failing_snapshot = {
    "revision": REV, "fingerprints": baseline,
    "checks": {"runtime": True, "dependencies": False, "workflow": True},
    "private_source": "NOT_EXPORTED",
    "customer_identity": "NOT_EXPORTED",
}
alert = monitor.event(failing_snapshot, event_id="late-dependency-issue-001", at=NOW)
assert alert is not None and verify_message(APP_KEY, alert)
decision = desk.receive(alert, now=NOW)
assert decision["areas"] == ["dependencies"]
assert decision["decision"] == "request_authorized_diagnosis"

# Stage 3: an authorized event hook can answer a minimal Beam status challenge.
request = make_challenge(TAG, APP_KEY, "independent-followup-001", NOW)
reply = tag.respond(request, {"health": "degraded", "changed": False,
                              "failed_checks": 1,
                              "source_code": "NOT_EXPORTED"},
                    now=NOW)
assert verify_message(APP_KEY, reply)

report = {
    "scenario": "fixed → sealed → test failed later → alert → beam triage → status reply",
    "certificate": {k: v for k, v in receipt.items()
                    if k not in ("mac", "fingerprints")},
    "certificate_authenticated": verify_care_seal(receipt, ISSUER_KEY, tag_id=TAG),
    "after_repair_consistent_no_alert": True,
    "alert": {k: v for k, v in alert.items() if k != "mac"},
    "triage": decision,
    "reply": {k: v for k, v in reply.items() if k != "mac"},
    "reply_authenticated": True,
    "customer_apps_contacted": 0,
    "actual_followup_receiver_online": False,
    "real_repairs_executed": 0,
    "automated_production_monitoring": False
}
body = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
assert "NOT_EXPORTED" not in body
out = HERE / "out"
out.mkdir(parents=True, exist_ok=True)
(out / "CARE-SEAL-V02-DEMO.json").write_text(body, encoding="utf-8")
print(json.dumps({
    "status": "PASS", "seal_valid": True,
    "baseline_no_alert": True, "later_fault_area": "dependencies",
    "beam_decision": decision["decision"],
    "external_app_writes": 0, "production_receiver": False
}))
