"""A cached read is valid only when its exact evidence is in the next prompt."""
import copy
import json

import pytest

from siye_ai import research_agent, research_openai
from siye_ai.research_documents import CACHE_SECONDS, MaterialAccess, ReadingCompletionGuard, research_context
from tests.fixtures import component, material


def source(platform="xhs", kind="note"):
    row = material({"key": f"{platform}|one", "result": {"platform": platform, "title": "资料",
        "content_type": kind, "url": "https://example.com/source"}})
    row.update(body=component("ok", text="原文里的条件与数字 12"),
        comments=component("ok", entries=[{"id": "one", "text": "评论里的反例 34"}]))
    if kind in {"video", "zvideo"}:
        row["subtitles"] = component("ok", entries=[{"start": 0, "end": 10, "text": "视频讲述 56"}])
    return row


def read_required(access):
    for row in access.pending_reads({}):
        access.chunk(row["key"], row["section"], row["index"])


@pytest.mark.parametrize("platform,kind", [("xhs", "video"), ("xhs", "note"), ("douyin", "video"),
    ("douyin", "note"), ("bilibili", "video"), ("zhihu", "answer"), ("zhihu", "article"), ("zhihu", "zvideo")])
def test_platform_reading_requirements(platform, kind):
    access = MaterialAccess([source(platform, kind)])
    assert {r["section"] for r in access.pending_reads({})} == ({"subtitles", "comments"} if kind in {"video", "zvideo"} else {"body", "comments"})
    read_required(access)
    ReadingCompletionGuard().check(access, {})
    assert access.coverage()[0]["required_complete"]


def test_cache_expiry_changes_budget_and_public_id_remapping():
    row = source()
    first = MaterialAccess([row])
    read_required(first)
    cache = first.export_cache(now=100)
    assert "原文" not in json.dumps(cache, ensure_ascii=False)
    restored = MaterialAccess([row])
    restored.restore_cache(cache, 100000, now=101)
    assert restored.pending_reads({}) == []
    assert all(s["cached_chunks"] == 1 for n, s in restored.coverage()[0]["sections"].items() if n != "subtitles")
    assert "原文里的条件与数字 12" in research_context({"space_name": "主题", "description": ""}, restored)
    for changed, budget, now in [(row, 100000, 100 + CACHE_SECONDS), (row, 1, 101), (source("zhihu"), 100000, 101)]:
        access = MaterialAccess([changed])
        access.restore_cache(cache, budget, now=now)
        assert len(access.pending_reads({})) == 2
    changed = copy.deepcopy(row)
    changed["comments"]["entries"][0]["text"] = "评论已更新"
    access = MaterialAccess([changed])
    access.restore_cache(cache, 100000, now=101)
    assert access.pending_reads({}) == [{"key": "S1", "section": "comments", "index": 0}]
    other = source("zhihu")
    access = MaterialAccess([other, row])
    access.restore_cache(cache, 100000, now=101)
    assert {r["key"] for r in access.cached_evidence} == {"S2"}
    corrupt = {**cache, "entries": [{"key": [], "section": {}, "index": 0}, None]}
    MaterialAccess([row]).restore_cache(corrupt, 100000, now=101)


@pytest.mark.asyncio
@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
async def test_followup_reuses_original_evidence_without_tool_calls(monkeypatch, tmp_path, protocol):
    first = MaterialAccess([source()])
    read_required(first)
    prompts = []
    if protocol == "openai":
        async def completion(client, payload, messages, tools, on_text=None):
            prompts.append(messages[1]["content"])
            return {"choices": [{"message": {"content": "回答 [S1:body] [S1:comments]"}}]}
        monkeypatch.setattr(research_openai, "completion", completion)
    else:
        import claude_agent_sdk as sdk
        monkeypatch.setattr(sdk, "create_sdk_mcp_server", lambda *args, **kwargs: {})
        class Client:
            def __init__(self, options): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def query(self, prompt): prompts.append(prompt)
            async def receive_response(self):
                yield sdk.ResultMessage("success", 1, 1, False, 1, "test", result="回答 [S1:body] [S1:comments]")
        monkeypatch.setattr(sdk, "ClaudeSDKClient", Client)
    output = await research_agent.run_agent({"protocol": protocol, "materials": [source()],
        "evidence_cache": first.export_cache(), "space_name": "主题", "description": "", "question": "继续解释",
        "model": "test", "base_url": "https://example.com", "workdir": str(tmp_path)}, lambda _: None)
    assert len(prompts) == 1
    context = json.loads(prompts[0])
    assert len(context["background_evidence"]) == 2
    assert "反例 34" in prompts[0]
    assert output["coverage"][0]["required_complete"]
    assert output["evidence_cache"]["entries"] == first.export_cache()["entries"]


@pytest.mark.asyncio
async def test_provider_context_recovery_keeps_cached_evidence_in_summary(monkeypatch):
    access = MaterialAccess([source()])
    read_required(access)
    requests = []
    async def completion(client, payload, messages, tools, on_text=None):
        requests.append(copy.deepcopy(messages))
        if len(requests) == 1:
            raise research_openai.ContextLimitError("AI 上下文不足")
        if not tools:
            assert "background_evidence" in messages[1]["content"]
            assert "反例 34" in messages[1]["content"]
            text = "原文条件与数字 12 [S1:body]，评论反例 34 [S1:comments]"
        else:
            assert "background_evidence" not in json.loads(messages[1]["content"])
            assert "反例 34" in messages[2]["content"]
            text = "有依据的追问回答 [S1:comments]"
        return {"choices": [{"message": {"content": text}, "finish_reason": "stop"}]}
    monkeypatch.setattr(research_openai, "completion", completion)
    output = await research_openai.run_openai({"materials": [source()], "evidence_cache": access.export_cache(),
        "space_name": "主题", "description": "", "model": "test", "base_url": "https://example.com"}, lambda _: None)
    assert len(requests) == 3 and output["coverage"][0]["required_complete"]
