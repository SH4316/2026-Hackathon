#!/usr/bin/env node
// Isolated UI verification: every API response below is synthetic.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const { default: AxeBuilder } = await import(
  process.env.AXE_MODULE ||
    new URL(
      "../frontend/node_modules/.guard-tools/node_modules/@axe-core/playwright/dist/index.mjs",
      import.meta.url,
    ).href
);
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    new URL(
      "../frontend/node_modules/.guard-tools/node_modules/playwright/index.mjs",
      import.meta.url,
    ).href
);
const base = process.env.DASHBOARD_URL || "http://127.0.0.1:5174";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = resolve(
  new URL("../backend/build/guard-browser", import.meta.url).pathname,
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const screenshots = [];
const widths = [];
const accessibility = [];
const runtime = {
  model_mode: "optional",
  model_status: "endpoint_unset",
  model_endpoint_set: false,
  model_ready: false,
  modules: { custom_rules: true, context_model: true },
  policy_version: "demo-policy-1",
  ruleset_version: 7,
  org: { managed: true, version_id: "demo-v1", revision: 3 },
};
const rule = {
  id: "project_name",
  label: "데모 프로젝트명",
  category: "custom",
  severity: "high",
  action: "mask",
  token: "PROJECT",
  enabled: true,
  kind: "regex",
  keywords: [],
  pattern: "비공개|기밀",
  reason: "데모 내부 프로젝트",
  distribute: false,
  case_sensitive: false,
};
const judgment = {
  id: "project_plan",
  label: "데모 사업 계획",
  category: "custom",
  severity: "high",
  action: "warn",
  token: "PLAN",
  enabled: true,
  criteria: "아직 공개되지 않은 사업 계획이나 제품 개발 일정을 찾으세요.",
  examples: ["다음 분기 데모 제품 출시 예정입니다."],
  counter_examples: ["이미 발표된 데모 보도자료입니다."],
};
const rules = {
  version: 7,
  modules: runtime.modules,
  custom_rules: [rule],
  context_detectors: [judgment],
  prompt_template: null,
};
const version = {
  id: "demo-v1",
  name: "데모 조직 정책",
  revision: 3,
  status: "PUBLISHED",
  isActive: true,
  createdAt: "2026-10-30T00:00:00Z",
  publishedAt: "2026-10-30T00:00:00Z",
  tags: [],
  policyStates: [],
  jevPrompts: [],
};
const event = {
  id: 9,
  sourceId: "demo",
  eventId: "demo-file",
  versionId: "demo-v1",
  personId: "person_demo",
  personName: "데모 담당자",
  prompt: "첨부한 데모 자료를 검토해 주세요.",
  occurredAt: "2026-10-30T01:00:00Z",
  receivedAt: "2026-10-30T01:00:00Z",
  service: "openai",
  model: "demo-model",
  policyStateId: null,
  policyStateName: null,
  detections: [],
  findingCount: 0,
  sendAction: "forced",
  fileCount: 2,
  imageCount: 1,
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/B0AAAAASUVORK5CYII=",
  "base64",
);
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let unavailable = false;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (unavailable && path.startsWith("/api/v1/guard/"))
      return route.fulfill({
        status: 503,
        json: {
          code: "GUARD_UNAVAILABLE",
          message:
            "검사 서버에 연결할 수 없습니다. 서버 연결과 관리 키 설정을 확인한 뒤 다시 시도해 주세요.",
        },
      });
    let data;
    if (path === "/api/v1/config-versions") data = [version];
    else if (path === "/api/v1/config-versions/demo-v1") data = version;
    else if (path === "/api/v1/guard/runtime") data = runtime;
    else if (path === "/api/v1/guard/ruleset") data = rules;
    else if (path === "/api/v1/guard/prompt")
      data = {
        default_template: "다음 기준으로 판단하세요.\n{detectors}",
        rendered_system_prompt: "데모 사업 계획을 판단하세요.",
      };
    else if (path === "/api/v1/guard/org/settings")
      data = {
        report_text: "full",
        tag_action: "mask",
        jev_enabled: true,
        source_id: "prompt-guard",
        tag_map: { email: "demo-email" },
        policy_state_map: {
          allow: null,
          warn: "demo-review",
          block: "demo-blocked",
        },
      };
    else if (path === "/api/v1/guard/clients")
      data = {
        clients: [
          {
            client_id: "client_demo",
            label: "데모 담당자",
            person_id: "person_demo",
            client_type: "browser_extension",
            device_name: "데모 브라우저",
            last_seen_at: "2026-10-30T01:00:00Z",
            revoked_at: null,
          },
        ],
      };
    else if (path === "/api/v1/people")
      data = {
        items: [
          {
            id: "person_demo",
            name: "데모 담당자",
            eventCount: 0,
            findingCount: 0,
            lastEventAt: null,
          },
        ],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
      };
    else if (path === "/api/v1/events/9") data = event;
    else if (path === "/api/v1/detector-events/9")
      data = {
        files: [{ name: "데모 보고서.docx" }, { name: "데모 이미지.png" }],
        images: [
          {
            id: 3,
            name: "데모 이미지.png",
            media_type: "image/png",
            size_bytes: png.length,
            download_path: "/api/v1/detector-events/9/images/3",
          },
        ],
      };
    else if (path === "/api/v1/detector-events/9/images/3")
      return route.fulfill({
        contentType: "application/octet-stream",
        body: png,
      });
    else if (path === "/api/v1/metrics") data = { versionId: null };
    else
      return route.fulfill({
        status: 404,
        json: { message: "데모 API 경로 없음" },
      });
    return route.fulfill({ json: data, headers: { ETag: '"7"' } });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of ["status", "rules", "jev", "org", "clients"]) {
      await page.goto(`${base}/settings/guard?tab=${tab}`);
      await page.getByRole("tabpanel").waitFor();
      const ready = {
        status: "모델 모드 저장",
        rules: "규칙 저장",
        jev: "판단 저장",
        org: "조직 설정 저장",
        clients: "등록 코드 발급",
      }[tab];
      await page.getByRole("button", { name: ready, exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const axe = await new AxeBuilder({ page })
        .include(".guard-settings")
        .analyze();
      assert.deepEqual(axe.violations, [], `Accessibility violations at ${width}/${tab}`);
      accessibility.push({
        width,
        tab,
        violations: axe.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target }) => target),
        })),
      });
      const overflow = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      widths.push({ width, tab, ...overflow });
      assert(
        overflow.document <= width + 1,
        `Page overflow at ${width}/${tab}`,
      );
      const path = resolve(output, `${tab}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      screenshots.push(path);
    }
    await page.goto(`${base}/events/9`);
    await page.getByRole("img", { name: "데모 이미지.png" }).waitFor();
    await page.getByText("강행 전송", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "원본 다운로드" })
        .getAttribute("href"),
      "/api/v1/detector-events/9/images/3",
    );
    const path = resolve(output, `attachments-${width}.png`);
    await page.screenshot({ path, fullPage: true });
    screenshots.push(path);
    for (const route of ["/", "/settings/jev"]) {
      await page.goto(base + route);
      await page
        .getByText(
          "모델 엔드포인트가 설정되지 않아 Jev 기능이 비활성화되었습니다",
          { exact: false },
        )
        .waitFor();
    }
  }
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/settings/guard?tab=rules`);
    await page
      .getByRole("button", { name: "규칙 저장", exact: true })
      .waitFor();
    const overflow = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    widths.push({ width, tab: "rules", ...overflow });
    assert(overflow.document <= width + 1, `Page overflow at ${width}`);
  }
  unavailable = true;
  await page.goto(`${base}/settings/guard`);
  await page.getByText(/검사 서버에 연결할 수 없습니다/).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "다시 시도" }).count(),
    1,
  );
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    scope: "Synthetic API browser verification; no MySQL or real guard server",
    widths,
    screenshots,
    accessibility,
    errors,
  };
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      widthChecks: widths.length,
      screenshots: screenshots.length,
      errors,
      report: resolve(output, "report.json"),
    }),
  );
} finally {
  await browser.close();
}
