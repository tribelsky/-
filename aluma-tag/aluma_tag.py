"""ALUMA-TAG v0.1: tiny opt-in code marker and authenticated status signal.

No transport, listener, scheduler, filesystem access, internet access, remote
commands, source-code export or background process. A host's *existing*
authorized CI/event hook must call this code for any response or emission.
This is a controlled signal fixture, not a monitoring deployment.
"""
from __future__ import annotations
import hashlib
import hmac
import json
from dataclasses import dataclass, field

PROTOCOL = 1
MAX_SKEW_SECONDS = 90

class SignalRejected(ValueError):
    """Invalid, unauthorized or replayed marker signal."""

def canonical(data: dict) -> bytes:
    return json.dumps(data, ensure_ascii=True, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("ascii")

def sign(secret: bytes, payload: dict) -> str:
    return hmac.new(secret, canonical(payload), hashlib.sha256).hexdigest()

def authenticated(secret: bytes, payload: dict) -> dict:
    if not isinstance(secret, bytes) or len(secret) < 16:
        raise ValueError("A unique external 128-bit or stronger key is required")
    clean = dict(payload)
    clean["mac"] = sign(secret, clean)
    return clean

def make_challenge(tag_id: str, secret: bytes, nonce: str, at: int) -> dict:
    """An authorized controller creates a one-time authenticated status query."""
    return authenticated(secret, {
        "v": PROTOCOL, "tag": tag_id, "kind": "status",
        "nonce": nonce, "at": at,
    })

@dataclass
class AlumaTag:
    tag_id: str
    secret: bytes = field(repr=False)
    enabled: bool = False
    _seen: dict[str, int] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self):
        if not isinstance(self.tag_id, str) or not (4 <= len(self.tag_id) <= 64):
            raise ValueError("Invalid public tag identifier")
        if not isinstance(self.secret, bytes) or len(self.secret) < 16:
            raise ValueError("Local signing key must have 128+ bits")

    def _signed(self, payload: dict) -> dict:
        return authenticated(self.secret, payload)

    def _require_active(self):
        if not self.enabled:
            raise SignalRejected("Owner has not enabled the tag")

    def respond(self, request: dict, local_health: dict, *, now: int) -> dict:
        """Receive a signed status request and return whitelisted metadata only."""
        self._require_active()
        expected = {"v", "tag", "kind", "nonce", "at", "mac"}
        if not isinstance(request, dict) or set(request) != expected:
            raise SignalRejected("Only a simple status signal is supported")
        if request.get("v") != PROTOCOL or request.get("tag") != self.tag_id:
            raise SignalRejected("Wrong protocol or tag identity")
        if request.get("kind") != "status":
            raise SignalRejected("No remote instructions are accepted")
        ts = request.get("at")
        if type(ts) is not int or abs(now - ts) > MAX_SKEW_SECONDS:
            raise SignalRejected("Expired or future-dated challenge")
        nonce = request.get("nonce")
        if not isinstance(nonce, str) or not 12 <= len(nonce) <= 64:
            raise SignalRejected("Invalid replay-protection nonce")
        mac = request.get("mac")
        if not isinstance(mac, str) or not hmac.compare_digest(
            sign(self.secret, {k: request[k] for k in expected if k != "mac"}), mac
        ):
            raise SignalRejected("Challenge authentication failed")
        # A real service must persist nonces across restarts. This demo is
        # memory-only and explicitly *not* deployable as a production listener.
        self._seen = {n: t for n, t in self._seen.items()
                      if now - t <= MAX_SKEW_SECONDS * 2}
        if nonce in self._seen:
            raise SignalRejected("Replay detected")
        if len(self._seen) >= 256:
            raise SignalRejected("Too many pending challenge records")
        self._seen[nonce] = now

        health = local_health.get("health") if isinstance(local_health, dict) else None
        if health not in ("ok", "warning", "degraded", "unknown"):
            health = "unknown"
        changed = local_health.get("changed") if isinstance(local_health, dict) else None
        failures = local_health.get("failed_checks") if isinstance(local_health, dict) else None
        if type(failures) is not int or not 0 <= failures <= 99999:
            failures = None
        # No secrets, filenames, stack traces, code, git remote or user data.
        return self._signed({
            "v": PROTOCOL, "tag": self.tag_id, "kind": "status_reply",
            "in_reply_to": nonce, "at": now, "health": health,
            "changed": changed if type(changed) is bool else None,
            "failed_checks": failures,
        })

    def signal(self, event: str, *, at: int) -> dict:
        """Existing *opted-in* build hook may choose to deliver this elsewhere."""
        self._require_active()
        if event not in ("build_pass", "build_fail", "health_warning"):
            raise SignalRejected("Unsupported event, no arbitrary commands")
        return self._signed({
            "v": PROTOCOL, "tag": self.tag_id,
            "kind": "event", "event": event, "at": at,
        })

def verify_message(secret: bytes, message: dict) -> bool:
    """A separately authorized receiver validates integrity of returned data."""
    if not isinstance(message, dict) or not isinstance(message.get("mac"), str):
        return False
    mac = message["mac"]
    try:
        return hmac.compare_digest(
            sign(secret, {k: v for k, v in message.items() if k != "mac"}), mac
        )
    except (TypeError, ValueError):
        return False
