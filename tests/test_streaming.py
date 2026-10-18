"""Streaming: SSE assembly, tool-call merging and host delta events."""

import json

import pytest

from siye_ai import research_openai
from siye_ai.research_openai import DeltaBuffer, StreamOptionsUnsupported, completion, stream_completion
from tests.fixtures import component, material


def source(text="船班八点出发"):
    item = material({"key": "xhs|one", "result": {"platform": "xhs", "content_id": "one", "title": "攻略",
        "snippet": text, "content_type": "note", "url": "https://www.xiaohongshu.com/one"}})
    item["body"] = component("ok", text=text)
    return item


class FakeResponse:
    def __init__(self, lines=(), status_code=200, body=b"{}"):
        self.status_code = status_code
        self.lines = list(lines)
        self.body = body

    async def aiter_lines(self):
        for line in self.lines:
            yield line

    async def aiter_bytes(self):
        yield self.body


class FakeStream:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, *args):
        return False


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.bodies = []

    def stream(self, method, url, headers=None, json=None):
        self.bodies.append(dict(json or {}))
        return FakeStream(self.responses.pop(0))


def sse(value):
    return "data: " + (value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))


@pytest.mark.asyncio
async def test_stream_assembles_text_tool_calls_and_usage():
    lines = [
        sse({"choices": [{"delta": {"content": "你好"}}]}),
        sse({"choices": [{"delta": {"content": "，先看资料"}}]}),
        "",
        sse({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "type": "function",
            "function": {"name": "read_material", "arguments": "{\"key\": \"S1\","}}]}}]}),
        sse({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": " \"section\": \"body\", \"index\": 0}"}}]},
            "finish_reason": "tool_calls"}]}),
        sse({"choices": [], "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}}),
        "data: [DONE]",
    ]
    deltas = []
    response = await stream_completion(FakeResponse(lines), deltas.append)
    message = response["choices"][0]["message"]
    assert message["content"] == "你好，先看资料"
    assert [piece for piece in deltas] == ["你好", "，先看资料"]
    call = message["tool_calls"][0]
    assert call["id"] == "call_1" and call["function"]["name"] == "read_material"
    assert json.loads(call["function"]["arguments"]) == {"key": "S1", "section": "body", "index": 0}
    assert response["choices"][0]["finish_reason"] == "tool_calls"
    assert response["usage"]["total_tokens"] == 18


@pytest.mark.asyncio
async def test_stream_requests_usage_and_falls_back_when_rejected(monkeypatch):
    monkeypatch.setenv("SIYE_RESEARCH_API_KEY", "test-key")
    client = FakeClient([FakeResponse(status_code=400), FakeResponse([sse({"choices": [{"delta": {"content": "好"}}]}), "data: [DONE]"])])
    payload = {"base_url": "https://example.com/v1", "model": "test"}
    result = await completion(client, payload, [{"role": "user", "content": "hi"}], [], lambda piece: None)
    assert client.bodies[0]["stream"] is True and client.bodies[0]["stream_options"] == {"include_usage": True}
    assert "stream_options" not in client.bodies[1] and client.bodies[1]["stream"] is True
    assert result["choices"][0]["message"]["content"] == "好"


@pytest.mark.asyncio
async def test_completion_without_callback_keeps_plain_json(monkeypatch):
    monkeypatch.setenv("SIYE_RESEARCH_API_KEY", "test-key")
    body = json.dumps({"choices": [{"message": {"content": "普通回答"}, "finish_reason": "stop"}]}).encode()
    client = FakeClient([FakeResponse(body=body)])
    result = await completion(client, {"base_url": "https://example.com", "model": "test"}, [], [])
    assert client.bodies[0]["stream"] is False and result["choices"][0]["message"]["content"] == "普通回答"


@pytest.mark.asyncio
async def test_reasoning_effort_is_dropped_when_rejected(monkeypatch):
    monkeypatch.setenv("SIYE_RESEARCH_API_KEY", "test-key")
    body = json.dumps({"choices": [{"message": {"content": "好"}}]}).encode()
    client = FakeClient([FakeResponse(status_code=400), FakeResponse(body=body)])
    payload = {"base_url": "https://example.com/v1", "model": "test", "reasoning_effort": "high"}
    result = await completion(client, payload, [{"role": "user", "content": "hi"}], [])
    assert client.bodies[0]["reasoning_effort"] == "high"
    assert "reasoning_effort" not in client.bodies[1]
    assert result["choices"][0]["message"]["content"] == "好"


@pytest.mark.asyncio
async def test_reasoning_effort_is_omitted_when_not_configured(monkeypatch):
    monkeypatch.setenv("SIYE_RESEARCH_API_KEY", "test-key")
    client = FakeClient([FakeResponse([sse({"choices": [{"delta": {"content": "好"}}]}), "data: [DONE]"])])
    await completion(client, {"base_url": "https://example.com", "model": "test"}, [], [], lambda piece: None)
    assert "reasoning_effort" not in client.bodies[0]


@pytest.mark.asyncio
async def test_usage_reports_context_tokens(monkeypatch):
    events = []
    async def completion(client, payload, messages, tools, on_text=None):
        return {"choices": [{"message": {"content": "答案是八点出发。"}}],
                "usage": {"prompt_tokens": 3210, "completion_tokens": 12, "total_tokens": 3222}}
    monkeypatch.setattr(research_openai, "completion", completion)
    await research_openai.run_openai({"materials": [source()], "base_url": "https://example.com",
        "model": "test", "space_name": "攻略", "description": ""}, events.append)
    usage = [event for event in events if event["type"] == "usage"]
    assert usage and usage[-1]["context_tokens"] == 3210
    assert usage[-1]["usage"]["total_tokens"] == 3222


def test_delta_buffer_merges_small_chunks():
    events = []
    buffer = DeltaBuffer(events.append, size=6)
    for piece in ["一", "二", "三", "四", "五"]:
        buffer.push(piece)
    buffer.flush()
    assert [event["text"] for event in events] == ["一二三四五"]
    assert all(event["type"] == "delta" for event in events)


@pytest.mark.asyncio
async def test_agent_emits_deltas_for_answer_and_resets_commentary(monkeypatch):
    events = []
    calls = iter([
        {"choices": [{"message": {"content": "我先读一下正文", "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": "read_material",
                "arguments": json.dumps({"key": "S1", "section": "body", "index": 0})}}]}, "finish_reason": "tool_calls"}]},
        {"choices": [{"message": {"content": "船班八点出发 [S1:body]。"}, "finish_reason": "stop"}]},
    ])

    async def completion(client, payload, messages, tools, on_text=None):
        reply = next(calls)
        text = reply["choices"][0]["message"].get("content") or ""
        if on_text and text:
            on_text(text)
        return reply

    monkeypatch.setattr(research_openai, "completion", completion)
    output = await research_openai.run_openai({"materials": [source()], "base_url": "https://example.com",
        "model": "test", "space_name": "攻略", "description": "", "stream": True}, events.append)
    deltas = [event["text"] for event in events if event["type"] == "delta"]
    resets = [index for index, event in enumerate(events) if event["type"] == "delta_reset"]
    assert deltas[0] == "我先读一下正文" and deltas[-1] == "船班八点出发 [S1:body]。"
    assert len(resets) == 1
    assert "href" in json.dumps(output["document"])
    assert output["coverage"][0]["complete"]


@pytest.mark.asyncio
async def test_agent_without_stream_flag_emits_no_delta_events(monkeypatch):
    events = []
    async def completion(client, payload, messages, tools):
        return {"choices": [{"message": {"content": "这是一段不带引用的普通回答。"}, "finish_reason": "stop"}]}
    monkeypatch.setattr(research_openai, "completion", completion)
    await research_openai.run_openai({"materials": [source()], "base_url": "https://example.com", "model": "test",
        "space_name": "攻略", "description": ""}, events.append)
    assert not [event for event in events if event["type"].startswith("delta")]
