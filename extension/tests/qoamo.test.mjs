import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Tokenizer } from "@huggingface/tokenizers";
import { encodeQuestions, decideScores, splitDocument, strictest } from "../src/ai/qoamo.js";
const json = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const tokenizer = new Tokenizer(json("../vendor/qoamo/tokenizer.json"), json("../vendor/qoamo/tokenizer_config.json"));
const config = json("../vendor/qoamo/pii_config.json");
const reference = json("./qoamo-reference.json");

for (const [i, fixture] of reference.fixtures.entries()) {
  test(`Python/Rust tokenizer and native ONNX parity fixture ${i + 1}`, () => {
    const encoded = encodeQuestions(fixture.text, tokenizer, config);
    for (const key of ["ids", "positions", "blocks"]) {
      const hash = createHash("sha256").update(JSON.stringify(encoded[key])).digest("hex");
      assert.equal(hash, fixture.hashes[key], key);
    }
    assert.deepEqual(encoded.markers, fixture.markers);
    const logits = new Float32Array(encoded.ids.length);
    encoded.markers.flat().forEach((idx, j) => { logits[idx] = fixture.logits[j]; });
    const result = decideScores(logits, encoded, config, fixture.text);
    assert.equal(result.decision, fixture.decision);
    assert.equal(result.tier, fixture.tier);
  });
}
test("long-document chunks retain boundaries and supplementary characters", () => {
  const text = "가".repeat(980) + "😀901023-1234567" + "나".repeat(2000);
  const chunks = splitDocument(text);
  assert.ok(chunks.some((s) => s.includes("😀901023-1234567")));
  assert.ok(chunks.every((s) => Array.from(s).length <= 1000 && s.isWellFormed()));
  assert.equal(chunks[0] + chunks.slice(1).map((s) => Array.from(s).slice(160).join("")).join(""), text);
  assert.equal(strictest([{ decision: "allow", tier: "none" }, { decision: "block", tier: "tier1" }, { decision: "warn", tier: "tier2" }]).decision, "block");
});
test("invalid numerical output cannot become allow", () => {
  const encoded = encodeQuestions("test", tokenizer, config);
  assert.throws(() => decideScores(new Float32Array(encoded.ids.length).fill(NaN), encoded, config, "test"), /local_ai_output/);
});
