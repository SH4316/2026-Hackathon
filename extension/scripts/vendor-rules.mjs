// packages/prompt-guard-rules 를 확장프로그램 안(vendor/)으로 복사한다.
// 확장프로그램은 번들러 없이 폴더째 로드되므로 폴더 밖 패키지를 import 할 수 없다.
//   node scripts/vendor-rules.mjs           복사
//   node scripts/vendor-rules.mjs --check   복사본이 최신인지 확인(다르면 종료 코드 1)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.resolve(ROOT, "../packages/prompt-guard-rules");
const DEST = path.join(ROOT, "vendor", "prompt-guard-rules");
const DIRS = ["src", "data"];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)).map((f) => path.join(e.name, f)) : [e.name]);
}

const check = process.argv.includes("--check");
let stale = false;
for (const d of DIRS) {
  for (const rel of files(path.join(SRC, d))) {
    const from = path.join(SRC, d, rel);
    const to = path.join(DEST, d, rel);
    if (check) {
      if (!fs.existsSync(to) || !fs.readFileSync(from).equals(fs.readFileSync(to))) {
        console.error(`다름: vendor/prompt-guard-rules/${d}/${rel}`);
        stale = true;
      }
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}
if (check) {
  console.log(stale ? "vendor 복사본이 오래되었습니다: npm run vendor" : "vendor 복사본이 최신입니다.");
  process.exit(stale ? 1 : 0);
}
console.log("vendor/prompt-guard-rules 갱신 완료");
