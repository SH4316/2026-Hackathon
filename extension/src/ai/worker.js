import { Tokenizer } from "@huggingface/tokenizers";
import { MODEL, MODEL_URL, encodeQuestions, decideScores, splitDocument, strictest } from "./qoamo.js";

const CACHE = `qoamo-${MODEL.revision}`;
let session, tokenizer, config, ort, loading;
const state = (phase, extra = {}) => self.postMessage({ state: { phase, ...extra } });

async function weights() {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(MODEL_URL);
  if (cached) {
    state("loading");
    const bytes = new Uint8Array(await cached.arrayBuffer());
    await verify(bytes);
    return bytes;
  }
  state("downloading", { loaded: 0, total: MODEL.bytes });
  const response = await fetch(MODEL_URL, { credentials: "omit", signal: AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw new Error("local_ai_download");
  const bytes = new Uint8Array(MODEL.bytes);
  const reader = response.body.getReader();
  let offset = 0, lastProgress = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (offset + value.length > bytes.length) throw new Error("local_ai_integrity");
    bytes.set(value, offset);
    offset += value.length;
    if (Date.now() - lastProgress > 300) {
      state("downloading", { loaded: offset, total: MODEL.bytes });
      lastProgress = Date.now();
    }
  }
  if (offset !== MODEL.bytes) throw new Error("local_ai_integrity");
  state("verifying");
  await verify(bytes);
  // Cache only model data, never prompts or predictions. Failure to persist is surfaced.
  await cache.put(MODEL_URL, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
  return bytes;
}

async function verify(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
  if (bytes.length !== MODEL.bytes || hex !== MODEL.sha256) {
    await (await caches.open(CACHE)).delete(MODEL_URL);
    throw new Error("local_ai_integrity");
  }
}

async function prepare() {
  if (session) return;
  if (loading) return loading;
  loading = (async () => {
    state("loading");
    // The built worker sits next to the vendored ORT module. No CDN scripts.
    ort = await import("./ort.wasm.min.mjs");
    ort.env.wasm.wasmPaths = new URL("./", self.location.href).href;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const json = async (name) => {
      const response = await fetch(new URL(`../qoamo/${name}`, self.location.href));
      if (!response.ok) throw new Error("local_ai_assets");
      return response.json();
    };
    const [tok, tokConfig, cfg] = await Promise.all([json("tokenizer.json"), json("tokenizer_config.json"), json("pii_config.json")]);
    tokenizer = new Tokenizer(tok, tokConfig);
    config = cfg;
    const data = await weights();
    state("loading");
    session = await ort.InferenceSession.create(data, {
      executionProviders: ["wasm"], graphOptimizationLevel: "all",
    });
    if (!["input_ids", "position_ids", "block_ids"].every((name) => session.inputNames.includes(name))) {
      await session.release(); session = null;
      throw new Error("local_ai_model_format");
    }
    state("ready");
  })();
  try { await loading; } finally { loading = null; }
}

async function inspect(text) {
  if (!session) throw new Error("local_ai_not_ready");
  if (typeof text !== "string" || text.length > 50000) throw new Error("local_ai_input_too_long");
  if (!text.trim()) return { decision: "allow", tier: "none" };
  const pieces = splitDocument(text);
  const decisions = [];
  for (const piece of pieces) {
    const encoded = encodeQuestions(piece, tokenizer, config);
    const tensor = (values) => new ort.Tensor("int64", BigInt64Array.from(values, BigInt), [1, values.length]);
    const feeds = { input_ids: tensor(encoded.ids), position_ids: tensor(encoded.positions), block_ids: tensor(encoded.blocks) };
    let output;
    try {
      output = await session.run(feeds);
      const logits = output[session.outputNames[0]].data;
      decisions.push(decideScores(logits, encoded, config, piece, pieces.length > 1));
    } finally {
      Object.values(feeds).forEach((t) => t.dispose());
      if (output) Object.values(output).forEach((t) => t.dispose());
    }
  }
  return { ...strictest(decisions), pieces: pieces.length };
}

// Offscreen serializes requests; the worker owns all tensor/model memory.
self.onmessage = async ({ data: { id, type, text } }) => {
  try {
    if (type === "prepare") await prepare();
    const result = type === "inspect" ? await inspect(text) : null;
    self.postMessage({ id, ok: true, data: result });
  } catch (error) {
    const code = /^local_ai_/.test(error.message) ? error.message : type === "prepare" ? "local_ai_load_failed" : "local_ai_failed";
    if (type === "prepare") state("error", { error: code });
    self.postMessage({ id, ok: false, error: code });
  }
};
