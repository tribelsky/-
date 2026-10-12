"""Run one local ALUMA-TAG ping and one explicit build event; no networking."""
import json
from pathlib import Path
from aluma_tag import AlumaTag, make_challenge, verify_message

here = Path(__file__).resolve().parent
conf = json.loads((here / "marker.json").read_text(encoding="utf-8"))
# Example key strictly for this local simulation; no deployable secrets stored.
test_key = bytes.fromhex("10" * 32)
timestamp = 1781000000
tag = AlumaTag(conf["tag_id"], test_key, enabled=True)
query = make_challenge(conf["tag_id"], test_key, "locally-generated-demo-nonce", timestamp)
response = tag.respond(query, {
    "health": "warning",
    "changed": True,
    "failed_checks": 1,
    "repository_source": "never leave the local app",
    "private_person": "never leave the local app",
}, now=timestamp)
event = tag.signal("build_fail", at=timestamp)
report = {
    "protocol": conf["protocol"],
    "mode": "LOCAL_ONLY_NO_EXTERNAL_REQUESTS",
    "request_kind": query["kind"],
    "response": {k: v for k, v in response.items() if k != "mac"},
    "response_hmac_verified": verify_message(test_key, response),
    "event": {k: v for k, v in event.items() if k != "mac"},
    "event_hmac_verified": verify_message(test_key, event),
    "actual_remote_beacon_installed": False,
    "real_external_app_contacted": False,
    "source_code_transferred": False
}
assert report["response_hmac_verified"] and report["event_hmac_verified"]
assert "repository_source" not in json.dumps(report)
assert "private_person" not in json.dumps(report)
out = here / "out"
out.mkdir(exist_ok=True)
(out / "ALUMA-TAG-DEMO.json").write_text(json.dumps(report, indent=2)+"\n")
print(json.dumps({"status": "PASS", "scenario": "one ping / one response / one event",
                  "remote_apps_touched": 0, "local_fixture_only": True}))
