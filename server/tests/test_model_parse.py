import pytest

from app.detection.model import ModelUnavailable, parse_model_output

ALLOWED = {"internal_project": "내부 프로젝트 정보"}


def test_only_spans_present_in_text_are_kept():
    text = "프로젝트 블루문 결과는 미공개"
    out = parse_model_output(
        '{"findings":[{"type":"internal_project","text":"블루문"},'
        '{"type":"internal_project","text":"없는문자열"},{"type":"bogus","text":"결과"}]}', text, ALLOWED)
    assert [(c.type, text[c.start:c.end]) for c in out] == [("internal_project", "블루문")]


@pytest.mark.parametrize("content", ["not json", '{"x":1}', '{"findings":"no"}'])
def test_invalid_output_raises(content):
    with pytest.raises(ModelUnavailable):
        parse_model_output(content, "text", ALLOWED)
