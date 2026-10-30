"""Small HTTP adapter for the official SDK's GGUF system_one implementation.

decider-ai 1.10.0's decider.serve does not support GGUF. This adapter supplies the
same typed decision endpoint using Decider.system_one, with one llama.cpp row at
a time, offline model loading, and no generated text.
"""

from contextlib import asynccontextmanager
import logging
import math
import os
import threading
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from model_files import GGUF_FILE, MODEL_DIR, MODEL_ID, MODEL_REVISION, verify

log = logging.getLogger("decider_runtime")
MAX_STATE_TOKENS = 32768
MAX_BODY_BYTES = 262144
# Pinned GGUF config: plain, state-first. SDK prompt.build truncates this entire
# prefixed string, rather than render_state(state) alone.
STATE_PREFIX = "Context:\n"


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        messages, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > MAX_BODY_BYTES:
                response = JSONResponse(status_code=413, content={"detail": "request body too large"})
                return await response(scope, receive, send)
            messages.append(message)
            if not message.get("more_body", False):
                break
        pending = iter(messages)

        async def replay():
            return next(pending)

        await self.app(scope, replay, send)


def load_model():
    from decider.infer import Decider

    verify()
    threads = int(os.environ.get("DECIDER_THREADS", "4"))
    gpu_layers = int(os.environ.get("DECIDER_GPU_LAYERS", "0"))
    if threads < 1 or gpu_layers < -1:
        raise ValueError("DECIDER_THREADS must be positive and DECIDER_GPU_LAYERS must be -1 or nonnegative")
    require_gpu = os.environ.get("DECIDER_REQUIRE_GPU", "false").lower() == "true"
    if require_gpu and gpu_layers == 0:
        raise ValueError("DECIDER_REQUIRE_GPU=true requires DECIDER_GPU_LAYERS=-1 or a positive count")
    if gpu_layers != 0:
        # GGUF executes in llama.cpp, not Torch. This API discovers available
        # backend devices; a CUDA build alone does not prove GPU access works.
        from llama_cpp import llama_cpp

        if not llama_cpp.llama_supports_gpu_offload():
            raise RuntimeError(
                "GPU offload requested but llama.cpp has no GPU backend available. "
                "Check the CUDA image, NVIDIA driver, Container Toolkit and Compose GPU access."
            )
    # device is used only for Torch-side bookkeeping in the SDK's GGUF path.
    # n_gpu_layers controls inference; verbose exposes actual layer offload logs.
    model = Decider(str(MODEL_DIR), device="cpu", gguf_file=GGUF_FILE,
                    gguf_options={"n_ctx": 40960, "n_seq_max": 1, "n_gpu_layers": gpu_layers,
                                  "n_threads": threads, "verbose": True})
    # The upstream v3 config retains a v2.1 version label; report the actual model ID.
    model.name = MODEL_ID
    return model


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: Any
    questions: dict[str, dict[str, Any]] = Field(min_length=1, max_length=256)
    independent: bool = True


def create_app(loader=load_model) -> FastAPI:
    lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        model = loader()
        # Serving begins only after a real decision verifies the loaded backend.
        result = model.system_one({"text": "The sky is blue."}, {
            "warmup": {"type": "noul", "instructions": "Does the text mention the sky?",
                       "criteria": {"true": "It mentions the sky", "false": "It does not mention the sky"}}
        }, independent=True, max_state_tokens=MAX_STATE_TOKENS)
        answer = result.get("answers", {}).get("warmup", {})
        probability = answer.get("noul")
        if answer.get("type") != "noul" or type(probability) not in (int, float) or not math.isfinite(probability) or not 0 <= probability <= 1:
            raise RuntimeError("Decider warmup did not return a typed decision")
        app.state.model = model
        yield
        app.state.model = None

    app = FastAPI(title="Decider-4B GGUF", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.model = None
    app.add_middleware(BodyLimit)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": [
            {"loc": error["loc"], "type": error["type"], "msg": error["msg"]} for error in exc.errors()
        ]})

    @app.get("/health")
    def health():
        if app.state.model is None:
            raise HTTPException(503, "model is not ready")
        return {"ok": True, "model": MODEL_ID, "revision": MODEL_REVISION, "backend": "llama.cpp",
                "gpu_layers": int(os.environ.get("DECIDER_GPU_LAYERS", "0"))}

    @app.get("/v1/models")
    def models():
        return {"models": [{"name": MODEL_ID, "revision": MODEL_REVISION}]}

    @app.post("/v1/systemone")
    def system_one(body: DecisionRequest):
        from decider.systemone import render_state

        model = app.state.model
        if model is None:
            raise HTTPException(503, "model is not ready")
        # The SDK normally truncates long states. Whole-input classification must
        # fail explicitly instead of silently classifying a prefix.
        with lock:
            try:
                tokens = model.m.tok.encode(STATE_PREFIX + render_state(body.state), add_special_tokens=False)
                if len(tokens) > MAX_STATE_TOKENS:
                    raise HTTPException(413, "state exceeds the model's 32768-token limit")
                return model.system_one(body.state, body.questions, independent=body.independent,
                                        max_state_tokens=MAX_STATE_TOKENS)
            except HTTPException:
                raise
            except (ValueError, KeyError, TypeError, AssertionError):
                raise HTTPException(422, "invalid typed decision request") from None
            except Exception as exc:
                log.error("decider inference failed: %s", type(exc).__name__)
                raise HTTPException(503, "decider inference failed") from None

    return app


app = create_app()
