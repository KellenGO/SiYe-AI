import json
import pytest
from siye_ai.research_documents import MaterialAccess, result_document

from tests.fixtures import material, component

def source(identity="one", platform="xhs", text="正文"):
    domains = {"xhs": "www.xiaohongshu.com", "bilibili": "www.bilibili.com", "douyin": "www.douyin.com", "zhihu": "www.zhihu.com"}
    return {"key": f"{platform}|{identity}", "result": {"platform": platform, "content_id": identity,
        "title": "攻略", "snippet": text, "content_type": "note", "url": f"https://{domains[platform]}/{identity}?xsec_token=private"}}

def note_result(ref="xhs|one", kind="space"):
    return {"sections": [{"kind": kind, "title": "发现", "paragraphs": [{"text": "有依据的观点", "sources": [ref]}]}]}

def test_chunked_source_access_tracks_exact_reads_and_drops_tokens():
    item = material(source(text="研究" * 6000))
    item["body"] = component("ok", text="研究" * 6000)
    access = MaterialAccess([item])
    assert "private" not in json.dumps(access.manifest())
    assert not access.coverage()[0]["complete"]
    with pytest.raises(ValueError):
        access.chunk("another-space", "body", 0)
    with pytest.raises(ValueError):
        access.chunk(item["key"], "body", -1)
    for index in range(access.manifest()[0]["chunks"]):
        access.chunk(item["key"], "body", index)
    assert access.coverage()[0]["complete"]


def test_result_keeps_sources_distinct_and_rejects_invented_links():
    item = material(source(text="研究" * 6000))
    item["body"] = component("ok", text="研究" * 6000)
    access = MaterialAccess([item])
    with pytest.raises(ValueError, match="未读取"):
        result_document(note_result(), [item], [], access.coverage(), False)
    access.chunk(item["key"], "body", 0)
    document = result_document(note_result(), [item], [], access.coverage(), False)
    encoded = json.dumps(document, ensure_ascii=False)
    assert "未完整分析" not in encoded and "生成于" not in encoded and "private" not in encoded
    assert "有依据的观点" in encoded and "href" in encoded and not access.coverage()[0]["complete"]
    with pytest.raises(ValueError, match="引用"):
        result_document(note_result("invented"), [item], [], access.coverage(), False)
    external = [{"id": "web|1", "title": "官方", "url": "https://example.com", "level": "仅搜索摘要", "fetched_at": "now"}]
    with pytest.raises(ValueError, match="混淆"):
        result_document(note_result("web|1"), [item], external, access.coverage(), True)
    generated = result_document(note_result("web|1", "web"), [item], external, access.coverage(), True)
    assert "仅搜索摘要" not in json.dumps(generated, ensure_ascii=False)
    assert "https://example.com" in json.dumps(generated)


@pytest.mark.asyncio
async def test_sdk_actual_options_deny_other_tools_and_read_coverage(monkeypatch, tmp_path):
    import claude_agent_sdk as sdk
    from siye_ai.research_agent import run_agent
    captured = {}
    class Client:
        def __init__(self, options):
            captured["options"] = options
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def query(self, prompt):
            captured["prompt"] = json.loads(prompt)
        async def receive_response(self):
            yield sdk.SystemMessage("init", {"tools": ["mcp__research__manifest", "mcp__research__read_material"]})
            result = note_result()
            result["sections"][0]["paragraphs"][0]["sources"] = []
            yield sdk.ResultMessage("success", 1, 1, False, 1, "test", structured_output=result)
    monkeypatch.setattr(sdk, "ClaudeSDKClient", Client)
    payload = {"mode": "analyze", "web_enabled": False, "materials": [material(source())], "workdir": str(tmp_path),
               "model": "test", "base_url": "https://example.com", "space_name": "攻略", "description": "", "conversation": [{"question": "previous", "answer": "context"}]}
    result = await run_agent(payload, lambda event: None)
    options = captured["options"]
    from siye_ai.research_documents import RESEARCH_INSTRUCTIONS
    assert options.system_prompt == RESEARCH_INSTRUCTIONS and options.output_format is None
    assert captured["prompt"]["conversation"] == payload["conversation"]
    assert captured["prompt"]["manifest"][0]["citation"] == "S1"
    assert options.tools == [] and options.setting_sources == [] and options.strict_mcp_config
    guard = options.hooks["PreToolUse"][0].hooks[0]
    for name in ["WebSearch", "WebFetch", "Bash", "Read", "Write", "PowerShell"]:
        assert (await guard({"tool_name": name}, None, None))["hookSpecificOutput"]["permissionDecision"] == "deny"
    stopped = await guard({"tool_name": "mcp__research__read_material"}, None, None)
    assert stopped["continue_"] is False and "停止工具重试" in stopped["stopReason"]
    assert not result["coverage"][0]["complete"]


@pytest.mark.asyncio
async def test_sdk_plain_answer_repairs_citations_and_matches_openai_context(monkeypatch, tmp_path):
    import claude_agent_sdk as sdk
    from siye_ai import research_agent, research_openai
    from siye_ai.research_documents import MaterialAccess, research_context
    functions, prompts = {}, []
    def tool(name, description, schema):
        def wrap(function):
            functions[name] = function
            return function
        return wrap
    monkeypatch.setattr(sdk, "tool", tool)
    monkeypatch.setattr(sdk, "create_sdk_mcp_server", lambda *args, **kwargs: {})
    item = material(source())
    item["body"] = component("ok", text="船班八点出发")
    payload = {"mode": "analyze", "web_enabled": False, "materials": [item], "workdir": str(tmp_path),
        "model": "test", "base_url": "https://example.com", "space_name": "攻略", "description": "交通研究",
        "question": "几点出发", "research_focus": "路线", "conversation": [{"question": "交通", "answer": "旧回答 [S1]"}]}
    class Client:
        def __init__(self, options):
            assert options.system_prompt == research_openai.RESEARCH_INSTRUCTIONS
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def query(self, prompt):
            prompts.append(prompt)
        async def receive_response(self):
            if len(prompts) == 2:
                read = await functions["read_material"]({"key": "xhs|one", "section": "body", "index": 0})
                evidence = json.loads(read["content"][0]["text"])
                assert evidence["citation"] == "S1" and "船班八点出发" in evidence["text"]
            yield sdk.ResultMessage("success", 1, 1, False, 1, "test", result="船班八点出发 [S1]，建议提前到达是我的推断。")
    monkeypatch.setattr(sdk, "ClaudeSDKClient", Client)
    output = await research_agent.run_agent(payload, lambda _: None)
    assert prompts[0] == research_context(payload, MaterialAccess([item]))
    assert "本轮未读取" in prompts[1]
    assert output["coverage"][0]["complete"]
    assert "href" in json.dumps(output["document"])


@pytest.mark.asyncio
async def test_enabled_web_tracks_search_and_partial_page_separately(monkeypatch, tmp_path):
    import claude_agent_sdk as sdk
    from siye_ai import research_agent as module
    functions = {}
    def tool(name, description, schema):
        def wrap(function):
            functions[name] = function
            return function
        return wrap
    monkeypatch.setattr(sdk, "tool", tool)
    monkeypatch.setattr(sdk, "create_sdk_mcp_server", lambda *args, **kwargs: {})
    async def target(url):
        return url, "example.com"
    async def webpage(url):
        return url, "<html><head><title>公开网页</title></head><body>" + "资料" * 8000 + "</body></html>"
    monkeypatch.setattr(module, "public_target", target)
    monkeypatch.setattr(module, "public_get", webpage)
    class Client:
        def __init__(self, options):
            self.options = options
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def query(self, prompt):
            assert self.options.tools == ["WebSearch"]
        async def receive_response(self):
            yield sdk.SystemMessage("init", {"tools": ["WebSearch"]})
            guard = self.options.hooks["PreToolUse"][0].hooks[0]
            assert (await guard({"tool_name": "WebSearch"}, None, None))["hookSpecificOutput"]["permissionDecision"] == "allow"
            assert (await guard({"tool_name": "WebFetch"}, None, None))["hookSpecificOutput"]["permissionDecision"] == "deny"
            await functions["read_material"]({"key": "xhs|one", "section": "body", "index": 0})
            post = self.options.hooks["PostToolUse"][0].hooks[0]
            search_context = await post({"tool_name": "WebSearch", "tool_response": {"results": [{"url": "https://example.com/search-only"}]}}, None, None)
            assert json.loads(search_context["hookSpecificOutput"]["additionalContext"])["external"][0]["citation"] == "W1"
            await functions["read_webpage"]({"url": "https://example.com/page"})
            yield sdk.ResultMessage("success", 1, 1, False, 1, "test", structured_output=note_result("web|2", "web"))
    monkeypatch.setattr(sdk, "ClaudeSDKClient", Client)
    item = material(source())
    item["body"] = component("ok", text="正文")
    result = await module.run_agent({"mode": "analyze", "web_enabled": True, "materials": [item],
        "workdir": str(tmp_path), "model": "test", "base_url": "https://example.com", "space_name": "攻略", "description": ""}, lambda event: None)
    assert result["coverage"][0]["complete"]
    assert result["external_sources"][0]["level"] == "仅搜索摘要"
    assert result["external_sources"][1]["level"] == "网页正文（部分已读）"
    assert "联网补充" not in json.dumps(result["document"], ensure_ascii=False)
    assert "href" in json.dumps(result["document"])

