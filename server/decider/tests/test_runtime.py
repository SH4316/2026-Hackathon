import hashlib
import io
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import download
import model_files
import serve


class FakeModel:
    def __init__(self):
        self.calls = []
        self.error = None
        self.token_count = 4
        self.m = SimpleNamespace(tok=SimpleNamespace(
            encode=lambda text, **kwargs: range(self.token_count + (3 if text.startswith("Context:\n") else 0))))

    def system_one(self, state, questions, **kwargs):
        self.calls.append((state, questions, kwargs))
        if self.error:
            raise self.error
        return {"model": model_files.MODEL_ID,
                "answers": {name: {"type": "noul", "noul": 0.9} for name in questions}}


@pytest.fixture
def model(monkeypatch):
    # The HTTP adapter must be testable without installing Torch or fetching weights.
    sdk = ModuleType("decider")
    systemone = ModuleType("decider.systemone")
    systemone.render_state = json.dumps
    monkeypatch.setitem(sys.modules, "decider", sdk)
    monkeypatch.setitem(sys.modules, "decider.systemone", systemone)
    return FakeModel()


def test_health_waits_for_loaded_model_and_warmup(model):
    app = serve.create_app(lambda: model)
    assert TestClient(app).get("/health").status_code == 503
    with TestClient(app) as client:
        assert len(model.calls) == 1
        assert model.calls[0][1]["warmup"]["type"] == "noul"
        assert client.get("/health").json()["model"] == "Mapika/decider-4b"
        assert client.get("/health").json()["ok"] is True
        assert client.get("/v1/models").json()["models"][0]["name"] == "Mapika/decider-4b"
    assert app.state.model is None


@pytest.mark.parametrize("answer", [
    {"type": "choice", "noul": 0.9}, {"type": "noul", "noul": True},
    {"type": "noul", "noul": float("nan")}, {"type": "noul", "noul": float("inf")},
    {"type": "noul", "noul": -0.1}, {"type": "noul", "noul": 1.1},
])
def test_failed_warmup_prevents_startup(model, answer):
    model.system_one = lambda *args, **kwargs: {"answers": {"warmup": answer}}
    with pytest.raises(RuntimeError, match="warmup"):
        with TestClient(serve.create_app(lambda: model)):
            pass


def test_full_state_and_independent_questions_reach_official_sdk(model):
    payload = {"state": {"document": "전체 입력 끝까지 검사"}, "questions": {
        "secret": {"type": "noul", "instructions": "Does it contain a secret?",
                   "criteria": {"true": "secret", "false": "no secret"}}
    }, "independent": True}
    with TestClient(serve.create_app(lambda: model)) as client:
        response = client.post("/v1/systemone", json=payload)
    assert response.status_code == 200
    assert response.json()["answers"]["secret"]["noul"] == 0.9
    assert model.calls[-1] == (payload["state"], payload["questions"],
                               {"independent": True, "max_state_tokens": 32768})


def test_oversized_context_is_rejected_without_prefix_classification(model):
    with TestClient(serve.create_app(lambda: model)) as client:
        model.token_count = 32769
        response = client.post("/v1/systemone", json={"state": "long input", "questions": {"x": {"type": "noul"}}})
    assert response.status_code == 413
    assert len(model.calls) == 1  # warmup only


@pytest.mark.parametrize("state_tokens,status", [(32765, 200), (32766, 413)])
def test_state_prefix_is_counted_at_sdk_truncation_boundary(model, state_tokens, status):
    with TestClient(serve.create_app(lambda: model)) as client:
        model.token_count = state_tokens
        response = client.post("/v1/systemone", json={"state": "boundary", "questions": {"x": {"type": "noul"}}})
    assert response.status_code == status
    assert len(model.calls) == (2 if status == 200 else 1)


def test_large_chunked_body_and_too_many_questions_are_rejected(model):
    with TestClient(serve.create_app(lambda: model)) as client:
        response = client.post("/v1/systemone", content=iter([b"x" * 131072] * 3))
        assert response.status_code == 413
        response = client.post("/v1/systemone", json={"state": "private", "questions": {str(i): {} for i in range(257)}})
        assert response.status_code == 422
        assert "private" not in response.text
    assert len(model.calls) == 1


@pytest.mark.parametrize("error,expected", [(ValueError("private prompt"), 422), (RuntimeError("private prompt"), 503)])
def test_inference_failures_do_not_echo_or_log_prompt(model, error, expected, caplog):
    with TestClient(serve.create_app(lambda: model)) as client:
        model.error = error
        response = client.post("/v1/systemone", json={"state": "private prompt", "questions": {"x": {"type": "noul"}}})
    assert response.status_code == expected
    assert "private prompt" not in response.text + caplog.text


@pytest.mark.parametrize("layers", ["0", "-1", "12"])
def test_loader_selects_local_pinned_gguf_and_cpu_or_gpu_layers(monkeypatch, model, layers):
    infer = ModuleType("decider.infer")
    captured = {}

    def constructor(path, **kwargs):
        captured.update(path=path, **kwargs)
        return model

    infer.Decider = constructor
    monkeypatch.setitem(sys.modules, "decider.infer", infer)
    monkeypatch.setattr(serve, "verify", lambda: None)
    monkeypatch.setenv("DECIDER_THREADS", "3")
    monkeypatch.setenv("DECIDER_GPU_LAYERS", layers)
    assert serve.load_model() is model
    assert captured["path"] == str(model_files.MODEL_DIR)
    assert captured["gguf_file"] == "decider-4b-v3-Q4_K_M.gguf"
    assert captured["gguf_options"] == {"n_ctx": 40960, "n_seq_max": 1, "n_gpu_layers": int(layers), "n_threads": 3}


@pytest.fixture
def artifact(monkeypatch):
    content = b"small test artifact"
    files = {"weights.gguf": (len(content), hashlib.sha256(content).hexdigest())}
    monkeypatch.setattr(download, "FILES", files)
    monkeypatch.setattr(model_files, "FILES", files)
    return content


def test_offline_cache_reuse_never_requests_network(tmp_path, monkeypatch, artifact):
    (tmp_path / "weights.gguf").write_bytes(artifact)
    monkeypatch.setattr(download.urllib.request, "urlopen", lambda *args, **kwargs: pytest.fail("network used in offline mode"))
    download.prepare(tmp_path, offline=True)
    model_files.verify(tmp_path)


@pytest.mark.parametrize("content", [None, b"invalid"])
def test_offline_missing_or_corrupt_cache_fails_without_network(tmp_path, monkeypatch, artifact, content):
    if content:
        (tmp_path / "weights.gguf").write_bytes(content)
    monkeypatch.setattr(download.urllib.request, "urlopen", lambda *args, **kwargs: pytest.fail("network used in offline mode"))
    with pytest.raises(RuntimeError, match="DECIDER_OFFLINE=true"):
        download.prepare(tmp_path, offline=True)


def test_download_pins_revision_and_verifies_before_atomic_replace(tmp_path, monkeypatch, artifact):
    urls = []

    def fetch(url, **kwargs):
        urls.append(url)
        return io.BytesIO(artifact)

    monkeypatch.setattr(download.urllib.request, "urlopen", fetch)
    download.prepare(tmp_path)
    assert urls == [f"https://huggingface.co/{model_files.MODEL_REPO}/resolve/{model_files.MODEL_REVISION}/weights.gguf"]
    assert (tmp_path / "weights.gguf").read_bytes() == artifact
    assert not list(tmp_path.glob("*.partial"))
    model_files.verify(tmp_path)


def test_wrong_checksum_keeps_previous_cache_and_cleans_partial(tmp_path, monkeypatch, artifact):
    target = tmp_path / "weights.gguf"
    target.write_bytes(b"previous cache")
    monkeypatch.setattr(download.urllib.request, "urlopen", lambda *args, **kwargs: io.BytesIO(b"wrong artifact"))
    with pytest.raises(RuntimeError, match="Checksum mismatch"):
        download.prepare(tmp_path)
    assert target.read_bytes() == b"previous cache"
    assert not list(tmp_path.glob("*.partial"))
