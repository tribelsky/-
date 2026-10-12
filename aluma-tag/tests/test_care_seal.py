"""ALUMA Care Seal: signed treatment receipt and limited later alerts."""
import hashlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aluma_tag import AlumaTag, SignalRejected, authenticated
from care_seal import (
    AREAS, BeamDesk, CareSealMonitor, issue_care_seal, verify_care_seal
)

NOW = 1781000000
REV = "a" * 40
NEW_REV = "b" * 40
KEY = bytes.fromhex("10" * 32)       # test fixture only, not live secret
ISSUER = bytes.fromhex("20" * 32)    # independent certificate key for test only
BASELINE = {area: hashlib.sha256(("base-" + area).encode()).hexdigest()
            for area in AREAS[:4]}
TEST_EVIDENCE = {"approved": True, "revision": REV, "passed_checks": 27,
                 "failed_checks": 0,
                 "digest": hashlib.sha256(b"test verifier result").hexdigest()}

def seal(**overrides):
    args = {
        "tag_id": "pilot-app-0001", "repair_id": "repair-20261012-001",
        "seal_id": "seal-20261012-001", "revision": REV,
        "evidence": dict(TEST_EVIDENCE), "fingerprints": dict(BASELINE),
        "issued_at": NOW, "issuer_secret": ISSUER,
    }
    args.update(overrides)
    return issue_care_seal(**args)

def snapshot(**overrides):
    data = {"revision": REV,
            "fingerprints": dict(BASELINE),
            "checks": {area: True for area in BASELINE}}
    data.update(overrides)
    return data

class CareSealTests(unittest.TestCase):
    def setUp(self):
        self.receipt = seal()
        self.tag = AlumaTag("pilot-app-0001", KEY, enabled=True)
        self.monitor = CareSealMonitor(self.tag, self.receipt, ISSUER)
        self.desk = BeamDesk(
            {"pilot-app-0001": KEY},
            {"pilot-app-0001": "seal-20261012-001"}
        )

    def alert(self, data=None, ref="incident-20261012-001"):
        if data is None:
            altered = dict(snapshot()["checks"])
            altered["runtime"] = False
            data = snapshot(checks=altered)
        return self.monitor.event(data, event_id=ref, at=NOW)

    def test_signed_receipt_can_be_verified(self):
        self.assertTrue(verify_care_seal(self.receipt, ISSUER,
                                         tag_id="pilot-app-0001"))
        self.assertEqual(self.receipt["passed_checks"], 27)

    def test_no_bad_approval(self):
        e = dict(TEST_EVIDENCE, approved=False)
        with self.assertRaises(ValueError):
            seal(evidence=e)

    def test_no_failed_checks_can_be_sealed(self):
        e = dict(TEST_EVIDENCE, failed_checks=1)
        with self.assertRaises(ValueError):
            seal(evidence=e)

    def test_no_unmatched_revision_can_be_sealed(self):
        e = dict(TEST_EVIDENCE, revision=NEW_REV)
        with self.assertRaises(ValueError):
            seal(evidence=e)

    def test_no_malformed_hash_or_empty_baseline(self):
        with self.assertRaises(ValueError):
            seal(fingerprints={})
        with self.assertRaises(ValueError):
            seal(fingerprints={"runtime": "raw source file"})
        with self.assertRaises(ValueError):
            seal(fingerprints={"private_path": "a" * 64})

    def test_certificate_tampering_detected(self):
        doc = dict(self.receipt, passed_checks=999)
        self.assertFalse(verify_care_seal(doc, ISSUER, tag_id="pilot-app-0001"))
        with self.assertRaises(SignalRejected):
            CareSealMonitor(self.tag, doc, ISSUER)

    def test_unrelated_app_cannot_use_seal(self):
        other = AlumaTag("another-app-0001", KEY, enabled=True)
        with self.assertRaises(SignalRejected):
            CareSealMonitor(other, self.receipt, ISSUER)

    def test_default_off_blocks_events(self):
        off = AlumaTag("pilot-app-0001", KEY)
        with self.assertRaises(SignalRejected):
            CareSealMonitor(off, self.receipt, ISSUER).event(
                snapshot(), event_id="event-disabled-001", at=NOW)

    def test_healthy_snapshot_sends_no_alert(self):
        self.assertEqual(self.monitor.inspect(snapshot())["status"], "consistent")
        self.assertIsNone(self.monitor.event(
            snapshot(), event_id="no-alert-needed-01", at=NOW))

    def test_runtime_failure_gives_scoped_signal(self):
        alert = self.alert()
        self.assertEqual(alert["status"], "fault")
        self.assertEqual(alert["areas"], ["runtime"])
        self.assertEqual(alert["failed_checks"], 1)
        self.assertEqual(alert["kind"], "care_alert")

    def test_drift_from_revision_is_not_labeled_as_failure(self):
        alert = self.alert(snapshot(revision=NEW_REV), ref="revision-change-001")
        self.assertEqual(alert["status"], "drift")
        self.assertEqual(alert["areas"], ["revision"])
        self.assertEqual(alert["failed_checks"], 0)
        triage = self.desk.receive(alert, now=NOW)
        self.assertEqual(triage["decision"], "review_change_and_run_prevention_tests")
        self.assertFalse(triage["performed_repair"])

    def test_dependency_fingerprint_drift_is_classified(self):
        f = dict(BASELINE)
        f["dependencies"] = hashlib.sha256(b"new-lockfile").hexdigest()
        msg = self.alert(snapshot(fingerprints=f), ref="deps-change-001")
        self.assertEqual(msg["status"], "drift")
        self.assertEqual(msg["areas"], ["dependencies"])

    def test_absent_measurement_yields_unknown_not_a_crash(self):
        snap = snapshot()
        del snap["checks"]["data"]
        result = self.monitor.inspect(snap)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["failed_checks"], 0)
        alert = self.alert(snap, ref="check-unknown-001")
        decision = self.desk.receive(alert, now=NOW)
        self.assertEqual(decision["decision"], "request_fresh_status")

    def test_never_exports_private_snapshot_fields(self):
        snap = snapshot()
        snap["admin_token"] = "PRIVATE-SECRET-DONT-EXFILTRATE"
        snap["source_code"] = "private repository source"
        snap["client_email"] = "name@example.net"
        x = self.alert(snap, ref="privacy-check-001")
        self.assertEqual(set(x), {"v", "kind", "tag", "seal_id",
                                  "event_id", "at", "status", "areas",
                                  "failed_checks", "mac"})
        s = json.dumps(x)
        self.assertNotIn("PRIVATE", s)
        self.assertNotIn("email", s)
        self.assertNotIn("repository source", s)

    def test_receiver_authenticates_and_does_not_repair(self):
        m = self.desk.receive(self.alert(), now=NOW)
        self.assertEqual(m["decision"], "request_authorized_diagnosis")
        self.assertFalse(m["performed_repair"])
        self.assertFalse(m["autonomous_probe_launched"])

    def test_receiver_rejects_tampered_alert(self):
        a = self.alert()
        a["areas"] = ["dependencies"]
        with self.assertRaisesRegex(SignalRejected, "authenticated"):
            self.desk.receive(a, now=NOW)

    def test_receiver_rejects_unknown_seal(self):
        self.desk.active_seals["pilot-app-0001"] = "superseding-seal-001"
        with self.assertRaisesRegex(SignalRejected, "revoked"):
            self.desk.receive(self.alert(), now=NOW)

    def test_receiver_rejects_replayed_alert(self):
        a = self.alert()
        self.desk.receive(a, now=NOW)
        with self.assertRaisesRegex(SignalRejected, "Duplicate"):
            self.desk.receive(a, now=NOW)

    def test_receiver_rejects_stale_alert(self):
        with self.assertRaisesRegex(SignalRejected, "Stale"):
            self.desk.receive(self.alert(), now=NOW + 301)

    def test_receiver_rejects_arbitrary_area_even_if_signed(self):
        a = self.alert()
        a["areas"] = ["read_private_database"]
        forged = authenticated(KEY, {k: v for k, v in a.items() if k != "mac"})
        with self.assertRaisesRegex(SignalRejected, "Unrecognized"):
            self.desk.receive(forged, now=NOW)

    def test_alert_fails_closed_on_invalid_event_id(self):
        with self.assertRaises(ValueError):
            self.alert(ref="bad!")

    def test_invalid_health_snapshot_not_misclassified_as_healthy(self):
        snap = snapshot()
        snap["checks"]["runtime"] = "PASS"
        self.assertEqual(self.monitor.inspect(snap)["status"], "unknown")

    def test_change_plus_fault_prioritizes_failure(self):
        c = dict(snapshot()["checks"])
        c["integrations"] = False
        alert = self.alert(snapshot(checks=c, revision=NEW_REV),
                           ref="combo-event-001")
        self.assertEqual(alert["status"], "fault")
        self.assertEqual(alert["areas"], ["integrations"])

if __name__ == "__main__":
    unittest.main()
