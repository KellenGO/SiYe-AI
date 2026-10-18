"""Completion requires all primary content and finishes started text sections."""

import copy
import json

import pytest

from siye_ai import research_agent, research_openai
from siye_ai.research_documents import (
    CHUNK_SIZE, MaterialAccess, ReadingCompletionGuard, ReadingCompletionError,
    IncompleteReadingError, read_material_section,
)
from tests.fixtures import component, material


def materials():
    def row(key, platform, title):
        return material({"key": key, "result": {"platform": platform, "title": title,
            "content_type": "video" if platform == "bilibili" else "note", "url": "https://example.com/" + key}})
    article = row("zhihu|1", "zhihu", "文章")
    article["body"] = component("ok", text="文章原文")
    video = row("bilibili|2", "bilibili", "视频")
    video["body"] = component("ok", text="视频简介" * CHUNK_SIZE)
    video["subtitles"] = component("ok", entries=[{"start": i, "end": i + 1, "text": "讲述" * 400} for i in range(12)])
    video["comments"] = component("ok", entries=[{"id": "one", "text": "评论样本" * 4000}])
    unavailable = row("xhs|3", "xhs", "访问受限")
    unavailable["body"] = component("restricted", reason="访问受限")
    return [article, video, unavailable]


def test_review_plan_uses_video_subtitles_and_ignores_empty_sections_and_optional_comments():
    access = MaterialAccess(materials())
    assert [r["required_section"] for r in access.model_coverage()] == ["body", "subtitles", None]
    initial = access.pending_reads({})
    assert {r["key"] for r in initial} == {"S1", "S2"}
    assert not any(r["section"] == "comments" for r in initial)
    for r in initial:
        read_material_section(access, {}, {}, r["key"], r["section"], r["index"])
    ReadingCompletionGuard().check(access, {})
    assert access.coverage()[1]["sections"]["body"]["read_chunks"] == 0
    assert access.coverage()[1]["sections"]["comments"]["read_chunks"] == 0
    read_material_section(access, {}, {}, "S2", "body", 0)
    with pytest.raises(IncompleteReadingError) as error:
        ReadingCompletionGuard().check(access, {})
    assert all(r["key"] == "S2" and r["section"] == "body" for r in error.value.result["pending_reads"])


def test_incomplete_repairs_are_bounded_without_marking_unread_text_as_read():
    access = MaterialAccess(materials())
    guard = ReadingCompletionGuard()
    for _ in range(2):
        with pytest.raises(IncompleteReadingError):
            guard.check(access, {})
    with pytest.raises(ReadingCompletionError, match="未完成必读"):
        guard.check(access, {})
    assert all(r["read_chunks"] == 0 for r in access.coverage())
    read_material_section(access, {}, {}, "S1", "body", 0)
    with pytest.raises(IncompleteReadingError):
        guard.check(access, {})
    with pytest.raises(ReadingCompletionError):
        guard.check(access, {}, stopped=True)


def test_external_body_must_finish_after_opening_but_search_summaries_are_optional():
    access = MaterialAccess([])
    external = {"one": {"citation": "W1", "chunks": 2, "read_chunks": [0]},
                "two": {"citation": "W2", "chunks": 0, "read_chunks": []}}
    assert access.pending_reads(external) == [{"key": "W1", "section": "body", "index": 1}]
    external["one"]["read_chunks"].append(1)
    ReadingCompletionGuard().check(access, external)


@pytest.mark.asyncio
@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
async def test_both_adapters_reject_early_plain_answer_then_read_all_primary_content(monkeypatch, tmp_path, protocol):
    data = {"protocol": protocol, "materials": materials(), "space_name": "研究", "description": "",
        "base_url": "https://example.com/v1", "model": "test", "workdir": str(tmp_path), "stream": True}
    access = MaterialAccess(data["materials"])
    actions = access.pending_reads({})
    prompts, events, functions = [], [], {}
    if protocol == "openai":
        step = 0
        async def completion(client, payload, messages, tools, on_text=None):
            nonlocal step
            prompts.append(copy.deepcopy(messages))
            step += 1
            message = {"content": "提前回答。" if step == 1 else "基于完整原文的回答 [S1:body] [S2:subtitles]。"}
            if step == 2:
                assert "pending_reads" in messages[-1]["content"]
                message = {"tool_calls": [{"id": str(i), "type": "function", "function": {
                    "name": "read_material", "arguments": json.dumps(r)}} for i, r in enumerate(actions)]}
            elif on_text:
                on_text(message["content"])
            return {"choices": [{"message": message, "finish_reason": "stop"}]}
        monkeypatch.setattr(research_openai, "completion", completion)
    else:
        import claude_agent_sdk as sdk
        def tool(name, description, schema):
            def wrap(function):
                functions[name] = function
                return function
            return wrap
        monkeypatch.setattr(sdk, "tool", tool)
        monkeypatch.setattr(sdk, "create_sdk_mcp_server", lambda *args, **kwargs: {})
        class Client:
            def __init__(self, options):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass
            async def query(self, prompt):
                prompts.append(prompt)
            async def receive_response(self):
                if len(prompts) > 1:
                    assert "pending_reads" in prompts[-1]
                    for r in actions:
                        await functions["read_material"](r)
                yield sdk.ResultMessage("success", 1, 1, False, 1, "test", result=(
                    "提前回答。" if len(prompts) == 1 else "基于完整原文的回答 [S1:body] [S2:subtitles]。"))
        monkeypatch.setattr(sdk, "ClaudeSDKClient", Client)
    output = await research_agent.run_agent(data, events.append)
    assert len(prompts) == (3 if protocol == "openai" else 2)
    assert output["coverage"][0]["sections"]["body"]["reading_complete"]
    assert output["coverage"][1]["sections"]["subtitles"]["reading_complete"]
    assert output["coverage"][1]["sections"]["comments"]["read_chunks"] == 0
    assert "提前回答" not in json.dumps(output["document"], ensure_ascii=False)
    if protocol == "openai":
        streaming = [e["type"] for e in events if e["type"].startswith("delta")]
        assert streaming[:2] == ["delta", "delta_reset"]


@pytest.mark.asyncio
@pytest.mark.parametrize("structured", [False, True])
async def test_repeated_early_finish_stops_without_faking_success(monkeypatch, structured):
    requests = []
    async def completion(client, payload, messages, tools):
        requests.append(copy.deepcopy(messages))
        message = {"content": "没有读完也想回答。"}
        if structured:
            message = {"tool_calls": [{"id": str(len(requests)), "type": "function", "function": {
                "name": "submit_result", "arguments": json.dumps({"sections": [{"kind": "space", "paragraphs": [
                    {"text": "提前提交", "sources": []}]}]})}}]}
        return {"choices": [{"message": message}]}
    monkeypatch.setattr(research_openai, "completion", completion)
    with pytest.raises(ReadingCompletionError):
        await research_openai.run_openai({"materials": materials(), "space_name": "研究", "description": "",
            "base_url": "https://example.com", "model": "test"}, lambda _: None)
    assert len(requests) == 3
    if structured:
        result = json.loads(requests[1][-1]["content"])
        assert "pending_reads" in result and "remaining_submit_attempts" not in result


@pytest.mark.asyncio
async def test_unavailable_sources_do_not_trigger_required_reads(monkeypatch):
    async def completion(*args):
        return {"choices": [{"message": {"content": "当前资料不可读，说明缺口。"}}]}
    monkeypatch.setattr(research_openai, "completion", completion)
    result = await research_openai.run_openai({"materials": [materials()[-1]], "space_name": "研究", "description": "",
        "base_url": "https://example.com", "model": "test"}, lambda _: None)
    assert result["coverage"][0]["read_chunks"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
async def test_partial_subtitle_citation_cannot_finish_before_remaining_chunk(monkeypatch, tmp_path, protocol):
    row = materials()[1]
    parts = MaterialAccess([row]).parts[row["key"]]["subtitles"]
    first = [{"key": "S1", "section": "subtitles", "index": i} for i in range(len(parts) - 1)]
    last = {"key": "S1", "section": "subtitles", "index": len(parts) - 1}
    data = {"protocol": protocol, "materials": [row], "space_name": "视频研究", "description": "",
        "base_url": "https://example.com", "model": "test", "workdir": str(tmp_path)}
    functions, prompts = {}, []
    if protocol == "openai":
        async def completion(client, payload, messages, tools):
            prompts.append(copy.deepcopy(messages))
            step = len(prompts)
            if step in {1, 3}:
                actions = first if step == 1 else [last]
                return {"choices": [{"message": {"tool_calls": [{"id": f"{step}-{i}", "type": "function", "function": {
                    "name": "read_material", "arguments": json.dumps(r)}} for i, r in enumerate(actions)]}}]}
            return {"choices": [{"message": {"content": "视频讲述 [S1:subtitles]。"}}]}
        monkeypatch.setattr(research_openai, "completion", completion)
    else:
        import claude_agent_sdk as sdk
        def tool(name, description, schema):
            def wrap(function):
                functions[name] = function
                return function
            return wrap
        monkeypatch.setattr(sdk, "tool", tool)
        monkeypatch.setattr(sdk, "create_sdk_mcp_server", lambda *args, **kwargs: {})
        class Client:
            def __init__(self, options):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass
            async def query(self, prompt):
                prompts.append(prompt)
            async def receive_response(self):
                for r in (first if len(prompts) == 1 else [last]):
                    await functions["read_material"](r)
                yield sdk.ResultMessage("success", 1, 1, False, 1, "test", result="视频讲述 [S1:subtitles]。")
        monkeypatch.setattr(sdk, "ClaudeSDKClient", Client)
    output = await research_agent.run_agent(data, lambda _: None)
    repair = json.loads(prompts[2][-1]["content"] if protocol == "openai" else prompts[1])
    assert repair["pending_reads"] == [last]
    assert output["coverage"][0]["sections"]["subtitles"]["reading_complete"]
    assert output["coverage"][0]["sections"]["body"]["read_chunks"] == 0
