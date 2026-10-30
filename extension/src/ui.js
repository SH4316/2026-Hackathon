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
/* ── SafePrompt 위젯: 입력창 위에 붙는 신호등. 색은 BRAND_GUIDELINES.md 의 토큰을 따른다. ── */
.badge {
  /* 다크(기본): Deep Navy */
  --w-bg: #0F172A; --w-fg: #E2E8F0; --w-mut: #94A3B8; --w-line: #1E293B; --w-line2: #334155; --w-soft: #131D33;
  --w-blue: #3B82F6; --w-blue-fg: #FFFFFF;
  --w-red: #EF4444; --w-red-fg: #FCA5A5; --w-red-bg: rgba(239,68,68,.14);
  --w-amber: #F59E0B; --w-amber-fg: #FCD34D; --w-amber-bg: rgba(245,158,11,.14);
  --w-green: #10B981; --w-green-fg: #6EE7B7; --w-green-bg: rgba(16,185,129,.14);
  --w-cyan: #06B6D4; --w-cyan-fg: #67E8F9; --w-cyan-bg: rgba(6,182,212,.14);
  --w-send: #059669; --w-dim: .22;
  position: fixed; z-index: 2147483646; display: grid; gap: 8px; padding: 10px 12px;
  background: var(--w-bg); color: var(--w-fg); border: 1px solid var(--w-line2); border-radius: 14px;
  box-shadow: 0 8px 28px rgba(15,23,42,.35); font-size: 13px; line-height: 1.45;
}
@media (prefers-color-scheme: light) {
  .badge {
    /* 라이트: Light Alabaster */
    --w-bg: #F8FAFC; --w-fg: #0F172A; --w-mut: #475569; --w-line: #E2E8F0; --w-line2: #CBD5E1; --w-soft: #FFFFFF;
    --w-blue: #2563EB;
    --w-red-fg: #B91C1C; --w-amber-fg: #92400E; --w-green-fg: #047857; --w-cyan-fg: #0E7490;
    --w-dim: .28;
  }
}
.badge[hidden], .badge [hidden] { display: none !important; }
.badge[data-state="red"] { border-color: var(--w-red); }
.badge[data-state="yellow"] { border-color: var(--w-amber); }
.badge[data-state="green"] { border-color: var(--w-green); }
.badge .reason { font-size: 11px; color: var(--w-mut); }
.badge .reason:empty { display: none; }
.badge .wrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.badge .brand { display: inline-flex; align-items: center; gap: 8px; background: var(--w-soft); border: 1px solid var(--w-line2); border-radius: 999px; padding: 4px 10px; font-weight: 700; }
.badge .lamps { display: inline-flex; gap: 5px; padding-left: 8px; border-left: 1px solid var(--w-line2); }
.badge .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--w-mut); opacity: var(--w-dim); transition: opacity .15s, box-shadow .15s; }
.badge .dot.r { background: var(--w-red); } .badge .dot.y { background: var(--w-amber); } .badge .dot.g { background: var(--w-green); }
.badge[data-state="red"] .dot.r { opacity: 1; box-shadow: 0 0 8px var(--w-red); }
.badge[data-state="yellow"] .dot.y { opacity: 1; box-shadow: 0 0 8px var(--w-amber); }
.badge[data-state="green"] .dot.g { opacity: 1; box-shadow: 0 0 8px var(--w-green); }
.badge[data-state="gray"] .dot { background: var(--w-mut); opacity: .6; }
.badge[data-state="checking"] .dot { background: var(--w-mut); opacity: .7; animation: pulse 1s infinite ease-in-out; }
@keyframes pulse { 50% { opacity: .25; } }
.badge .chip-w { margin-left: auto; border: 1px solid var(--w-line2); border-radius: 8px; padding: 3px 9px; font-weight: 600; font-size: 12.5px; background: transparent; color: var(--w-fg); cursor: default; font-family: inherit; }
.badge .chip-w[data-clickable] { cursor: pointer; }
.badge[data-state="red"] .chip-w { border-color: var(--w-red); color: var(--w-red-fg); background: var(--w-red-bg); }
.badge[data-state="yellow"] .chip-w { border-color: var(--w-amber); color: var(--w-amber-fg); background: var(--w-amber-bg); }
.badge[data-state="green"] .chip-w { border-color: var(--w-green); color: var(--w-green-fg); background: var(--w-green-bg); }
.badge .pbox { display: grid; gap: 4px; }
.badge .phead { font-size: 11.5px; color: var(--w-green-fg); }
.badge .pbody { border: 1px solid var(--w-line2); border-radius: 10px; padding: 8px 10px; background: var(--w-soft); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12.5px; max-height: 120px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
.badge .tk { background: var(--w-cyan-bg); border: 1px solid var(--w-cyan); color: var(--w-cyan-fg); border-radius: 5px; padding: 0 3px; }
.badge .pnote { font-size: 11.5px; color: var(--w-mut); }
.badge .wnotice { font-size: 12px; border-radius: 8px; padding: 5px 9px; background: var(--w-soft); border: 1px solid var(--w-line2); color: var(--w-fg); }
.badge .wnotice[data-tone="warn"] { background: var(--w-amber-bg); border-color: var(--w-amber); color: var(--w-amber-fg); }
.badge .acts { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; align-items: center; }
.badge button { border: 0; border-radius: 9px; padding: 7px 13px; font-weight: 700; color: #fff; background: var(--w-line2); }
.badge button:disabled { opacity: .45; cursor: not-allowed; }
.badge button.b-san { background: var(--w-blue); color: var(--w-blue-fg); }
.badge button.b-send { background: var(--w-send); }
.badge button.linkbtn { background: none; color: var(--w-mut); font-weight: 500; padding: 4px 6px; text-decoration: underline; font-size: 12px; }
.badge button:focus-visible { outline: 2px solid var(--w-blue); outline-offset: 2px; }
.badge.shake { animation: shake .3s; }
@keyframes shake { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
@media (prefers-reduced-motion: reduce) { .badge .dot, .badge.shake { animation: none; transition: none; } }

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
.diag {
  position: fixed; top: 12px; right: 12px; z-index: 2147483646; width: 340px;
  background: var(--bg); color: var(--fg); border: 2px dashed #f2a600; border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.18); font-size: 12px; line-height: 1.45; padding: 10px 12px;
}
.diag[hidden] { display: none; }
.diag h3 { margin: 0 0 6px; font-size: 13px; }
.diag dl { display: grid; grid-template-columns: 74px 1fr; gap: 3px 8px; margin: 0; }
.diag dt { color: var(--muted); }
.diag dd { margin: 0; word-break: break-all; }
.diag .ok { color: var(--green); font-weight: 600; }
.diag .bad { color: var(--red); font-weight: 600; }
.diag .close { position: absolute; top: 6px; right: 8px; border: 0; background: none; padding: 2px 6px; font-size: 14px; }
.toast {
  position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%); z-index: 2147483647;
  background: #1d1d1f; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 13px;
  box-shadow: 0 6px 20px rgba(0,0,0,.3);
}
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

  // ── 위젯 ──
  // vm: { visible, lamp, chip, reason, preview:{parts:[{text,token}],label,note}|null, busy,
  //       canSanitize, canApply, canRevert, canForce, notice, noticeTone, chipClickable }
  let W = null; // 위젯 요소 참조
  let handlers = {};
  let anchor = null;
  let ro = null;

  function buildWidget() {
    ensureRoot();
    const refs = {};
    const dots = ["r", "y", "g"].map((c) => h("i", { class: `dot ${c}` }));
    refs.reason = h("div", { class: "reason" });
    refs.chip = h("button", { class: "chip-w", type: "button", tabindex: "-1" });
    refs.phead = h("div", { class: "phead" });
    refs.pbody = h("div", { class: "pbody" });
    refs.pnote = h("div", { class: "pnote" });
    refs.pbox = h("div", { class: "pbox" }, refs.phead, refs.pbody, refs.pnote);
    refs.notice = h("div", { class: "wnotice", role: "status" });
    const btn = (cls, text, key) =>
      h("button", { type: "button", class: cls, onclick: (e) => { e.stopPropagation(); handlers[key]?.(); },
                    onmousedown: (e) => e.preventDefault() }, text);
    refs.force = btn("linkbtn", "그래도 전송", "force");
    refs.revert = btn("linkbtn", "원문으로 되돌리기", "revert");
    // 정제문을 입력창에 넣기만 한다. 자동 전송은 하지 않는다(사이트 내부 상태가 늦게 갱신되면 원문이 나갈 수 있음).
    refs.apply = btn("b-send", "입력창에 넣기", "apply");
    refs.san = btn("b-san", "안전 다듬기", "sanitize");
    refs.chip.addEventListener("click", () => handlers.details?.());
    refs.chip.addEventListener("mousedown", (e) => e.preventDefault());
    refs.root = h("div", { class: "badge", hidden: true },
      refs.reason,
      h("div", { class: "wrow" },
        h("div", { class: "brand" }, h("span", null, "SafePrompt"), h("span", { class: "lamps" }, dots)),
        refs.chip),
      refs.pbox, refs.notice,
      h("div", { class: "acts" }, refs.force, refs.revert, refs.san, refs.apply));
    rootEl.append(refs.root);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return refs;
  }

  function setHandlers(next) { handlers = next; }

  function renderWidget(vm, editor) {
    if (!W || !W.root.isConnected) W = buildWidget();
    if (editor !== anchor) {
      ro?.disconnect();
      anchor = editor || null;
      if (anchor && typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(reposition); ro.observe(anchor); }
    }
    W.root.hidden = !vm.visible;
    W.root.dataset.state = vm.lamp;
    W.reason.textContent = vm.reason || "";
    W.chip.textContent = vm.chip || "";
    if (vm.chipClickable) { W.chip.dataset.clickable = ""; W.chip.title = "자세히 보기"; }
    else { delete W.chip.dataset.clickable; W.chip.title = ""; }

    W.pbox.hidden = !vm.preview;
    if (vm.preview) {
      W.phead.textContent = vm.preview.label;
      W.pbody.replaceChildren(...vm.preview.parts.map((p) =>
        h("span", { class: p.token ? "tk" : null }, p.text)));
      W.pnote.textContent = vm.preview.note || "";
      W.pnote.hidden = !vm.preview.note;
    }
    W.notice.hidden = !vm.notice;
    W.notice.textContent = vm.notice || "";
    W.notice.dataset.tone = vm.noticeTone || "info";

    W.san.hidden = !vm.canSanitize && !vm.busy;
    W.san.disabled = !!vm.busy;
    W.san.textContent = vm.busy ? "다듬는 중…" : "안전 다듬기";
    W.apply.hidden = !vm.canApply;
    W.revert.hidden = !vm.canRevert;
    W.force.hidden = !vm.canForce;
    reposition();
  }

  // 입력창 바로 위에 붙이고, 위쪽 공간이 모자라면 아래에 둔다.
  function reposition() {
    if (!W || !anchor || !anchor.isConnected || W.root.hidden) return;
    const r = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 340), 640, window.innerWidth - 16);
    W.root.style.width = `${width}px`;
    W.root.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - width - 8)}px`;
    if (r.top > 200) {
      W.root.style.top = "";
      W.root.style.bottom = `${window.innerHeight - r.top + 8}px`;
    } else {
      W.root.style.bottom = "";
      W.root.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 140)}px`;
    }
  }

  function shakeWidget() {
    if (!W) return;
    W.root.classList.remove("shake");
    void W.root.offsetWidth;
    W.root.classList.add("shake");
  }

  function hideWidget() { if (W) W.root.hidden = true; }

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
  // opts: { result?, error?, onApply, onBack }
  // 치환 후 자동 전송 버튼은 두지 않는다(사이트 내부 상태가 늦게 갱신되면 원문이 전송될 수 있음).
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
        h("button", { class: "primary", onclick: () => { closeModal(); opts.onApply(); } },
          pass ? "입력창에 반영(직접 전송)" : "입력창에 반영"))));
  }

  // ── 테스트 모드 진단 패널 ──
  // 자동 점검 스크립트가 읽을 수 있도록 결과를 data-* 속성에도 남긴다.
  let diagEl, toastTimer;

  function setDiag(info) {
    ensureRoot();
    if (!diagEl) {
      diagEl = h("div", { class: "diag", role: "status" });
      rootEl.append(diagEl);
    }
    if (diagEl.dataset.dismissed) return;
    const yes = (v, label) => h("span", { class: v ? "ok" : "bad" }, v ? `✓ ${v}` : `✗ ${label}`);
    const counts = Object.entries(info.intercepts).map(([k, n]) => `${k} ${n}회`).join(", ") || "없음";
    diagEl.replaceChildren(
      h("button", { class: "close", title: "이 페이지에서 닫기",
        onclick: () => { diagEl.dataset.dismissed = "1"; diagEl.hidden = true; } }, "×"),
      h("h3", null, "Prompt Guard 테스트 모드 · 실제 전송 안 함"),
      h("dl", null,
        h("dt", null, "사이트"), h("dd", null, `${info.host} → ${info.destination ?? "목적지 미지정"}`),
        h("dt", null, "입력창"), h("dd", null, yes(info.editor, "찾지 못함(로그인 필요?)")),
        h("dt", null, "전송 버튼"), h("dd", null, yes(info.sendButton, "찾지 못함 → 클릭 전송은 막지 못함")),
        h("dt", null, "검사 서버"), h("dd", null, info.server ?? "확인 중…"),
        h("dt", null, "가로챔"), h("dd", null, counts),
        h("dt", null, "마지막 결과"), h("dd", null, info.lastOutcome ?? "-")));
    Object.assign(diagEl.dataset, {
      editor: info.editor ?? "", sendButton: info.sendButton ?? "", destination: info.destination ?? "",
      intercepts: JSON.stringify(info.intercepts), lastEvent: info.lastEvent ?? "",
      lastOutcome: info.lastOutcome ?? "", dryRuns: String(info.dryRuns),
    });
    diagEl.hidden = false;
  }

  function hideDiag() {
    if (diagEl) diagEl.hidden = true;
  }

  function toast(message) {
    ensureRoot();
    shadow.querySelector(".toast")?.remove();
    const el = h("div", { class: "toast", role: "status" }, message);
    rootEl.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2500);
  }

  // ── 그래도 전송 확인 ──
  // opts: { findings, onConfirm }
  function showForce(opts) {
    const confirmBtn = h("button", { class: "danger", disabled: true, onclick: () => { closeModal(); opts.onConfirm(); } },
      "그래도 전송");
    openModal(h("div", { class: "card" },
      header("red", "!", "민감정보를 그대로 외부 AI에 보냅니다", "이 선택은 이 전송 한 번에만 적용됩니다."),
      h("div", { class: "body" },
        opts.findings?.length ? h("div", null, h("p", { class: "section-title" }, "보내지는 민감정보"), findingList(opts.findings)) : null,
        h("label", { class: "ack" },
          h("input", { type: "checkbox", onchange: (e) => { confirmBtn.disabled = !e.target.checked; } }),
          "민감정보가 외부 AI 서비스에 전송되는 것을 이해했고, 그래도 보내겠습니다.")),
      h("div", { class: "foot" },
        h("button", { class: "primary", onclick: closeModal }, "돌아가서 수정"),
        confirmBtn)));
  }

  PG.ui = { setHandlers, renderWidget, hideWidget, shakeWidget, showWarning, showSanitized, showForce,
            showLoading, closeModal, setDiag, hideDiag, toast, isOpen: () => !!overlayEl };
})();
