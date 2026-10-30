# Qoamo model assets

Source: https://huggingface.co/atonlee/Qoamo-PII-Decision
Revision: `a7650cb1186f65c506dd2a7b3d80c3b6bade85e0` (pinned).
License: Apache-2.0; the upstream LICENSE is included.

`tokenizer.json`, `tokenizer_config.json`, `pii_config.json` are unmodified upstream files.
`src/ai/qoamo.js` adapts upstream `modeling_qoamo.py` encoding, temperature calibration,
and decision thresholds to JavaScript. The browser uses the three core questions only.
Long inputs use 1,000-character chunks with 160-character overlap for bounded browser memory,
instead of upstream's non-overlapping 2,000-character document split.

The weight file is not committed: `onnx/model_int8.onnx`, 265,651,170 bytes.
SHA-256: `6fb4826c3806b2ce0c310ab926be108c29959e4be19d978bf393516c8f460791`.
Download and cache happen in the extension on explicit AI enablement.

`ONNXRUNTIME-LICENSE` is the MIT license from microsoft/onnxruntime tag v1.31.1.
The build copies this and the npm Tokenizers.js license alongside the bundled runtime.

`tests/qoamo-reference.json` contains synthetic fixtures produced with Python's Rust-backed
`tokenizers` and native `onnxruntime` using this exact INT8 model and the upstream encoding /
decision rules. Tests compare input IDs, positions, block IDs, option markers and decisions.
