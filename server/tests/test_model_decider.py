"""Decider 의 실제 typed HTTP 계약을 모의한다. 모델 가중치나 생성형 응답은 사용하지 않는다."""

import asyncio
import json

import httpx
import pytest

from app.detection.model import ContextModelDetector, ModelUnavailable, parse_decider_output
from app.registry.schema import ContextDetector


def detector(handler, api="decider", model="Mapika/decider-4b"):
    return ContextModelDetector(api, "http://decider:8000/", model, 10, 2,
                                transport=httpx.MockTransport(handler))


def response(scores):
    return {"model": "decider-4b-v3", "answers": {tag: {"type": "noul", "noul": score}
                                                for tag, score in scores.items()},
            "usage": {"input_tokens": 20, "output_tokens": 0}}


def context(id="research", **overrides):
    return ContextDetector(id=id, label="미공개 연구", token="RESEARCH", criteria="아직 공개하지 않은 연구 결과",
                           examples=["새 촉매 결과는 논문 투고 전이다"],
                           counter_examples=["공개 논문을 요약해 줘"], **overrides)


@pytest.mark.parametrize("body,expected", [
    ({"ok": True, "model": "Mapika/decider-4b"}, True),
    ({"ok": False, "model": "Mapika/decider-4b"}, False),
    ({"ok": 1, "model": "Mapika/decider-4b"}, False),
    ({"ok": True, "model": "another-model"}, False),
    ({"ok": True}, False),
    (["bad"], False),
])
def test_readiness_uses_health_and_exact_model_without_inference(body, expected):
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(200, json=body)

    assert asyncio.run(detector(handler).ready()) is expected
    assert calls == [("GET", "/health")]


def test_readiness_http_failure_is_false():
    assert asyncio.run(detector(lambda _: httpx.Response(503)).ready()) is False


def test_judge_uses_independent_noul_questions_and_explicit_whole_input_scope():
    calls = []

    def handler(request):
        calls.append(request)
        payload = json.loads(request.content)
        assert request.method == "POST" and request.url.path == "/v1/systemone"
        assert payload["state"] == {"document": "실험😀 결과는 미공개야"}
        assert payload["independent"] is True
        assert set(payload["questions"]) == {"research", "public"}
        for tag, name in {"research": "미공개 연구", "public": "공개 정보"}.items():
            question = payload["questions"][tag]
            assert question["type"] == "noul" and "state.document" in question["instructions"]
            assert "조직 판정 기준" in question["instructions"]
            assert question["criteria"]["true"] == name
        return httpx.Response(200, json=response({"research": 0.91, "public": 0.12, "unknown": 1}))

    out = asyncio.run(detector(handler).judge("실험😀 결과는 미공개야", "조직 판정 기준",
                                              {"research": "미공개 연구", "public": "공개 정보"}))
    assert [(s.tag_id, s.score, s.spans, s.whole_input) for s in out] == [
        ("research", 0.91, (), True), ("public", 0.12, (), True)]
    assert len(calls) == 1


@pytest.mark.parametrize("bad", [None, [], {}, {"answers": []}, {"answers": {}},
    {"answers": {"research": {"type": "choice", "noul": 0.9}}},
    {"answers": {"research": {"type": "noul"}}},
    *[{"answers": {"research": {"type": "noul", "noul": s}}}
      for s in [True, "0.9", -0.1, 1.1, 10 ** 1000, float("nan"), float("inf"), -float("inf")]],
])
def test_invalid_or_missing_answer_fails_instead_of_becoming_a_negative(bad):
    with pytest.raises(ModelUnavailable, match="invalid decider output"):
        parse_decider_output(bad, {"research"})


def test_partial_answer_fails_even_if_one_tag_is_valid():
    with pytest.raises(ModelUnavailable):
        parse_decider_output(response({"research": 0.9}), {"research", "public"})


@pytest.mark.parametrize("status", [413, 422, 500, 503])
def test_http_failure_does_not_echo_document(status):
    model = detector(lambda _: httpx.Response(status, json={"detail": "private document"}))
    with pytest.raises(ModelUnavailable) as exc:
        asyncio.run(model.judge("private document", "기준", {"research": "미공개 연구"}))
    assert str(exc.value) == "HTTPStatusError"


def test_timeout_is_model_failure():
    def handler(request):
        raise httpx.ReadTimeout("private document", request=request)

    with pytest.raises(ModelUnavailable, match="ReadTimeout"):
        asyncio.run(detector(handler).judge("private document", "기준", {"research": "미공개 연구"}))


def test_context_detection_classifies_full_input_at_half_and_respects_enabled():
    text = "연구😀 결과"

    def handler(request):
        questions = json.loads(request.content)["questions"]
        assert set(questions) == {"research", "public"}
        assert "사용자 기준" in questions["research"]["instructions"]
        assert "미공개 연구" in questions["research"]["instructions"]
        assert questions["research"]["criteria"]["true"]["examples"] == ["새 촉매 결과는 논문 투고 전이다"]
        return httpx.Response(200, json=response({"research": 0.5, "public": 0.4999}))

    hits = asyncio.run(detector(handler).detect(text, [context(), context("public"), context("disabled", enabled=False)],
                                               "사용자 기준\n{detectors}"))
    [hit] = hits
    assert (hit.type, hit.start, hit.end, hit.detector) == ("research", 0, len(text), "model")
    assert "입력 전체 분류 0.50" in hit.reason


def test_empty_inputs_outputs_and_disabled_detectors_skip_http():
    def unexpected(_):
        pytest.fail("empty classification must not execute HTTP")

    model = detector(unexpected)
    assert asyncio.run(model.judge("", "기준", {"research": "연구"})) == []
    assert asyncio.run(model.judge("문장", "기준", {})) == []
    assert asyncio.run(model.detect("", [context()])) == []
    assert asyncio.run(model.detect("문장", [])) == []
    assert asyncio.run(model.detect("문장", [context(enabled=False)])) == []
    assert asyncio.run(detector(unexpected, model="").ready()) is False


@pytest.mark.parametrize("api,path,body", [
    ("ollama", "/api/chat", {"message": {"content": '{"results":[{"tag_id":"research","score":0.9,"text":"연구"}]}'}}),
    ("openai", "/v1/chat/completions", {"choices": [{"message": {"content": '{"results":[{"tag_id":"research","score":0.9,"text":"연구"}]}'}}]}),
])
def test_existing_chat_adapters_keep_extracted_spans(api, path, body):
    def handler(request):
        assert request.url.path == path
        return httpx.Response(200, json=body)

    [score] = asyncio.run(detector(handler, api=api).judge("새 연구", "기준", {"research": "연구"}))
    assert score.spans == ((2, 4),) and score.whole_input is False


@pytest.fixture
def runtime_detector(monkeypatch):
    """실제 Decider HTTP 검증/본문 제한을 사용하고 추론 가중치만 대체한다."""
    from pathlib import Path
    from types import ModuleType, SimpleNamespace
    import sys

    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "decider"))
    import serve

    sdk = ModuleType("decider")
    systemone = ModuleType("decider.systemone")
    systemone.render_state = json.dumps
    monkeypatch.setitem(sys.modules, "decider", sdk)
    monkeypatch.setitem(sys.modules, "decider.systemone", systemone)
    model = SimpleNamespace(m=SimpleNamespace(tok=SimpleNamespace(encode=lambda *a, **kw: [1])))
    model.system_one = lambda state, questions, **kw: response({tag: 0.9 for tag in questions})
    app = serve.create_app()
    app.state.model = model
    transport = httpx.ASGITransport(app=app)
    calls = []

    async def handler(request):
        calls.append(request)
        return await transport.handle_async_request(request)

    return detector(handler), calls


@pytest.mark.parametrize("count,expected_batches", [(256, 1), (257, 2), (1000, 4)])
def test_judge_batches_question_count_against_runtime(runtime_detector, count, expected_batches):
    model, calls = runtime_detector
    outputs = {f"tag_{i}": f"태그 {i}" for i in range(count)}
    scores = asyncio.run(model.judge("전체 입력😀", "판정 기준", outputs))
    assert len(calls) == expected_batches
    assert [score.tag_id for score in scores] == list(outputs)
    assert all(score.score == 0.9 and score.whole_input for score in scores)
    assert all(len(json.loads(call.content)["questions"]) <= 256 for call in calls)
    assert all(json.loads(call.content)["state"] == {"document": "전체 입력😀"} for call in calls)


@pytest.mark.parametrize("text,prompt", [
    ("입력 전체😀", "판" * 12000),
    ('문서😀"\\\n\x00' * 3000, '기준😀"\\\n\x00' * 1500),
], ids=["korean_12000", "json_escaping"])
def test_judge_batches_actual_utf8_json_bytes_without_truncation(runtime_detector, text, prompt):
    model, calls = runtime_detector
    outputs = {f'tag_{i}😀"\\\n': f"태그 {i}" for i in range(8)}
    scores = asyncio.run(model.judge(text, prompt, outputs))
    assert len(calls) > 1
    assert [score.tag_id for score in scores] == list(outputs)
    seen = []
    for call in calls:
        assert len(call.content) <= 262144
        assert call.headers["content-type"] == "application/json"
        payload = json.loads(call.content)
        assert payload["state"] == {"document": text}
        assert payload["independent"] is True
        for tag, question in payload["questions"].items():
            seen.append(tag)
            assert question["instructions"].startswith(prompt + "\n")
            assert question["criteria"]["true"] == outputs[tag]
    assert seen == list(outputs)


def test_context_detection_also_batches_large_criteria(runtime_detector):
    model, calls = runtime_detector
    contexts = [ContextDetector(id=f"context_{i}", label="기준", token="CONTEXT", criteria="비공개 자료 검사",
                                examples=["예" * 300] * 20, counter_examples=["아" * 300] * 20)
                for i in range(5)]
    hits = asyncio.run(model.detect("연구😀 결과", contexts))
    assert len(calls) > 1
    assert [hit.type for hit in hits] == [item.id for item in contexts]
    assert all((hit.start, hit.end) == (0, len("연구😀 결과")) for hit in hits)


@pytest.mark.parametrize("text,questions", [
    ("\x00" * 50000, {"research": {"type": "noul"}}),
    ("private document", {"small": {"type": "noul"}, "large": {"instructions": "private" * 50000}}),
], ids=["escaped_state", "large_second_question"])
def test_single_oversized_question_fails_before_http_without_echo(text, questions):
    def unexpected(_):
        pytest.fail("oversized single question must be rejected before any HTTP")

    with pytest.raises(ModelUnavailable, match="request body limit") as exc:
        asyncio.run(detector(unexpected)._decide(text, questions))
    assert "private" not in str(exc.value)


def test_exact_body_limit_is_accepted_and_one_extra_byte_rejected(runtime_detector):
    model, calls = runtime_detector
    questions = {"limit": {"type": "noul", "instructions": ""}}
    payload = {"state": {"document": "문서😀"}, "questions": questions, "independent": True}
    overhead = len(httpx.Request("POST", "http://decider/v1/systemone", json=payload).content)
    questions["limit"]["instructions"] = "x" * (262144 - overhead)
    assert asyncio.run(model._decide("문서😀", questions)) == {"limit": 0.9}
    assert len(calls) == 1 and len(calls[0].content) == 262144
    questions["limit"]["instructions"] += "x"
    with pytest.raises(ModelUnavailable, match="request body limit"):
        asyncio.run(model._decide("문서😀", questions))
    assert len(calls) == 1


@pytest.mark.parametrize("failure", ["http", "missing", "timeout"])
def test_later_batch_failure_does_not_return_partial_scores(failure):
    calls = []

    def handler(request):
        questions = json.loads(request.content)["questions"]
        calls.append(questions)
        if len(calls) == 1:
            return httpx.Response(200, json=response({tag: 0.1 for tag in questions}))
        if failure == "timeout":
            raise httpx.ReadTimeout("private document", request=request)
        if failure == "http":
            return httpx.Response(503, json={"detail": "private document"})
        return httpx.Response(200, json=response({}))

    with pytest.raises(ModelUnavailable) as exc:
        asyncio.run(detector(handler).judge("private document", "기준", {f"tag_{i}": "태그" for i in range(257)}))
    assert len(calls) == 2
    assert "private" not in str(exc.value)
