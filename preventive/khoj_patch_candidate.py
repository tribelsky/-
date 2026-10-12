#!/usr/bin/env python3
"""Isolated repair candidate for pinned Khoj last-turn conversation history bug.

Original upstream source is read-only. The candidate patch is generated only
as a diff under this owned research branch. No upstream writes.
"""
from __future__ import annotations
import ast
import difflib
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from engine import behavior_khoj, fetch_source, TARGETS

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "candidate_out"
TARGET = TARGETS["07"]
PATH = "src/khoj/processor/conversation/utils.py"

REPLACEMENT = '''def construct_chat_history_for_operator(conversation_history: List[ChatMessageModel], n: int = 6) -> list[AgentMessage]:
    """
    Construct the last n completed user/assistant turns in chronological order.
    Do not include trailing incomplete or orphan assistant messages.
    """
    if n <= 0:
        return []
    completed: list[tuple[AgentMessage, AgentMessage]] = []
    pending_user: Optional[AgentMessage] = None
    for chat in conversation_history:
        if chat.by == "you" and chat.message:
            content = [{"type": "text", "text": chat.message}]
            for file in chat.queryFiles or []:
                content += [{"type": "text", "text": f"## File: {file['name']}\\n\\n{file['content']}"}]
            pending_user = AgentMessage(role="user", content=content)
        elif chat.by == "khoj" and chat.message and pending_user is not None:
            completed.append((pending_user, AgentMessage(role="assistant", content=chat.message)))
            pending_user = None
    return [msg for pair in completed[-n:] for msg in pair]

'''

def load_helper(source: str):
    parsed = ast.parse(source)
    matches = [node for node in parsed.body
               if isinstance(node, ast.FunctionDef)
               and node.name == "construct_chat_history_for_operator"]
    assert len(matches) == 1, "Expected a single upstream helper"
    class AgentMessage:
        def __init__(self, role, content):
            self.role, self.content = role, content
    ns = {"AgentMessage": AgentMessage}
    module = ast.Module(body=[matches[0]], type_ignores=[])
    # Postponed type evaluation by compiling function-only text with future annotations.
    helper_src = "from __future__ import annotations\n" + ast.get_source_segment(source, matches[0])
    exec(compile(helper_src, "<reviewed-isolated-helper>", "exec"), ns)
    return ns["construct_chat_history_for_operator"]

def run():
    source, receipt = fetch_source(TARGET["repo"], TARGET["commit"], PATH)
    start = source.index("\ndef construct_chat_history_for_operator(") + 1
    end = source.index("\ndef construct_tool_chat_history(", start)
    original = source[start:end]
    assert "if len(chat_history) >= n:" in original
    assert "for chat in conversation_history:" in original
    modified = source[:start] + REPLACEMENT + source[end:]
    before = behavior_khoj(source)
    after = behavior_khoj(modified)
    assert before.get("mismatch_reproduced") is True
    assert after.get("mismatch_reproduced") is False

    sut = load_helper(modified)
    fake = lambda by, message, files=None: SimpleNamespace(by=by, message=message, queryFiles=files or [])
    history = [
        fake("khoj", "ORPHAN"),
        fake("you", "OLD"), fake("khoj", "OLD ANSWER"),
        fake("you", "RECENT", [{"name": "note.txt", "content": "fixture only"}]),
        fake("khoj", "RECENT ANSWER"),
        fake("you", "INCOMPLETE")
    ]
    r = sut(history, n=1)
    assert [x.role for x in r] == ["user", "assistant"]
    assert r[0].content[0]["text"] == "RECENT"
    assert r[0].content[1]["text"] == "## File: note.txt\n\nfixture only"
    assert r[1].content == "RECENT ANSWER"
    assert sut(history, n=0) == []
    diff = "".join(difflib.unified_diff(
        source.splitlines(True), modified.splitlines(True),
        fromfile="a/" + PATH, tofile="b/" + PATH
    ))
    assert diff and "completed[-n:]" in diff
    OUT.mkdir(parents=True, exist_ok=True)
    patch=OUT/"khoj-last-turns-candidate.patch"
    patch.write_text(diff,encoding="utf-8")
    report={
        "status":"ISOLATED_CANDIDATE_PASS",
        "issue":"https://github.com/khoj-ai/khoj/issues/1439",
        "source_url":receipt["source_url"],
        "source_sha256":receipt["sha256"],
        "before":before,"after":after,
        "additional_assertions":{
            "orphan_assistant_ignored":True,
            "trailing_incomplete_ignored":True,
            "last_completed_turn_preserved":True,
            "attachment_preserved":True,
            "zero_turns_empty":True
        },
        "patch_sha256":hashlib.sha256(patch.read_bytes()).hexdigest(),
        "upstream_repo_modified":False,
        "full_product_integration_test_passed":False,
        "next_gate":"Khoj native pytest and /operator integration tests on an isolated source checkout."
    }
    (OUT/"REPORT.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:report[k] for k in ["status","upstream_repo_modified","full_product_integration_test_passed"]}))

if __name__=="__main__":
    run()
