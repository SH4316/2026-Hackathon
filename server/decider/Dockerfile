# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm AS downloader
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN useradd --system --uid 10001 decider && mkdir /models && chown decider /models
COPY model_files.py download.py ./
USER decider
CMD ["python", "download.py"]

FROM python:3.12-slim-bookworm AS cpu-build
ENV PIP_NO_CACHE_DIR=1 CMAKE_BUILD_PARALLEL_LEVEL=2 \
    CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS -DGGML_CUDA=OFF -DLLAMA_CURL=OFF"
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake pkg-config libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
COPY requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cpu \
    && /opt/venv/bin/pip install --no-binary llama-cpp-python -r /tmp/requirements.txt \
    # The supported GGUF path needs none of the package's flash-linear-attention training dependency.
    && /opt/venv/bin/pip install --no-deps decider-ai==1.10.0 \
    && /opt/venv/bin/python -c "from decider.infer import Decider; from llama_cpp import llama_cpp"

FROM nvidia/cuda:12.8.1-devel-ubuntu24.04@sha256:520292dbb4f755fd360766059e62956e9379485d9e073bbd2f6e3c20c270ed66 AS cuda-build
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 CMAKE_BUILD_PARALLEL_LEVEL=2 \
    CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS -DGGML_CUDA=ON -DLLAMA_CURL=OFF"
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-dev build-essential cmake pkg-config libopenblas-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
COPY requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cpu \
    && /opt/venv/bin/pip install --no-binary llama-cpp-python -r /tmp/requirements.txt \
    && /opt/venv/bin/pip install --no-deps decider-ai==1.10.0 \
    # Importing the CUDA library needs the host driver, which is absent during image builds.
    # GGML_NATIVE=OFF uses the pinned llama.cpp CUDA architecture list without a build-time GPU.
    && /opt/venv/bin/python -c "from decider.infer import Decider; from importlib.metadata import version; assert version('llama-cpp-python') == '0.3.35'"

FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04@sha256:ebef3c171eeef0298e4eb2e4be843105edf3b8b0ac45e0b43acee358e8046867 AS cuda
ENV DEBIAN_FRONTEND=noninteractive PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/tmp/huggingface
RUN apt-get update && apt-get install -y --no-install-recommends python3 libopenblas0-pthread libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 decider && mkdir /models && chown decider /models
COPY --from=cuda-build /opt/venv /opt/venv
WORKDIR /app
COPY model_files.py serve.py ./
USER decider
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

FROM python:3.12-slim-bookworm AS cpu
ENV PATH="/opt/venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/tmp/huggingface
RUN apt-get update && apt-get install -y --no-install-recommends libopenblas0-pthread libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 decider && mkdir /models && chown decider /models
COPY --from=cpu-build /opt/venv /opt/venv
WORKDIR /app
COPY model_files.py serve.py ./
USER decider
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
