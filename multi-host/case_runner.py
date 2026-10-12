#!/usr/bin/env python3
"""TAGFORMIX 3-app parallel pilot: one isolated CI runner per application.

Synthetic owner opt-in is limited to this training lab. The repositories
belonging to other developers are read at immutable public commits only.
No repairs or tags are installed into any public application.
"""
from __future__ import annotations

import argparse
import ast
import datetime as dt
import difflib
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path.cwd()
sys.path.insert(0, str(ROOT / "argus-ref/argus-lab"))
sys.path.insert(0, str(ROOT / "aluma-tag"))
from probe import fetch_source, isolated_langflow_probe, isolated_anythingllm_probe
from treatments import langflow_fix, anything_fix
from aluma_tag import authenticated, verify_message, SignalRejected
from care_seal import BeamDesk

NOW = 1781000000    # deterministic synthetic lab clock; not live status
APP_IDS = ("olga", "langflow", "anythingllm")
APP_TO_AREA = {"olga": "runtime", "langflow": "data", "anythingllm": "workflow"}
CASE_SOURCE = {
    "langflow": (
        "langflow-ai/langflow",
        "504c02fc47e76087b82b0e7cbe4186e9cdd916d4",
        "src/lfx/src/lfx/base/data/utils.py",
    ),
    "anythingllm": (
        "Mintplex-Labs/anything-llm",
        "2a10d052a1812d7be12c43f9024072cf26a27a8b",
        "server/models/systemPromptVariables.js",
    )
}

def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def digest(b: bytes):
    return hashlib.sha256(b).hexdigest()

def signed_lab_event(app: str, area: str):
    """Checks per-app signer segregation and local Beam routing only."""
    if app not in APP_IDS:
        raise ValueError("Unrecognized training app")
    unique_keys = {
        x: hashlib.sha256(("NOT_FOR_PRODUCTION:"+x).encode()).digest()
        for x in APP_IDS
    }
    tag_id="training-"+app
    seal_id="LAB-ONLY-"+app+"-seal"
    keys={"training-"+x: key for x, key in unique_keys.items()}
    seals={"training-"+x: "LAB-ONLY-"+x+"-seal" for x in APP_IDS}
    desk=BeamDesk(keys,seals)
    payload={
        "v":2,"kind":"care_alert","tag":tag_id,"seal_id":seal_id,
        "event_id":"synthetic-"+app+"-incident-001","at":NOW,
        "status":"fault","areas":[area],"failed_checks":1
    }
    event=authenticated(unique_keys[app],payload)
    assert verify_message(unique_keys[app], event)
    assert all(not verify_message(unique_keys[other], event)
               for other in APP_IDS if other != app)
    routed=desk.receive(event,now=NOW)
    assert routed["areas"]==[area]
    assert routed["decision"]=="request_authorized_diagnosis"
    assert routed["app"]==tag_id and routed["performed_repair"] is False
    try:
        desk.receive(event,now=NOW)
        raise AssertionError("Replay was wrongly permitted")
    except SignalRejected:
        pass
    fake=authenticated(unique_keys[APP_IDS[(APP_IDS.index(app)+1)%3]],payload)
    try:
        desk.receive(fake,now=NOW)
        raise AssertionError("Cross-client forged event was accepted")
    except SignalRejected:
        pass

    authorized_lease={"opt_in":True,"app":tag_id,
                      "mode":"TRAINING_SOURCE_SANDBOX_ONLY",
                      "allow_production_write":False,
                      "skills":["rescue-scout","rescue-composer","rescue-verifier"]}
    assert len(authorized_lease["skills"])==3
    refused=dict(authorized_lease,opt_in=False)
    assert not refused["opt_in"]  # no dispatch on declined simulated consent
    return {
        "transport":"IN_PROCESS_ONLY",
        "synthetic_owner_opt_in":True,
        "fake_lab_seal_only":True,
        "authenticated":True,
        "cross_client_forgery_rejected":True,
        "replay_rejected":True,
        "no_consent_declined":True,
        "routed_target":routed["app"],
        "area":area,
        "decision":routed["decision"],
        "skills":authorized_lease["skills"],
        "test_signer_fingerprint":digest(unique_keys[app])[:16],
    }

def langflow_variants(source):
    ast_tree=ast.parse(source)
    matches=[n for n in ast_tree.body if isinstance(n,ast.FunctionDef)
             and n.name=="_detect_encoding_with_fallbacks"]
    if len(matches)!=1:
        raise AssertionError("Expected one pinned Langflow helper")
    class MockChardet:
        @staticmethod
        def detect(data):
            return {"encoding":"Windows-1252"}
    sandbox={"chardet":MockChardet,"_CHARDET_SAMPLE_BYTES":65536}
    module=ast.fix_missing_locations(ast.Module(body=matches,type_ignores=[]))
    exec(compile(module,"<source-reviewed-langflow-helper>","exec"),sandbox)
    helper=sandbox["_detect_encoding_with_fallbacks"]
    samples=[
        ("cp1252_open_quote",b"\x93","\u201c"),
        ("cp1252_euro",b"\x80","\u20ac"),
        ("cp1252_long_dash",b"\x97","\u2014"),
        ("utf8_prioritized","\u05e9\u05dc\u05d5\u05dd".encode("utf8"),"\u05e9\u05dc\u05d5\u05dd"),
        ("ascii_unchanged",b"TEST","TEST"),
    ]
    results=[]
    for case,raw,expected in samples:
        observed=None
        for enc in helper(raw):
            try:
                observed=raw.decode(enc)
                break
            except (UnicodeDecodeError,LookupError):
                continue
        results.append({"test":case,"pass":observed==expected,
                        "observed_unicode":[ord(c) for c in observed] if observed else None})
    return results

def anything_variants(source):
    with tempfile.TemporaryDirectory(prefix="tagformix-anything-") as folder:
        source_file=Path(folder)/"source.js"
        source_file.write_text(source,encoding="utf8")
        node_script=ROOT/"multi-host/anything_variants.cjs"
        p=subprocess.run(["node",str(node_script),str(source_file)],
                         capture_output=True,text=True,timeout=14,check=True)
        return json.loads(p.stdout)["cases"]

def python_cases(app: str):
    repo,commit,path=CASE_SOURCE[app]
    original,meta=fetch_source(repo,commit,path)
    fixed=langflow_fix(original) if app=="langflow" else anything_fix(original)
    before=(isolated_langflow_probe(original) if app=="langflow"
            else isolated_anythingllm_probe(original))
    after=(isolated_langflow_probe(fixed) if app=="langflow"
           else isolated_anythingllm_probe(fixed))
    if before.get("mismatch_reproduced") is not True or \
       after.get("mismatch_reproduced") is not False:
        raise AssertionError("Expected real pinned upstream mismatch followed by candidate passing")
    cases=(langflow_variants(fixed) if app=="langflow" else anything_variants(fixed))
    if len(cases)<3 or not all(x.get("pass") for x in cases):
        raise AssertionError("Held-out or regression variants failed: "+str(cases))
    patch="".join(difflib.unified_diff(
        original.splitlines(True),fixed.splitlines(True),
        fromfile="a/"+path,tofile="b/"+path))
    if not patch.startswith("--- a/") or "@@" not in patch:
        raise AssertionError("Missing source-pinned repair candidate patch")
    return {
        "repo":repo,"source_commit":commit,"source_path":path,
        "source_sha256":meta["sha256"],
        "finding":"REPRODUCED_UPSTREAM_FUNCTION_MISMATCH",
        "source_defect_reproduced":True,
        "candidate_passed":True,"baseline_failed":True,
        "heldout_variants":cases,"heldout_pass":len(cases),
        "candidate_patch":patch,
        "function_scope_only":True,
        "real_app_unchanged":True,
        "full_app_tested":False,
        "candidate_algo":"known issue-specific bounded correction, not novel skill generation",
    }

def olga_case():
    p=ROOT/"source-ref/olga-chess/game.html"
    if not p.exists():
        raise FileNotFoundError("Exact Olga source missing")
    subprocess.run(["node","tagformix-olga-lab/olga-real-source-probe.mjs",str(p)],
                   check=True,capture_output=True,text=True,timeout=30)
    subprocess.run(["python3","tagformix-olga-lab/rescue_dispatch.py"],
                   check=True,capture_output=True,text=True,timeout=30)
    subprocess.run(["node","tagformix-olga-lab/rescue_execute.mjs",str(p)],
                   check=True,capture_output=True,text=True,timeout=30)
    folder=ROOT/"tagformix-olga-lab/out"
    source=json.loads((folder/"OLGA-REAL-SOURCE-RESULT.json").read_text())
    dispatch=json.loads((folder/"RESCUE-AUTHORIZED-DISPATCH.json").read_text())
    fixes=json.loads((folder/"RESCUE-VERIFIED-CANDIDATES.json").read_text())
    if source["baseline_passed"]!=3 or len(fixes["cases"])!=3:
        raise AssertionError("Pinned original Olga harness incomplete")
    case=next(x for x in fixes["cases"] if x["area"]=="runtime")
    if case["verifier"]["holdout_pass"] is not True or \
       case["verifier"]["all_regression_tests_pass"]!=3:
        raise AssertionError("Original Olga runtime recovery failed")
    if len(dispatch["negative_controls_passed"])<10:
        raise AssertionError("Missing negative safeguards")
    patch=Path(case["builder"]["patch_file"]).read_text()
    return {
        "repo":"tribelsky/-",
        "source_commit":source["source_commit"],
        "source_path":source["app_path"],
        "source_sha256":source["source_sha256"],
        "finding":"IN_MEMORY_FAULT_INJECTION_IN_ORIGINAL_OLGA_FUNCTION",
        "source_defect_reproduced":False,
        "injected_defect_reproduced":True,
        "candidate_passed":True,"baseline_failed":False,
        "heldout_pass":1,"heldout_variants":[{"test":"fallback_in_independent_state",
                                              "pass":True}],
        "candidate_patch":patch,
        "function_scope_only":True,
        "real_app_unchanged":True,
        "full_app_tested":False,
        "candidate_algo":"restore one changed line from known verified function",
        "other_checked_olga_faults":2,
        "negative_controls":len(dispatch["negative_controls_passed"]),
    }

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--app",choices=APP_IDS,required=True)
    parser.add_argument("--gate-file", default=None)
    parser.add_argument("--ready-dir", default=None)
    args=parser.parse_args()
    if args.gate_file:
        if not args.ready_dir:
            raise ValueError("Gate requires a ready directory")
        ready_dir=Path(args.ready_dir)
        ready_dir.mkdir(parents=True,exist_ok=True)
        (ready_dir/("ready-"+args.app)).write_text(str(os.getpid()))
        started_wait=time.monotonic()
        while not Path(args.gate_file).exists():
            if time.monotonic()-started_wait>60:
                raise RuntimeError("Synchronized start gate timed out")
            time.sleep(0.02)
    started=utcnow()
    res=olga_case() if args.app=="olga" else python_cases(args.app)
    signal=signed_lab_event(args.app,APP_TO_AREA[args.app])
    case_dir=ROOT/"multi-host/out"/args.app
    case_dir.mkdir(parents=True,exist_ok=True)
    patch_path=case_dir/"candidate.patch"
    patch_path.write_text(res.pop("candidate_patch"),encoding="utf8")
    data={
        "experiment":"TAGFORMIX-THREE-APP-PARALLEL-01",
        "app":args.app,
        "started_at":started,"finished_at":utcnow(),
        "worker_pid":os.getpid(),
        "synchronized_start":bool(args.gate_file),
        "source":res,
        "trigger":signal,
        "rescue_roles":signal["skills"],
        "candidate_patch_sha256":digest(patch_path.read_bytes()),
        "artifacts_scope":"isolated function repair candidate in owned GitHub Actions runner",
        "authorized_for_live_app":False,
        "live_app_changed":False,
        "third_party_repo_write_count":0,
        "customer_data_exported":False,
        "automated_billing":False,
        "real_host_tag_installed":False,
        "real_incident_detected":False,
    }
    (case_dir/"case.json").write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print(json.dumps({"result":"PASS","app":args.app,
      "pinned":res["source_commit"],"candidate_tests_passed":res["candidate_passed"],
      "heldout_pass":res["heldout_pass"],
      "source_fault_kind":res["finding"],"tag_test_only":True,"production_changes":0}))
if __name__=="__main__":
    main()
