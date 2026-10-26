"""Image text participates in evidence, citations, completion and short-term reuse."""
import copy
import json

import pytest

from siye_ai import research_agent, research_openai
from siye_ai.research_documents import MaterialAccess, SourceReferenceError, answer_document, read_material_section
from tests.fixtures import component, material


def image_note():
    row = material({'key': 'xhs|one', 'result': {'platform': 'xhs', 'title': '只有图才是重点',
        'content_type': 'note', 'url': 'https://www.xiaohongshu.com/explore/one'}})
    row['body'] = component('ok', text='正文只有简短介绍')
    row['comments'] = component('ok', entries=[{'id': 'one', 'text': '评论反馈'}])
    row['ocr'] = component('failed', entries=[{'image': 1, 'text': '图中核心结论：预算 128 元。' * 800},
        {'image': 2, 'text': ''}, {'image': 3, 'text': '第三张图里的补充条件'}], reason='第 2 张识别失败')
    row['ocr']['truncated'] = True
    row['ocr']['metadata'] = {'processed': 3, 'total': 3, 'recognized': 2, 'failed': 1}
    return row


def test_image_text_is_required_keeps_page_indices_and_cannot_be_cited_unread():
    note = image_note()
    access = MaterialAccess([note])
    assert 'ocr' in access.model_coverage()[0]['required_sections']
    access.chunk('S1', 'body', 0)
    with pytest.raises(SourceReferenceError):
        answer_document('图中结论 [S1:ocr]', False, [note], coverage=access.coverage())
    parts = []
    for row in access.pending_reads({}):
        value = read_material_section(access, {}, {}, row['key'], row['section'], row['index'])
        if row['section'] == 'ocr':
            parts.extend(json.loads(value['text']))
    assert {part['image'] for part in parts} == {1, 3}
    assert any(part.get('continued') for part in parts)
    assert access.coverage()[0]['sections']['ocr']['reading_complete']
    assert access.coverage()[0]['sections']['ocr']['collection_truncated']
    document = answer_document('图中结论 [S1:ocr]', False, [note], coverage=access.coverage())
    assert 'https://www.xiaohongshu.com/explore/one' in json.dumps(document)
    restored = MaterialAccess([note])
    restored.restore_cache(access.export_cache(), 100000)
    assert not restored.pending_reads({})
    assert restored.coverage()[0]['sections']['ocr']['cached_chunks'] > 0
    old = image_note()
    old.pop('ocr')
    assert MaterialAccess([old]).parts['xhs|one']['ocr'] == []


@pytest.mark.asyncio
@pytest.mark.parametrize('protocol', ['openai', 'anthropic'])
async def test_both_adapters_cannot_skip_image_text_before_answer(monkeypatch, tmp_path, protocol):
    note = image_note()
    prior = MaterialAccess([note])
    prior.chunk('S1', 'body', 0)
    prior.chunk('S1', 'comments', 0)
    actions = [row for row in prior.pending_reads({}) if row['section'] == 'ocr']
    prompts, functions = [], {}
    if protocol == 'openai':
        async def completion(client, payload, messages, tools, on_text=None):
            prompts.append(copy.deepcopy(messages))
            assert 'ocr' in next(row for row in tools if row['function']['name'] == 'read_material')['function']['parameters']['properties']['section']['enum']
            if len(prompts) == 2:
                pending = json.loads(messages[-1]['content'])['pending_reads']
                assert pending == actions
                message = {'tool_calls': [{'id': str(index), 'type': 'function', 'function': {
                    'name': 'read_material', 'arguments': json.dumps(row)}} for index, row in enumerate(actions)]}
            else:
                message = {'content': '图片的核心文字结论 [S1:ocr]' if len(prompts) > 1 else '只读正文就回答 [S1:body]'}
            return {'choices': [{'message': message}]}
        monkeypatch.setattr(research_openai, 'completion', completion)
    else:
        import claude_agent_sdk as sdk
        def tool(name, description, schema):
            def wrap(function): functions[name] = function; return function
            return wrap
        monkeypatch.setattr(sdk, 'tool', tool)
        monkeypatch.setattr(sdk, 'create_sdk_mcp_server', lambda *args, **kwargs: {})
        class Client:
            def __init__(self, options): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def query(self, prompt): prompts.append(prompt)
            async def receive_response(self):
                if len(prompts) > 1:
                    assert json.loads(prompts[-1])['pending_reads'] == actions
                    for row in actions:
                        await functions['read_material'](row)
                yield sdk.ResultMessage('success', 1, 1, False, 1, 'test', result=(
                    '图片的核心文字结论 [S1:ocr]' if len(prompts) > 1 else '只读正文就回答 [S1:body]'))
        monkeypatch.setattr(sdk, 'ClaudeSDKClient', Client)
    output = await research_agent.run_agent({'protocol': protocol, 'space_name': '研究', 'description': '',
        'materials': [note], 'evidence_cache': prior.export_cache(), 'model': 'test', 'base_url': 'https://example.com',
        'workdir': str(tmp_path)}, lambda _: None)
    assert output['coverage'][0]['sections']['ocr']['reading_complete']
    assert output['coverage'][0]['required_complete']
    assert '[S1:ocr]' in json.dumps(output['document'])
    assert '只读正文就回答' not in json.dumps(output['document'], ensure_ascii=False)
