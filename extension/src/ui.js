// 상태 배지와 경고 화면. 사이트 CSS 와 섞이지 않도록 Shadow DOM 안에 그린다.
// 사용자 텍스트는 항상 textContent 로만 넣는다(innerHTML 사용 금지).
var PG = (globalThis.PG = globalThis.PG || {});

(() => {
  const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; }
.root {
  --bg: #ffffff; --fg: #1d1d1f; --muted: #5f6368; --line: #e3e3e8; --soft: #f5f5f7;
  --red: #c62828; --red-bg: #fdecea; --yellow: #a15c00; --yellow-bg: #fff4e0;
  --green: #1b7f3b; --green-bg: #e7f5ec; --gray: #5f6368; --gray-bg: #eef0f2;
  --mark-block: #f8c4c0; --mark-mask: #ffd8a8; --mark-warn: #ffeaa0; --mark-allow: #d6e4ff;
  --primary: #1a5fd0; --primary-fg: #fff;
}
@media (prefers-color-scheme: dark) {
  .root {
    --bg: #1f2023; --fg: #ececf1; --muted: #a0a4ab; --line: #34363b; --soft: #2a2b2f;
    --red: #ff8a80; --red-bg: #3a1f1e; --yellow: #ffcc80; --yellow-bg: #3a2e1a;
    --green: #81c995; --green-bg: #1e3326; --gray: #b0b4ba; --gray-bg: #2c2e33;
    --mark-block: #7a2e2a; --mark-mask: #7a4f1f; --mark-warn: #6b5a14; --mark-allow: #2a3f6b;
    --primary: #8ab4f8; --primary-fg: #10131a;
  }
}
.badge {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line);
  box-shadow: 0 4px 16px rgba(0,0,0,.15); font-size: 13px; cursor: pointer; user-select: none;
}
.badge[hidden] { display: none; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--gray); flex: none; }
.badge[data-state="green"] .dot { background: var(--green); }
.badge[data-state="yellow"] .dot { background: #f2a600; }
.badge[data-state="red"] .dot { background: var(--red); }
.badge[data-state="checking"] .dot { animation: pulse 1s infinite ease-in-out; }
@keyframes pulse { 50% { opacity: .3; } }

.overlay {
  position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.card {
  width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto;
  background: var(--bg); color: var(--fg); border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,.35); font-size: 14px; line-height: 1.5;
}
.head { display: flex; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid var(--line); }
.icon {
  width: 36px; height: 36px; border-radius: 50%; flex: none; display: grid; place-items: center;
  font-weight: 700; font-size: 18px;
}
.head[data-tone="red"] .icon { background: var(--red-bg); color: var(--red); }
.head[data-tone="yellow"] .icon { background: var(--yellow-bg); color: var(--yellow); }
.head[data-tone="green"] .icon { background: var(--green-bg); color: var(--green); }
.head[data-tone="gray"] .icon { background: var(--gray-bg); color: var(--gray); }
.title { font-size: 16px; font-weight: 700; margin: 0 0 2px; }
.sub { color: var(--muted); font-size: 13px; margin: 0; }
.body { padding: 14px 20px; display: grid; gap: 14px; }
.section-title { font-size: 12px; font-weight: 700; color: var(--muted); margin: 0 0 6px; letter-spacing: .02em; }
.preview {
  white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto;
  background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px;
  font-size: 13px;
}
mark { color: inherit; border-radius: 3px; padding: 0 1px; }
mark[data-action="block"] { background: var(--mark-block); }
mark[data-action="mask"] { background: var(--mark-mask); }
mark[data-action="warn"] { background: var(--mark-warn); }
mark[data-action="allow"] { background: var(--mark-allow); }
ul.findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
ul.findings li {
  display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: baseline;
  padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
}
.chip { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.chip[data-action="block"] { background: var(--red-bg); color: var(--red); }
.chip[data-action="mask"] { background: var(--yellow-bg); color: var(--yellow); }
.chip[data-action="warn"] { background: var(--yellow-bg); color: var(--yellow); }
.chip[data-action="allow"] { background: var(--gray-bg); color: var(--gray); }
.fname { font-weight: 600; }
.fmeta { grid-column: 2; color: var(--muted); font-size: 12px; }
.notice { background: var(--soft); border-radius: 8px; padding: 8px 12px; font-size: 13px; color: var(--muted); }
.notice p { margin: 0; }
.ack { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; }
.foot {
  display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; align-items: center;
  padding: 12px 20px 16px; border-top: 1px solid var(--line);
}
.fine { flex: 1 1 100%; color: var(--muted); font-size: 12px; margin: 0 0 4px; }
button {
  font: inherit; font-size: 14px; border-radius: 8px; padding: 8px 14px; cursor: pointer;
  border: 1px solid var(--line); background: var(--bg); color: var(--fg);
}
button.primary { background: var(--primary); color: var(--primary-fg); border-color: var(--primary); font-weight: 600; }
button.danger { color: var(--red); border-color: var(--red); }
button:disabled { opacity: .45; cursor: not-allowed; }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.loading { padding: 28px 20px; text-align: center; color: var(--muted); }
`;

  let host, shadow, rootEl, badgeEl, overlayEl, lastFocus;

  function ensureRoot() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.id = "pg-root-host";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    rootEl = document.createElement("div");
    rootEl.className = "root";
    shadow.append(style, rootEl);
    document.documentElement.append(host);
  }

  // 작은 DOM 빌더: h("div", {class: "x", onclick}, "text", child)
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // ── 배지 ──
  const BADGE_TEXT = {
    checking: "Prompt Guard · 검사 중",
    green: "Prompt Guard · 통과",
    yellow: "Prompt Guard · 확인 필요",
    red: "Prompt Guard · 민감정보 있음",
    gray: "Prompt Guard · 검사 불가",
  };

  function setBadge(state, onClick) {
    ensureRoot();
    if (!badgeEl) {
      badgeEl = h("div", { class: "badge", role: "status", "aria-live": "polite" },
        h("span", { class: "dot" }), h("span", { class: "label" }));
      rootEl.append(badgeEl);
    }
    badgeEl.hidden = false;
    badgeEl.dataset.state = state;
    badgeEl.querySelector(".label").textContent = BADGE_TEXT[state];
    badgeEl.onclick = onClick || null;
    badgeEl.title = onClick ? "자세히 보기" : "";
  }

  function hideBadge() {
    if (badgeEl) badgeEl.hidden = true;
  }

  // ── 모달 공통 ──
  function openModal(card) {
    ensureRoot();
    closeModal();
    lastFocus = document.activeElement;
    overlayEl = h("div", { class: "overlay", role: "dialog", "aria-modal": "true" }, card);
    overlayEl.addEventListener("keydown", (e) => {
      e.stopPropagation(); // 사이트 단축키로 새지 않게
      if (e.key === "Escape") closeModal();
    });
    rootEl.append(overlayEl);
    (card.querySelector("button.primary") || card.querySelector("button"))?.focus();
  }

  function closeModal() {
    overlayEl?.remove();
    overlayEl = null;
    if (lastFocus?.isConnected) lastFocus.focus();
    lastFocus = null;
  }

  function header(tone, icon, title, sub) {
    return h("div", { class: "head", dataset: { tone } },
      h("div", { class: "icon", "aria-hidden": "true" }, icon),
      h("div", null, h("p", { class: "title" }, title), sub && h("p", { class: "sub" }, sub)));
  }

  function destinationLine(dest) {
    if (!dest) return null;
    const name = PG.PROVIDER_LABELS[dest.provider] || dest.provider;
    return `대상: ${name} · ${PG.TIER_LABELS[dest.tier] || dest.tier} 기준 적용`;
  }

  function preview(text, findings) {
    const box = h("div", { class: "preview" });
    let pos = 0;
    const sorted = [...findings].sort((a, b) => a.span.start_utf16 - b.span.start_utf16);
    for (const f of sorted) {
      const { start_utf16: s, end_utf16: e } = f.span;
      if (s < pos) continue;
      box.append(text.slice(pos, s));
      box.append(h("mark", { dataset: { action: f.action }, title: PG.TYPE_LABELS[f.type] || f.type },
        text.slice(s, e)));
      pos = e;
    }
    box.append(text.slice(pos));
    return box;
  }

  function findingList(findings) {
    return h("ul", { class: "findings" }, findings.map((f) =>
      h("li", null,
        h("span", { class: "chip", dataset: { action: f.action } }, PG.ACTION_LABELS[f.action] || f.action),
        h("span", { class: "fname" }, PG.TYPE_LABELS[f.type] || f.type),
        h("span", { class: "fmeta" },
          [f.reason, PG.CONFIDENCE_LABELS[f.confidence]].filter(Boolean).join(" · ")))));
  }

  function notices(codes, extra) {
    const lines = [...(extra ? [extra] : []), ...(codes || []).map((c) => PG.NOTICE_LABELS[c] || c)];
    if (!lines.length) return null;
    return h("div", { class: "notice" }, lines.map((l) => h("p", null, l)));
  }

  const FINE = "판정은 현재 조직 정책 기준이며 안전을 보장하지 않습니다. 검사 서버는 원문을 저장하지 않습니다.";

  // ── 경고 화면 ──
  // opts: { text, result?, error?, onSanitize, onSendAnyway, onRetry }
  function showWarning(opts) {
    const { text, result, error } = opts;

    if (!result) {
      openModal(h("div", { class: "card" },
        header("gray", "!", "검사를 완료하지 못해 전송을 보류했습니다", PG.errorLabel(error)),
        h("div", { class: "body" },
          notices(null, "검사 서버가 정상일 때 다시 시도하세요. 검사 없이 자동으로 전송하지 않습니다.")),
        h("div", { class: "foot" },
          h("button", { onclick: closeModal }, "닫기"),
          h("button", { class: "primary", onclick: opts.onRetry }, "다시 검사"))));
      return;
    }

    const findings = result.findings || [];
    const relevant = findings.filter((f) => f.action !== "allow");
    const hasBlock = findings.some((f) => f.action === "block");
    const canSanitize = !hasBlock && findings.some((f) => f.action === "mask" || f.action === "warn");
    const incomplete = result.status !== "complete";
    const canSendAnyway = !incomplete && result.decision === "warn";

    let tone, icon, title;
    if (incomplete) [tone, icon, title] = ["gray", "!", "검사가 완료되지 않아 전송을 보류했습니다"];
    else if (result.decision === "block") [tone, icon, title] = ["red", "✕", "민감정보가 있어 이대로 보낼 수 없습니다"];
    else [tone, icon, title] = ["yellow", "!", "보내기 전에 확인이 필요합니다"];

    const summary = relevant.length
      ? `${relevant.length}개 항목이 발견되었습니다.`
      : "탐지된 항목은 없지만 전송 대상의 정책상 확인이 필요합니다.";

    const ack = canSendAnyway
      ? h("label", { class: "ack" },
          h("input", { type: "checkbox", onchange: (e) => { sendBtn.disabled = !e.target.checked; } }),
          "내용을 확인했고, 이 텍스트를 외부 AI에 보내는 것에 동의합니다.")
      : null;
    const sendBtn = canSendAnyway
      ? h("button", { class: "danger", disabled: true, onclick: () => { closeModal(); opts.onSendAnyway(); } },
          "확인 후 전송")
      : null;

    openModal(h("div", { class: "card" },
      header(tone, icon, title, [summary, destinationLine(result.destination)].filter(Boolean).join(" ")),
      h("div", { class: "body" },
        h("div", null, h("p", { class: "section-title" }, "입력 내용"), preview(text, findings)),
        findings.length ? h("div", null, h("p", { class: "section-title" }, "탐지 항목"), findingList(findings)) : null,
        notices(result.notices,
          hasBlock ? "치환으로 해결되지 않는 항목이 있습니다. 해당 내용을 직접 지우거나 승인된 경로를 이용하세요." : null),
        result.destination?.basis
          ? h("p", { class: "sub" }, `대상 정책 근거: ${result.destination.basis}`) : null,
        ack),
      h("div", { class: "foot" },
        h("p", { class: "fine" }, FINE),
        h("button", { onclick: closeModal }, "돌아가서 수정"),
        incomplete ? h("button", { onclick: opts.onRetry }, "다시 검사") : null,
        sendBtn,
        canSanitize ? h("button", { class: "primary", onclick: opts.onSanitize }, "민감정보 치환하기") : null)));
  }

  function showLoading(message) {
    openModal(h("div", { class: "card" }, h("div", { class: "loading" }, message)));
  }

  // ── 정제 결과 화면 ──
  // opts: { result?, error?, onApply, onApplyAndSend, onBack }
  function showSanitized(opts) {
    const { result, error } = opts;
    if (!result) {
      openModal(h("div", { class: "card" },
        header("gray", "!", "정제하지 못했습니다", PG.errorLabel(error)),
        h("div", { class: "foot" },
          h("button", { onclick: closeModal }, "닫기"),
          h("button", { class: "primary", onclick: opts.onBack }, "이전으로"))));
      return;
    }
    const pass = result.status === "complete" && result.decision === "allow";
    const remaining = result.remaining_findings || [];
    const [tone, icon, title] = pass
      ? ["green", "✓", "치환 후 재검사를 통과했습니다"]
      : ["yellow", "!", "치환했지만 아직 확인이 필요합니다"];
    const changes = (result.changes || []).map((c) =>
      `${PG.TYPE_LABELS[c.type] || c.type} → ${c.token}${c.count > 1 ? ` (${c.count}곳)` : ""}`);

    openModal(h("div", { class: "card" },
      header(tone, icon, title, destinationLine(result.destination)),
      h("div", { class: "body" },
        h("div", null, h("p", { class: "section-title" }, "치환된 내용"),
          preview(result.sanitized_text || "", remaining)),
        changes.length
          ? h("div", null, h("p", { class: "section-title" }, "바뀐 항목"),
              h("ul", { class: "findings" }, changes.map((c) => h("li", null, h("span", { class: "fname" }, c)))))
          : null,
        remaining.length
          ? h("div", null, h("p", { class: "section-title" }, "남은 항목"), findingList(remaining)) : null,
        notices(result.notices,
          "수치·이름이 토큰으로 바뀌어 답변 품질이 달라질 수 있습니다. 원래 값은 저장되지 않아 자동 복원되지 않습니다.")),
      h("div", { class: "foot" },
        h("p", { class: "fine" }, FINE),
        h("button", { onclick: opts.onBack }, "이전으로"),
        h("button", { class: pass ? null : "primary", onclick: () => { closeModal(); opts.onApply(); } },
          "입력창에 반영"),
        pass ? h("button", { class: "primary", onclick: () => { closeModal(); opts.onApplyAndSend(); } },
          "반영하고 전송") : null)));
  }

  PG.ui = { setBadge, hideBadge, showWarning, showSanitized, showLoading, closeModal,
            isOpen: () => !!overlayEl };
})();
