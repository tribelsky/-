"""Local tests for an opt-in, nonresident ALUMA-TAG marker."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aluma_tag import AlumaTag, SignalRejected, make_challenge, verify_message, authenticated

KEY = bytes.fromhex("10" * 32)  # TEST-ONLY FIXTURE, NOT A DEPLOYABLE KEY
NOW = 1781000000
TAG = "demo-app-01"

class TagTests(unittest.TestCase):
    def setUp(self):
        self.tag = AlumaTag(TAG, KEY, enabled=True)

    def challenge(self, nonce="once-only-1234", at=NOW):
        return make_challenge(TAG, KEY, nonce, at)

    def test_default_disabled(self):
        marker = AlumaTag(TAG, KEY)
        with self.assertRaises(SignalRejected):
            marker.respond(self.challenge(), {"health": "ok"}, now=NOW)
        with self.assertRaises(SignalRejected):
            marker.signal("build_pass", at=NOW)

    def test_status_reply_is_authenticated_and_minimal(self):
        private = {"health": "ok", "changed": True, "failed_checks": 2,
                   "source_code": "DO_NOT_SHARE", "password": "SECRET", "private_user": "NO"}
        response = self.tag.respond(self.challenge(), private, now=NOW)
        self.assertTrue(verify_message(KEY, response))
        self.assertEqual(response["kind"], "status_reply")
        self.assertEqual(response["in_reply_to"], "once-only-1234")
        self.assertEqual(response["failed_checks"], 2)
        self.assertEqual(set(response), {"v", "tag", "kind", "in_reply_to", "at",
                                         "health", "changed", "failed_checks", "mac"})
        self.assertNotIn("DO_NOT_SHARE", str(response))
        self.assertNotIn("SECRET", str(response))

    def test_bad_signature_rejected(self):
        req = self.challenge()
        req["mac"] = "0" * 64
        with self.assertRaisesRegex(SignalRejected, "authentication"):
            self.tag.respond(req, {}, now=NOW)

    def test_missing_signature_rejected(self):
        req = self.challenge()
        del req["mac"]
        with self.assertRaises(SignalRejected):
            self.tag.respond(req, {}, now=NOW)

    def test_old_and_future_challenges_rejected(self):
        for at in (NOW - 91, NOW + 91):
            with self.subTest(at=at):
                with self.assertRaisesRegex(SignalRejected, "Expired"):
                    self.tag.respond(self.challenge(nonce="expired123456", at=at),
                                     {}, now=NOW)

    def test_replay_rejected(self):
        req = self.challenge()
        self.tag.respond(req, {"health": "ok"}, now=NOW)
        with self.assertRaisesRegex(SignalRejected, "Replay"):
            self.tag.respond(req, {"health": "ok"}, now=NOW)

    def test_unauthorized_command_rejected(self):
        req = authenticated(KEY, {"v": 1, "tag": TAG, "kind": "run_command",
                                  "nonce": "cmd-test-12345", "at": NOW})
        with self.assertRaisesRegex(SignalRejected, "No remote instructions"):
            self.tag.respond(req, {}, now=NOW)

    def test_extra_fields_rejected(self):
        req = self.challenge()
        req["fetch_private_files"] = True
        with self.assertRaises(SignalRejected):
            self.tag.respond(req, {}, now=NOW)

    def test_other_tag_identity_rejected(self):
        req = make_challenge("some-other-app", KEY, "wrong-identity123", NOW)
        with self.assertRaisesRegex(SignalRejected, "Wrong protocol"):
            self.tag.respond(req, {}, now=NOW)

    def test_unknown_health_defaults_to_unknown(self):
        out = self.tag.respond(self.challenge(), {"health": "green",
                               "changed": "TRUE", "failed_checks": -4}, now=NOW)
        self.assertEqual(out["health"], "unknown")
        self.assertIsNone(out["changed"])
        self.assertIsNone(out["failed_checks"])

    def test_explicit_event_only(self):
        event = self.tag.signal("build_fail", at=NOW)
        self.assertTrue(verify_message(KEY, event))
        self.assertEqual(event["event"], "build_fail")
        with self.assertRaises(SignalRejected):
            self.tag.signal("open_remote_shell", at=NOW)

    def test_tampered_reply_fails_verification(self):
        answer = self.tag.respond(self.challenge(), {"health": "ok"}, now=NOW)
        answer["health"] = "degraded"
        self.assertFalse(verify_message(KEY, answer))

    def test_empty_nonce_rejected(self):
        req = self.challenge(nonce="")
        with self.assertRaisesRegex(SignalRejected, "nonce"):
            self.tag.respond(req, {}, now=NOW)

if __name__ == "__main__":
    unittest.main()
