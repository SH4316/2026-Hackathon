// Port of the pinned model's _encode / ask / decide. No remote Python code is executed.
export const MODEL = Object.freeze({
  id: "atonlee/Qoamo-PII-Decision",
  revision: "a7650cb1186f65c506dd2a7b3d80c3b6bade85e0",
  file: "onnx/model_int8.onnx",
  bytes: 265651170,
  sha256: "6fb4826c3806b2ce0c310ab926be108c29959e4be19d978bf393516c8f460791",
});
export const MODEL_URL = `https://huggingface.co/${MODEL.id}/resolve/${MODEL.revision}/${MODEL.file}`;
export const QUESTIONS = ["pii_any", "pii_t1", "pii_tier"];

export function encodeQuestions(text, tokenizer, config) {
  const encode = (s) => tokenizer.encode(s, { add_special_tokens: false }).ids;
  // The tokenizer post-processor uses </s>, while its vocab names token 1 <\s>.
  // These are the pinned Python tokenizer's empty-input IDs, not cls_token_id=5.
  const ids = [0, ...encode(config.state_prefix + text)];
  const start = ids.length;
  const positions = Array.from({ length: start }, (_, i) => i);
  const blocks = Array(start).fill(-1);
  const markers = [];
  const markerId = tokenizer.token_to_id(config.marker);
  QUESTIONS.forEach((name, b) => {
    const q = config.questions[name];
    const options = q.option_lines.map((line) => `${config.marker} ${line}`).join("\n");
    const block = [...encode(`\n질문: ${q.instructions}\n${options}`), 1];
    const selected = [];
    block.forEach((id, i) => {
      if (id === markerId) selected.push(ids.length + i);
    });
    if (selected.length !== q.options.length) throw new Error("local_ai_encoding");
    markers.push(selected);
    ids.push(...block);
    positions.push(...block.map((_, i) => start + i));
    blocks.push(...block.map(() => b));
  });
  if (ids.length > 4096) throw new Error("local_ai_input_too_long");
  return { ids, positions, blocks, markers };
}

function softmax(values) {
  if (!values.every(Number.isFinite)) throw new Error("local_ai_output");
  const max = Math.max(...values);
  const exp = values.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
}
const top = (p) => Object.keys(p).reduce((a, b) => p[b] > p[a] ? b : a);
const confidence = (p) => {
  const values = Object.values(p);
  return (values.length * Math.max(...values) - 1) / (values.length - 1);
};

export function decideScores(logits, encoded, config, text, document = false) {
  const scores = Object.fromEntries(QUESTIONS.map((name, i) => {
    const probs = softmax(encoded.markers[i].map((idx) => Number(logits[idx]) / config.temperature));
    return [name, Object.fromEntries(config.questions[name].options.map((opt, j) => [opt, probs[j]]))];
  }));
  const any = scores.pii_any, strong = scores.pii_t1, tiers = scores.pii_tier;
  const tier = top(tiers);
  const limits = config.route[document ? "document" : /[가-힣]/.test(text) ? "ko" : "en"];
  let decision = "warn";
  if (any["아니오"] > any["예"] && confidence(any) > limits.tau
      && tier === "none" && confidence(tiers) > limits.tier_conf) decision = "allow";
  else if ((strong["예"] >= strong["아니오"] && confidence(strong) > config.route.block_above)
      || (tier === "tier1" && confidence(tiers) > config.route.block_above)) decision = "block";
  return { decision, tier, scores };
}

// Bound quadratic attention memory and inspect every character. Overlap protects values
// crossing a split; no offsets are claimed because this is document classification.
export function splitDocument(text, limit = 1000, overlap = 160) {
  const chars = Array.from(text);
  const pieces = [];
  for (let start = 0; start < chars.length;) {
    const end = Math.min(start + limit, chars.length);
    pieces.push(chars.slice(start, end).join(""));
    if (end === chars.length) break;
    start = end - overlap;
  }
  return pieces;
}

export function strictest(results) {
  const rank = { allow: 0, warn: 1, block: 2 };
  const tiers = { none: 0, tier2: 1, tier1: 2 };
  return results.reduce((a, b) => ({
    decision: rank[b.decision] > rank[a.decision] ? b.decision : a.decision,
    tier: tiers[b.tier] > tiers[a.tier] ? b.tier : a.tier,
  }), { decision: "allow", tier: "none" });
}
