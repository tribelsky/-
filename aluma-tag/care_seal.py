"""ALUMA-TAG Care Seal v0.2, a bounded post-repair check-in protocol.

A *trusted verifier* may issue a signed receipt after a scoped successful
repair. An owner-opted-in existing CI hook compares an explicitly supplied
health snapshot to its baseline and can generate a small signed alert.
No source inspection, networking, background process, repair deployment,
subscription billing, or third-party integration is implemented.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass, field
from typing import Any

from aluma_tag import AlumaTag, SignalRejected, authenticated, sign, verify_message

# Categories are explicit and fixed so the marker cannot become a generic
# vehicle for arbitrarily named data or opaque file paths.
AREAS = ("runtime", "dependencies", "data", "integrations", "workflow")
OUTPUT_AREAS = frozenset((*AREAS, "revision"))
STATES = frozenset(("fault", "drift", "unknown", "consistent"))
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_SHA1 = re.compile(r"[0-9a-f]{40}\Z")
_ALLOWED_SEAL = frozenset(("v", "kind", "tag", "seal_id", "repair_id",
                           "revision", "issued_at", "evidence_sha256",
                           "passed_checks", "fingerprints", "mac"))
_ALLOWED_ALERT = frozenset(("v", "kind", "tag", "seal_id", "event_id", "at",
                            "status", "areas", "failed_checks", "mac"))
_MAX_AGE = 300  # Timestamp freshness only; persistent event IDs needed in production.

def is_digest64(s: object) -> bool:
    return isinstance(s, str) and bool(_SHA256.fullmatch(s))

def _check_fingerprints(fps: object) -> dict[str, str]:
    if not isinstance(fps, dict) or not fps:
        raise ValueError("At least one monitored category is required")
    if set(fps) - set(AREAS):
        raise ValueError("Unrecognized health check area")
    if any(not is_digest64(x) for x in fps.values()):
        raise ValueError("Fingerprint must be a lowercase SHA256 digest")
    return {k: fps[k] for k in AREAS if k in fps}

def issue_care_seal(
    *,
    tag_id: str,
    repair_id: str,
    seal_id: str,
    revision: str,
    evidence: dict[str, Any],
    fingerprints: dict[str, str],
    issued_at: int,
    issuer_secret: bytes,
) -> dict[str, Any]:
    """Issue *only* after a verifier asserts a passing scoped repair.

    For production, the verifier's evidence must be checked against an
    externally maintained immutable record and a per-tenant signing key.
    This demo validates the shape and signed assertion only.
    """
    if not isinstance(tag_id, str) or not 4 <= len(tag_id) <= 64:
        raise ValueError("Invalid tag")
    if not all(isinstance(x, str) and 8 <= len(x) <= 80
               and re.fullmatch(r"[A-Za-z0-9._:-]+", x)
               for x in (seal_id, repair_id)):
        raise ValueError("Invalid repair/seal IDs")
    if not isinstance(revision, str) or not _SHA1.fullmatch(revision):
        raise ValueError("Revision must be pinned Git SHA1")
    if not isinstance(evidence, dict) or evidence.get("approved") is not True:
        raise ValueError("Independent verifier approval required")
    if evidence.get("revision") != revision:
        raise ValueError("Verifier evidence applies to a different revision")
    if type(evidence.get("passed_checks")) is not int or evidence["passed_checks"] < 1:
        raise ValueError("At least one successful test is required")
    if type(evidence.get("failed_checks")) is not int or evidence["failed_checks"] != 0:
        raise ValueError("A repair with failing checks cannot be sealed")
    if not is_digest64(evidence.get("digest")):
        raise ValueError("Verification evidence hash required")
    if type(issued_at) is not int or issued_at <= 0:
        raise ValueError("Invalid issue timestamp")
    baseline = _check_fingerprints(fingerprints)
    payload = {
        "v": 2, "kind": "care_seal", "tag": tag_id,
        "seal_id": seal_id, "repair_id": repair_id,
        "revision": revision, "issued_at": issued_at,
        "evidence_sha256": evidence["digest"],
        "passed_checks": evidence["passed_checks"],
        "fingerprints": baseline,
    }
    return authenticated(issuer_secret, payload)

def verify_care_seal(seal: object, issuer_secret: bytes, *, tag_id: str) -> bool:
    if not isinstance(seal, dict) or set(seal) != _ALLOWED_SEAL:
        return False
    try:
        if seal.get("tag") != tag_id or seal.get("kind") != "care_seal" or seal.get("v") != 2:
            return False
        if not re.fullmatch(r"[0-9a-f]{40}", seal["revision"]):
            return False
        if not is_digest64(seal["evidence_sha256"]):
            return False
        if type(seal["passed_checks"]) is not int or seal["passed_checks"] <= 0:
            return False
        _check_fingerprints(seal["fingerprints"])
        mac = seal["mac"]
        return isinstance(mac, str) and hmac.compare_digest(
            sign(issuer_secret, {k: v for k, v in seal.items() if k != "mac"}), mac
        )
    except (KeyError, ValueError, TypeError):
        return False

@dataclass
class CareSealMonitor:
    """Called by an existing authorized local CI/health hook.

    The monitor does NOT start the hook or deliver a signal anywhere.
    """
    tag: AlumaTag
    seal: dict[str, Any] = field(repr=False)
    issuer_secret: bytes = field(repr=False)

    def __post_init__(self):
        if not verify_care_seal(self.seal, self.issuer_secret, tag_id=self.tag.tag_id):
            raise SignalRejected("Invalid or different-app care seal")

    def inspect(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        """Compute coarse change against last verified state, without reading files."""
        if not self.tag.enabled:
            raise SignalRejected("Owner has not enabled the care marker")
        if not isinstance(snapshot, dict):
            return {"status": "unknown", "areas": [], "failed_checks": 0}
        fps = snapshot.get("fingerprints")
        checks = snapshot.get("checks")
        revision = snapshot.get("revision")
        baseline = self.seal["fingerprints"]
        if not isinstance(fps, dict) or not isinstance(checks, dict) or \
           not isinstance(revision, str):
            return {"status": "unknown", "areas": [], "failed_checks": 0}
        if any(area not in fps or not is_digest64(fps[area])
               or area not in checks or type(checks[area]) is not bool
               for area in baseline):
            return {"status": "unknown", "areas": [], "failed_checks": 0}
        failed = [area for area in baseline if checks[area] is False]
        changed = [area for area in baseline if fps[area] != baseline[area]]
        if revision != self.seal["revision"]:
            changed.append("revision")
        if failed:
            return {"status": "fault", "areas": failed, "failed_checks": len(failed)}
        if changed:
            return {"status": "drift", "areas": changed, "failed_checks": 0}
        return {"status": "consistent", "areas": [], "failed_checks": 0}

    def event(self, snapshot: dict[str, Any], *, event_id: str,
              at: int) -> dict[str, Any] | None:
        """Create a signal only for deviation; do not transmit it."""
        result = self.inspect(snapshot)
        if result["status"] == "consistent":
            return None
        if not isinstance(event_id, str) or not 12 <= len(event_id) <= 64 or \
           not re.fullmatch(r"[A-Za-z0-9._:-]+", event_id):
            raise ValueError("Unique event ID required")
        if type(at) is not int or at <= 0:
            raise ValueError("Event timestamp required")
        payload = {
            "v": 2, "kind": "care_alert", "tag": self.tag.tag_id,
            "seal_id": self.seal["seal_id"], "event_id": event_id,
            "at": at, "status": result["status"],
            "areas": result["areas"],
            "failed_checks": result["failed_checks"],
        }
        return authenticated(self.tag.secret, payload)

@dataclass
class BeamDesk:
    """Server-side decision-only receiver. No repair execution capability."""
    keys: dict[str, bytes]
    active_seals: dict[str, str]
    _seen: dict[tuple[str, str], int] = field(default_factory=dict, init=False, repr=False)

    def receive(self, alert: dict[str, Any], *, now: int) -> dict[str, Any]:
        if not isinstance(alert, dict) or set(alert) != _ALLOWED_ALERT:
            raise SignalRejected("Unexpected alert shape")
        tag_id = alert.get("tag")
        key = self.keys.get(tag_id) if isinstance(tag_id, str) else None
        if not key or not verify_message(key, alert):
            raise SignalRejected("Sender not authenticated")
        if alert.get("v") != 2 or alert.get("kind") != "care_alert":
            raise SignalRejected("Not a care signal")
        if self.active_seals.get(tag_id) != alert.get("seal_id"):
            raise SignalRejected("Seal has been revoked or superseded")
        if alert.get("status") not in STATES or alert["status"] == "consistent":
            raise SignalRejected("Invalid incident status")
        areas = alert.get("areas")
        if not isinstance(areas, list) or len(set(map(str, areas))) != len(areas) \
           or any(not isinstance(x, str) or x not in OUTPUT_AREAS for x in areas):
            raise SignalRejected("Unrecognized diagnostic area")
        n = alert.get("failed_checks")
        if type(n) is not int or not 0 <= n <= len(AREAS):
            raise SignalRejected("Invalid failure count")
        at = alert.get("at")
        if type(at) is not int or type(now) is not int or abs(now - at) > _MAX_AGE:
            raise SignalRejected("Stale signal")
        eid = alert.get("event_id")
        if not isinstance(eid, str) or not 12 <= len(eid) <= 64:
            raise SignalRejected("Invalid event reference")
        # Demo memory-only replay guard. Deployments need durable per-client
        # replay controls surviving process restarts.
        self._seen = {k: t for k, t in self._seen.items() if now - t <= 2 * _MAX_AGE}
        marker = (tag_id, eid)
        if marker in self._seen:
            raise SignalRejected("Duplicate incident")
        self._seen[marker] = now
        decision = {"fault": "request_authorized_diagnosis",
                    "drift": "review_change_and_run_prevention_tests",
                    "unknown": "request_fresh_status"}[alert["status"]]
        return {
            "app": tag_id, "seal_id": alert["seal_id"],
            "status": alert["status"], "areas": areas,
            "decision": decision, "performed_repair": False,
            "autonomous_probe_launched": False,
        }
