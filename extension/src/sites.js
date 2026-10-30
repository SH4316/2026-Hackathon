// 사이트 → 전송 목적지, 전송 버튼 찾기
var PG = (globalThis.PG = globalThis.PG || {});

// 브라우저는 사용자의 요금제·계약(Team, Enterprise, ZDR 등)을 알 수 없으므로 모두 consumer 로 보낸다.
// 서버는 이 값을 분류로만 쓰고, 정책을 완화하지 않는다.
PG.SITES = [
  { hosts: ["chatgpt.com", "chat.openai.com"], provider: "openai" },
  { hosts: ["claude.ai"], provider: "anthropic" },
  { hosts: ["gemini.google.com"], provider: "google" },
  { hosts: ["copilot.microsoft.com"], provider: "microsoft" },
  { hosts: ["chat.deepseek.com"], provider: "deepseek" },
  { hosts: ["www.kimi.com", "kimi.com"], provider: "moonshot" },
  { hosts: ["chat.mistral.ai"], provider: "mistral" },
  { hosts: ["www.perplexity.ai"], provider: "perplexity" },
  { hosts: ["grok.com"], provider: "xai" },
  { hosts: ["chat.qwen.ai"], provider: "alibaba" },
  { hosts: ["www.meta.ai"], provider: "meta" },
];

// 사이트별 AI 답변 영역 선택자(토큰 복원용). 사이트 개편 시 여기만 고친다.
// 테스트 페이지(localhost)는 [data-pg-assistant] 를 쓴다.
PG.RESPONSE_SELECTORS = {
  openai: ['[data-message-author-role="assistant"]'],
  anthropic: ["[data-is-streaming]", '[class*="font-claude"]'],
  google: ["message-content", ".model-response-text"],
  microsoft: ['[data-content="ai-message"]'],
  deepseek: [".ds-markdown"],
  perplexity: ['[class*="prose"]'],
  xai: ['[class*="message-bubble"]'],
  mistral: ['[data-message-author-role="assistant"]'],
  moonshot: [".markdown", '[class*="segment-assistant"]'],
  alibaba: ['[class*="assistant"]'],
  meta: ['[data-testid*="assistant"]'],
};

PG.responseSelectors = () => {
  if (PG.isTestHost()) return ["[data-pg-assistant]"];
  const d = PG.resolveDestination();
  return (d && PG.RESPONSE_SELECTORS[d.provider]) || [];
};

PG.isTestHost = () => ["localhost", "127.0.0.1"].includes(location.hostname);

PG.resolveDestination = () => {
  if (PG.isTestHost()) {
    // 로컬 테스트 페이지 전용: <html data-pg-test-destination="openai/consumer">
    const v = document.documentElement.dataset.pgTestDestination || "";
    const [provider, channel] = v.split("/");
    return provider ? { provider, channel: channel || "consumer" } : null;
  }
  const site = PG.SITES.find((s) => s.hosts.includes(location.hostname));
  return site ? { provider: site.provider, channel: "consumer" } : null;
};

// 사이트별 전송 버튼 후보. 사이트 DOM 은 자주 바뀌므로 넓은 후보를 둔다.
PG.SEND_SELECTORS = [
  '[data-testid="send-button"]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="Submit" i]',
  'button[aria-label*="전송"]',
  'button[aria-label*="보내기"]',
  'button[aria-label*="메시지 보내기"]',
  'button[aria-label*="제출"]',
  // <button> 이 아닌 전송 버튼(예: Kimi 의 div.send-button-container)
  ".send-button-container",
  '[class~="send-button"]',
];

// 클릭 가로채기 대상: 일반 버튼 + 버튼 요소가 아닌 전송 버튼 후보
PG.clickTargetSelector = () =>
  ['button', '[role="button"]', 'input[type="submit"]', ...PG.SEND_SELECTORS].join(", ");

/** 진단용: 버튼이 어떤 선택자로 전송 버튼으로 인식됐는지 */
PG.matchSendSelector = (btn) =>
  PG.SEND_SELECTORS.find((sel) => btn.matches(sel)) ||
  (btn.matches('button[type="submit"], input[type="submit"]') ? 'button[type="submit"]' : "인식 안 됨");

PG.isSendButton = (btn) => {
  if (PG.SEND_SELECTORS.some((sel) => btn.matches(sel))) return true;
  return btn.matches('button[type="submit"], input[type="submit"]') && !!btn.form;
};

// 입력창이 속한 form 전체, 그다음 가까운 조상부터 넓혀 가며 보이는 전송 버튼을 찾는다.
// (ChatGPT 처럼 입력창과 전송 버튼이 깊게 떨어진 구조도 있다)
PG.findSendButton = (editor) => {
  const visible = (el) => el.getClientRects().length > 0;
  const scopes = [];
  const form = editor.closest("form");
  if (form) scopes.push(form);
  for (let node = editor, depth = 0; node && depth < 14; depth++, node = node.parentElement) scopes.push(node);
  for (const scope of scopes) {
    for (const sel of [...PG.SEND_SELECTORS, 'button[type="submit"]']) {
      const btn = [...scope.querySelectorAll(sel)].find(visible);
      if (btn) return btn;
    }
  }
  return null;
};
