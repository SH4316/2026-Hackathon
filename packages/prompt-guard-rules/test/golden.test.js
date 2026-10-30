// Python 서버와 같은 판정을 내는지 확인한다.
// 골든 벡터는 server/scripts/export_rules_bundle.py 가 Python 파이프라인으로 만든다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createGuard } from "../src/index.js";

const vectors = JSON.parse(readFileSync(new URL("./golden-vectors.json", import.meta.url), "utf8"));
const guard = createGuard({ today: () => vectors.today });

for (const c of vectors.cases) {
  test(`inspect parity: ${c.name}`, () => {
    assert.deepEqual(guard.inspect(c.text, { destination: c.destination }), c.inspect);
  });
  test(`sanitize parity: ${c.name}`, () => {
    assert.deepEqual(guard.sanitize(c.text, { destination: c.destination }), c.sanitize);
  });
}
