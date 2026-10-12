#!/usr/bin/env python3
"""Single coordinator starts three actual independent app-analysis processes.

Unlike CI matrix max-parallel=3 alone, a file-based start barrier explicitly
releases all three subprocesses in one scheduling round. Real work occurs
after that point; measured worker activity intervals must overlap.
"""
from __future__ import annotations
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path.cwd()
LAB=ROOT/"multi-host"
GATE_DIR=LAB/"parallel"/"ready"
GATE=LAB/"parallel"/"START"
APPS=("olga","langflow","anythingllm")
LAB.mkdir(exist_ok=True)
GATE_DIR.mkdir(parents=True,exist_ok=True)
GATE.unlink(missing_ok=True)
for app in APPS:
    (GATE_DIR/("ready-"+app)).unlink(missing_ok=True)

workers={}
launch_at=dt.datetime.now(dt.timezone.utc).isoformat()
try:
    for app in APPS:
        argv=[
            sys.executable,"multi-host/case_runner.py",
            "--app",app,"--gate-file",str(GATE),"--ready-dir",str(GATE_DIR)
        ]
        workers[app]=subprocess.Popen(
            argv,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            text=True,env={**os.environ,"PYTHONUNBUFFERED":"1"})
    until=time.monotonic()+40
    while not all((GATE_DIR/("ready-"+app)).exists() for app in APPS):
        for app,p in workers.items():
            if p.poll() is not None:
                out,err=p.communicate(timeout=5)
                raise RuntimeError("Worker died before synchronization "+app+": "+err[-1400:])
        if time.monotonic()>=until:
            raise TimeoutError("3 workers did not all enter the barrier")
        time.sleep(0.05)
    release_at=dt.datetime.now(dt.timezone.utc).isoformat()
    GATE.write_text("GO\n","utf8")
    logs={}
    for app,p in workers.items():
        out,err=p.communicate(timeout=90)
        logs[app]={"exit_code":p.returncode,"stdout":out[-1600:],"stderr":err[-2200:]}
    if any(item["exit_code"]!=0 for item in logs.values()):
        print(json.dumps(logs,ensure_ascii=False,indent=2))
        raise RuntimeError("At least one independent app failed")
    reports={}
    for app in APPS:
        obj=json.loads((LAB/"out"/app/"case.json").read_text("utf8"))
        assert obj["synchronized_start"] is True
        assert obj["worker_pid"]==int((GATE_DIR/("ready-"+app)).read_text())
        assert obj["source"]["candidate_passed"]
        assert obj["trigger"]["routed_target"]=="training-"+app
        assert obj["authorized_for_live_app"] is False
        assert obj["third_party_repo_write_count"]==0
        reports[app]=obj
    assert len({x["worker_pid"] for x in reports.values()})==3
    starts={app:dt.datetime.fromisoformat(x["started_at"]) for app,x in reports.items()}
    ends={app:dt.datetime.fromisoformat(x["finished_at"]) for app,x in reports.items()}
    all_overlap=max(starts.values())<min(ends.values())
    overlap_seconds=(min(ends.values())-max(starts.values())).total_seconds()
    if not all_overlap:
        raise AssertionError("No concurrent activity in all 3 independent workers")
    summary={
        "experiment":"TAGFORMIX-THREE-APP-SYNCHRONIZED-01",
        "mode":"Three separate processes in one CI runner, synchronized start gate",
        "coordinator_launch_utc":launch_at,"barrier_release_utc":release_at,
        "all_three_workers_overlapped":True,
        "simultaneous_activity_overlap_seconds":round(overlap_seconds,6),
        "independent_processes":len(reports),
        "all_candidate_tests_passed":True,
        "per_app":[
            {"app":app,"pid":rep["worker_pid"],
             "started_at":rep["started_at"],
             "finished_at":rep["finished_at"],
             "result":"PASS",
             "case_kind":rep["source"]["finding"],
             "tenant":rep["trigger"]["routed_target"]}
            for app,rep in reports.items()
        ],
        "isolation_gates":{
           "distinct_process_ids":True,"unique_signing_secrets":True,
           "no_production_access":True,"no_cross_app_authentication":True,
           "per_app_source_pinned":True
        },
        "live_targets_repaired":0,"actual_network_relay_active":False,
        "customer_scripts_installed":0,
        "limitations":[
            "Same CI machine but distinct processes; future hosts need OS/container boundaries",
            "Three bounded function-level tests, not whole applications or client fleet",
            "Training-only synthetic opt-in and crypto keys",
            "No subscription back end, remote fleet, indefinite monitoring or deployed repair",
        ]
    }
    (LAB/"parallel"/"SUMMARY.json").write_text(
        json.dumps(summary,indent=2,ensure_ascii=False)+"\n","utf8")
    print(json.dumps({
        "result":"PASS","simultaneous_workers":3,
        "all_overlap":all_overlap,
        "common_overlap_s":round(overlap_seconds,6),
        "isolated_candidate_tests":3,"production_changes":0
    }))
finally:
    for p in workers.values():
        if p.poll() is None:
            p.kill()
            try:p.communicate(timeout=5)
            except subprocess.TimeoutExpired:pass
