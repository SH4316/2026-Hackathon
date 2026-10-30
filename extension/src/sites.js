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
];

PG.isSendButton = (btn) => {
  if (PG.SEND_SELECTORS.some((sel) => btn.matches(sel))) return true;
  return btn.matches('button[type="submit"], input[type="submit"]') && !!btn.form;
};

// 입력창 근처(같은 form 또는 조상 몇 단계)에서 전송 버튼을 찾는다.
PG.findSendButton = (editor) => {
  let node = editor;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    for (const sel of [...PG.SEND_SELECTORS, 'button[type="submit"]']) {
      const btn = node.querySelector(sel);
      if (btn) return btn;
    }
  }
  return null;
};
