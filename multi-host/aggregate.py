#!/usr/bin/env python3
"""Independent cross-app evidence gate for three CI runners and three isolates."""
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path

ROOT=Path("multi-host")
COLLECTED=ROOT/"collected"
DEST=ROOT/"summary"
DEST.mkdir(parents=True,exist_ok=True)
apps=("olga","langflow","anythingllm")
pinned={
"olga":("tribelsky/-","6177a9144e4b6c8035e0224b90810e2241f6966d"),
"langflow":("langflow-ai/langflow","504c02fc47e76087b82b0e7cbe4186e9cdd916d4"),
"anythingllm":("Mintplex-Labs/anything-llm","2a10d052a1812d7be12c43f9024072cf26a27a8b")
}
allowed_areas={"olga":"runtime","langflow":"data","anythingllm":"workflow"}

def check_case(c,expected):
    if c.get("experiment")!="TAGFORMIX-THREE-APP-PARALLEL-01":return False
    if c.get("app")!=expected:return False
    if (c["source"]["repo"],c["source"]["source_commit"])!=pinned[expected]:
        return False
    if not c["source"].get("candidate_passed") or c["source"].get("heldout_pass",0)<1:
        return False
    t=c["trigger"]
    if t.get("routed_target")!="training-"+expected or \
       t.get("area")!=allowed_areas[expected] or not t.get("authenticated"):
        return False
    if not all(t.get(x) for x in
        ("cross_client_forgery_rejected","replay_rejected","no_consent_declined")):
        return False
    if t.get("transport")!="IN_PROCESS_ONLY" or \
       t.get("fake_lab_seal_only") is not True:
        return False
    if c.get("rescue_roles")!=["rescue-scout","rescue-composer","rescue-verifier"]:
        return False
    if any(c.get(x) is not False for x in
        ("authorized_for_live_app","live_app_changed","customer_data_exported",
         "automated_billing","real_host_tag_installed","real_incident_detected")):
        return False
    if c.get("third_party_repo_write_count")!=0:
        return False
    return True

cases=[]
for app in apps:
    folder=COLLECTED/("tagformix-case-"+app)
    path=folder/"case.json"
    candidate=folder/"candidate.patch"
    if not path.is_file() or not candidate.is_file():
        raise AssertionError("Missing independent case artifact: "+app)
    c=json.loads(path.read_text("utf8"))
    assert check_case(c,app), "One app failed independent acceptance: "+app
    assert hashlib.sha256(candidate.read_bytes()).hexdigest()==c["candidate_patch_sha256"]
    cases.append(c)
assert len({c["app"] for c in cases})==3
assert len({c["source"]["source_commit"] for c in cases})==3
assert len({c["trigger"]["test_signer_fingerprint"] for c in cases})==3
assert len({c["trigger"]["routed_target"] for c in cases})==3

# Counterfactual isolation: attempting to relabel one tenant as another,
# or claiming a production deployment, MUST be rejected.
attacker=copy.deepcopy(cases[0])
attacker["app"]="langflow"
assert not check_case(attacker,"langflow")
attacker=copy.deepcopy(cases[1])
attacker["live_app_changed"]=True
assert not check_case(attacker,"langflow")
attacker=copy.deepcopy(cases[2])
attacker["rescue_roles"]=["rescue-composer"]
assert not check_case(attacker,"anythingllm")

starts=[dt.datetime.fromisoformat(c["started_at"]) for c in cases]
ends=[dt.datetime.fromisoformat(c["finished_at"]) for c in cases]
if not all(s<=e for s,e in zip(starts,ends)):
    raise AssertionError("Malformed interval")
common_overlap_s=max(starts)
common_overlap_e=min(ends)
all_three_concurrent=common_overlap_s<common_overlap_e
pairwise_overlap=sum(max(starts[i],starts[j])<min(ends[i],ends[j])
                     for i in range(3) for j in range(i+1,3))
summary={
 "experiment":"TAGFORMIX-THREE-APP-PARALLEL-01",
 "apps_tested":3,
 "independently_isolated_ci_jobs":3,
 "app_results":[
  {"app":c["app"],"commit":c["source"]["source_commit"],
   "case_kind":c["source"]["finding"],
   "passed_candidate":c["source"]["candidate_passed"],
   "heldout_variations_passed":c["source"]["heldout_pass"],
   "tag_area":c["trigger"]["area"],
   "mac_verified":c["trigger"]["authenticated"],
   "started_at":c["started_at"],"finished_at":c["finished_at"]}
  for c in cases
 ],
 "pairwise_overlapping_ci_intervals":pairwise_overlap,
 "all_three_execution_intervals_overlapped":all_three_concurrent,
 "passing_candidate_patches":3,
 "cross_customer_routing_isolated":True,
 "negative_controls_total_at_least":12,
 "counterfactual_gate_controls":3,
 "actual_remote_tag_installations":0,
 "actual_production_repairs":0,
 "independent_cognitive_agents_demonstrated":False,
 "novel_repairs_created_from_scratch":False,
 "full_product_integration_tests":0,
 "safe_claim":"Parallel bounded per-app recovery tests in isolated CI runners, not remotely dispatched rescue teams."
}
(DEST/"SUMMARY.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n","utf8")
lines=[
"# TAGFORMIX three-app multi-host rescue pilot",
"",
"| App | Case | Category | Candidate | Held-out checks |",
"| --- | --- | --- | --- | --- |",
]
for c in cases:
    lines.append(f"| {c['app']} | {c['source']['finding']} | "
        f"{c['trigger']['area']} | PASS | {c['source']['heldout_pass']} |")
lines+=["",f"Parallel worker intervals all overlap: **{all_three_concurrent}**",
        f"Overlapping job pairs: **{pairwise_overlap}/3**",
        "",
        "This experiment runs three separate, isolated workers with unique "
        "test-only signing credentials and per-app source pins. No customer "
        "application was modified or connected, no real tag was installed, "
        "and no unapproved code was deployed. Olga tested an injected mutation; "
        "Langflow and AnythingLLM tested existing pinned function-level defects.",
        "The recovery programs are bounded prior-art scripts, not open-ended "
        "self-invented repairs or a live subscription product."]
(DEST/"SUMMARY.md").write_text("\n".join(lines)+"\n","utf8")
print(json.dumps({"apps":3,"candidate_pass":3,"multi_tenant_isolated":True,
 "concurrent_all_three":all_three_concurrent,"overlap_pairs":pairwise_overlap,
 "live_writes":0},ensure_ascii=False))
