import copy

import pytest

from ai_proxy.content import InvalidContent, TextRequest


def test_located_replacements_preserve_long_repeated_message_boundaries():
    repeated = "반복 문장 " * 3000
    body = {"messages": [{"role": "system", "content": "합성 비밀1"},
                         {"role": "assistant", "content": repeated},
                         {"role": "user", "content": "합성 비밀2"}]}
    request = TextRequest(body, "/v1/chat/completions")
    original = request.text
    findings = [{"type": "secret", "action": "mask", "span": {
        "start": original.index(secret), "end": original.index(secret) + len(secret)}}
        for secret in ("비밀1", "비밀2")]
    changes = [{"type": "secret", "token": "[SECRET_1]", "count": 1},
               {"type": "secret", "token": "[SECRET_2]", "count": 1}]
    sanitized = original.replace("비밀1", "[SECRET_1]").replace("비밀2", "[SECRET_2]")
    request.replace(sanitized, findings, changes)
    assert body["messages"] == [{"role": "system", "content": "합성 [SECRET_1]"},
                                {"role": "assistant", "content": repeated},
                                {"role": "user", "content": "합성 [SECRET_2]"}]


def test_same_value_reuses_token_without_moving_emoji_or_multiline_content():
    body = {"messages": [{"content": "😀 합성 비밀\n문장"}, {"content": "합성 비밀\n끝"}]}
    request = TextRequest(body, "/v1/chat/completions")
    original = request.text
    start = original.index("비밀")
    last = original.rindex("비밀")
    findings = [{"type": "secret", "action": "mask", "span": {"start": i, "end": i + 2}}
                for i in (start, last)]
    request.replace(original.replace("비밀", "[SECRET_1]"), findings,
                    [{"type": "secret", "token": "[SECRET_1]", "count": 2}])
    assert body["messages"] == [{"content": "😀 합성 [SECRET_1]\n문장"}, {"content": "합성 [SECRET_1]\n끝"}]


def test_large_ambiguous_replacement_without_spans_is_blocked():
    request = TextRequest({"messages": [{"content": "시작 비밀"}, {"content": "반복 " * 3000},
                                        {"content": "비밀 끝"}]}, "/v1/chat/completions")
    with pytest.raises(InvalidContent):
        request.replace(request.text.replace("비밀", "[SECRET_1]"))


@pytest.mark.parametrize("path,body,expected", [
    ("/v1/chat/completions", {"messages": [{"content": None, "tool_calls": [
        {"id": "keep", "function": {"name": "keep", "arguments": '{"value":"비밀"}'}}]},
        {"role": "tool", "content": "결과", "tool_calls": None}]}, '{"value":"비밀"}\n결과'),
    ("/v1/responses", {"input": [{"type": "function_call", "arguments": '{"value":"비밀"}'},
        {"type": "function_call_output", "output": "결과"}]}, '{"value":"비밀"}\n결과'),
    ("/v1/messages", {"messages": [{"content": [{"type": "tool_use", "name": "keep", "input": {
        "value": "비밀", "nested": ["결과", 1]}}, {"type": "thinking", "thinking": "서명된 값", "signature": "keep"}]}]}, "비밀\n결과"),
])
def test_tool_text_is_filtered_and_structure_is_preserved(path, body, expected):
    before = copy.deepcopy(body)
    request = TextRequest(body, path)
    assert request.text == expected
    request.replace(request.text.replace("비밀", "[SECRET_1]"))
    assert body == _replace_values(before)


def _replace_values(value):
    if isinstance(value, str):
        return value.replace("비밀", "[SECRET_1]")
    if isinstance(value, list):
        return [_replace_values(item) for item in value]
    if isinstance(value, dict):
        return {key: _replace_values(item) for key, item in value.items()}
    return value
