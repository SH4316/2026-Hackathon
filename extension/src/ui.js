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
  position: fixed; z-index: 2147483646; display: grid; gap: 8px; padding: 10px 12px; overflow-y: auto;
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
.badge .retention-summary { margin: 0; color: var(--w-amber-fg); font-size: 12px; line-height: 1.5; }
.retention-notice { padding: 10px 12px; border-radius: 8px; background: var(--yellow-bg); color: var(--yellow); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.retention-notice p { margin: 6px 0 0; }
.retention-notice .retention-title { margin: 0; font-weight: 700; }
.site-context { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 12px; overflow-wrap: anywhere; }
.site-context[data-tone="yellow"] { color: var(--yellow); background: var(--yellow-bg); }
.badge .site-context { border-color: var(--w-amber); color: var(--w-amber-fg); background: var(--w-amber-bg); }
.site-context summary { cursor: pointer; font-weight: 600; line-height: 1.5; }
.site-context summary:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.site-context dl { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(0, 3fr); gap: 6px 12px; margin: 10px 0; }
.site-context dt { font-weight: 600; }
.site-context dd { margin: 0; }
.site-context p { margin: 8px 0 0; line-height: 1.6; }
.site-context .context-help { border-top: 1px solid currentColor; padding-top: 8px; }
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
.entry-copy { margin: 0; overflow-wrap: anywhere; }
.policy-sources { margin: 0 0 12px; padding-left: 20px; }
.policy-sources a { color: var(--primary); text-underline-offset: 3px; overflow-wrap: anywhere; }
.entry-policy :focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
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
.fileblock { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; display: grid; gap: 8px; }
.fileblock h4 { margin: 0; font-size: 14px; word-break: break-all; }
.fileblock .why { margin: 0; font-size: 13px; color: var(--muted); }
ul.hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; max-height: 240px; overflow: auto; }
ul.hits li { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: baseline; padding: 6px 8px; background: var(--soft); border-radius: 8px; }
.where { font-size: 12px; font-weight: 700; color: var(--muted); white-space: nowrap; }
.hitname { font-weight: 600; }
.snippet { grid-column: 1 / -1; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
  position: fixed; top: 12px; right: 12px; z-index: 2147483646; width: 340px;
  background: var(--bg); color: var(--fg); border: 2px dashed #f2a600; border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.18); font-size: 12px; line-height: 1.45; padding: 10px 12px;
}
.ov-frame {
  position: fixed; z-index: 2147483645; pointer-events: none; box-sizing: border-box;
  border: 2px solid rgba(16,163,127,.85); border-radius: 12px; box-shadow: 0 0 0 4px rgba(16,163,127,.15);
}
.ov-label {
  position: absolute; top: -13px; right: 12px; pointer-events: auto; display: flex; align-items: center; gap: 8px;
  background: var(--bg); color: var(--fg); border: 1px solid rgba(16,163,127,.85); border-radius: 999px;
  padding: 2px 4px 2px 10px; font-size: 12px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.12); white-space: nowrap;
}
.ov-text { color: #0d7a5f; }
.ov-revert {
  border: 0; background: rgba(16,163,127,.12); color: #0d7a5f; border-radius: 999px; padding: 2px 10px;
  font-size: 12px; font-weight: 700; cursor: pointer;
}
.ov-revert:hover { background: rgba(16,163,127,.22); }
.ov-mirror {
  position: fixed; z-index: 2147483644; pointer-events: none; overflow: hidden; color: transparent;
  white-space: pre-wrap; overflow-wrap: break-word; border-style: solid; border-color: transparent; background: transparent;
}
.ov-mirror mark { color: transparent; background: rgba(16,163,127,.28); border-bottom: 2px solid rgba(16,163,127,.95); border-radius: 2px; }
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

  function contextDetails(snapshot) {
    if (!snapshot) return null;
    const provider = PG.PROVIDER_LABELS[snapshot.provider] || "알 수 없는 서비스";
    const model = snapshot.model.value || "모델 미확인";
    const detail = h("details", { class: "site-context", dataset: { tone: snapshot.uncertain ? "yellow" : "known" } },
      h("summary", null, `${provider} · ${model} · ${snapshot.uncertain ? "이용 환경 확인 필요" : "화면 상태 확인됨"}`));
    const value = (field) => {
      const f = snapshot[field];
      if (f.status !== "observed") return f.value ? `${f.value} (확인 불가)` : "확인 불가";
      return `${typeof f.value === "boolean" ? f.value ? "ON" : "OFF" : f.value} · 화면에서 확인`;
    };
    detail.append(h("dl", null,
      [["model", "선택 모델"], ["account", "계정·공간"], ["plan", "요금제"], ["training", "학습·활동 설정"],
        ["temporary", "임시 대화"], ["policy", "정책 범위"]].flatMap(([field, label]) =>
        [h("dt", null, label), h("dd", { dataset: { field, status: snapshot[field].status } }, value(field))])),
      h("p", { class: "context-help" }, "계정 메뉴와 개인정보 설정을 열면 표시된 상태를 확인합니다. 화면에 없는 항목은 확인 불가로 표시합니다."),
      h("p", null, "학습 OFF·유료 계정만으로 안전하다고 판단하지 않습니다. 모델별 정책이 확인될 때까지 제공사 기본 기준과 주의를 적용합니다."));
    return detail;
  }

  // 학습 설정만으로 서버 보관 기간·삭제 조건을 판단할 수 없다.
  // 실제 보관이나 기간을 단정하지 않고 외부 AI 전송 대상이 있을 때 가능성을 안내한다.
  function retentionProvider() {
    if (PG.isTestHost?.()) return null;
    const destination = PG.resolveDestination?.();
    if (!destination || !PG.SITES?.some(site => site.provider === destination.provider && site.hosts.includes(location.hostname))) return null;
    return PG.PROVIDER_LABELS[destination.provider] || destination.provider;
  }

  function retentionNotice() {
    const provider = retentionProvider();
    if (!provider) return null;
    return h("section", { class: "retention-notice", "aria-label": "외부 AI 서버 보관 안내" },
      h("p", { class: "retention-title" }, "전송 후 데이터가 서버에 남을 수 있습니다"),
      h("p", null, `${provider}에 전송한 대화·파일은 제공사 서버에 보관될 수 있습니다. 학습 OFF·임시 대화·대화 삭제가 즉시 삭제나 미보관을 보장하지는 않습니다.`),
      h("p", null, "현재 계정의 보관 기간·삭제 조건은 확인되지 않았습니다. 민감정보를 보내기 전에 서비스의 데이터 보관 정책을 확인하세요."));
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
    refs.context = h("div", { class: "context-slot" });
    refs.retention = h("p", { class: "retention-summary", hidden: true }, "외부 AI 서버 잔존 가능 · 보관 기간 미확인");
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
      refs.context, refs.retention, refs.pbox, refs.notice,
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
    const contextKey = vm.siteContext ? `${vm.siteContext.revision}` : "";
    if (W.contextKey !== contextKey) {
      const wasOpen = !!W.context.querySelector("details")?.open;
      const detail = contextDetails(vm.siteContext);
      if (detail) detail.open = wasOpen;
      W.context.replaceChildren(...(detail ? [detail] : []));
      detail?.addEventListener("toggle", reposition);
      W.contextKey = contextKey;
    }
    W.context.hidden = !vm.siteContext;
    W.retention.hidden = !retentionProvider();
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
    placeOverlay();
    if (!W || !anchor || !anchor.isConnected || W.root.hidden) return;
    const r = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 340), 640, window.innerWidth - 16);
    W.root.style.width = `${width}px`;
    W.root.style.maxHeight = `${Math.min(window.innerHeight - 16, Math.max(140, r.top > 200 ? r.top - 16 : window.innerHeight - r.bottom - 16))}px`;
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

  // ── 입력창 오버레이: 다듬은 결과를 입력창 위에서 바로 보여 준다 ──
  // - 치환된 토큰([EMAIL_1] 등)을 입력창 안에서 강조한다.
  //   contenteditable(ChatGPT·Claude·Gemini): CSS Custom Highlight API 로 원래 글자 위치에 직접 강조
  //   textarea: 같은 글꼴·여백의 투명 거울 층을 입력창 위에 겹쳐 토큰 부분만 칠한다
  // - 입력창 테두리와 오른쪽 위 라벨("n건 치환됨 · 원문으로 되돌리기")로 다듬어졌다는 것을 알린다.
  // - 사용자 텍스트는 textContent/Range 로만 다룬다(innerHTML 사용 안 함).
  const TOKEN_RE_UI = /\[[A-Z][A-Z0-9_]*_\d+\]/g;
  let ov = null; // { editor, frame, label, mirror, count }

  function ensureHighlightStyle() {
    if (document.getElementById("pg-token-highlight-style")) return;
    const st = document.createElement("style");
    st.id = "pg-token-highlight-style";
    st.textContent = "::highlight(pg-token){background-color:rgba(16,163,127,.28);color:inherit;"
      + "text-decoration:underline 2px rgba(16,163,127,.95);}";
    (document.head || document.documentElement).append(st);
  }

  function highlightEditable(el) {
    if (!globalThis.CSS?.highlights || typeof Highlight === "undefined") return;
    const ranges = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (const m of n.data.matchAll(TOKEN_RE_UI)) {
        const r = new Range();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        ranges.push(r);
      }
    }
    CSS.highlights.set("pg-token", new Highlight(...ranges));
  }

  const MIRROR_PROPS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
    "textTransform", "wordSpacing", "textIndent", "textAlign", "paddingTop", "paddingRight", "paddingBottom",
    "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing",
    "tabSize", "direction"];

  function renderMirror(ta, mirror) {
    const cs = getComputedStyle(ta);
    for (const p of MIRROR_PROPS) mirror.style[p] = cs[p];
    const value = ta.value;
    const parts = [];
    let last = 0;
    for (const m of value.matchAll(TOKEN_RE_UI)) {
      if (m.index > last) parts.push(value.slice(last, m.index));
      parts.push(h("mark", null, m[0]));
      last = m.index + m[0].length;
    }
    parts.push(value.slice(last) + "​"); // 마지막 줄바꿈 높이 유지
    mirror.replaceChildren(...parts);
  }

  function placeOverlay() {
    if (!ov || !ov.editor.isConnected) return;
    const r = ov.editor.getBoundingClientRect();
    Object.assign(ov.frame.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`,
      width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    if (ov.mirror) {
      Object.assign(ov.mirror.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      ov.mirror.scrollTop = ov.editor.scrollTop;
      ov.mirror.scrollLeft = ov.editor.scrollLeft;
    }
  }

  function showTokenOverlay(editor, count) {
    ensureRoot();
    clearTokenOverlay();
    const revertBtn = h("button", { type: "button", class: "ov-revert",
      onclick: (e) => { e.stopPropagation(); handlers.revert?.(); },
      onmousedown: (e) => e.preventDefault() }, "↺ 원문으로 되돌리기");
    const label = h("div", { class: "ov-label", role: "status" },
      h("span", { class: "ov-text" }, `SafePrompt · ${count}건 치환됨`), revertBtn);
    const frame = h("div", { class: "ov-frame" }, label);
    rootEl.append(frame);
    let mirror = null;
    if (editor.tagName === "TEXTAREA") {
      mirror = h("div", { class: "ov-mirror", "aria-hidden": "true" });
      rootEl.append(mirror);
      renderMirror(editor, mirror);
      editor.addEventListener("scroll", placeOverlay);
    } else {
      ensureHighlightStyle();
      highlightEditable(editor);
    }
    ov = { editor, frame, label, mirror, count };
    placeOverlay();
  }

  function clearTokenOverlay() {
    if (!ov) return;
    ov.frame.remove();
    ov.mirror?.remove();
    ov.editor.removeEventListener("scroll", placeOverlay);
    globalThis.CSS?.highlights?.delete("pg-token");
    ov = null;
  }

  // 입력창 DOM 이 다시 그려지면(편집기 재렌더) 강조를 다시 건다.
  function refreshTokenOverlay() {
    if (!ov) return;
    if (ov.mirror) renderMirror(ov.editor, ov.mirror);
    else highlightEditable(ov.editor);
    placeOverlay();
  }

  // ── 모달 공통 ──
  // onClose: 사용자가 Esc 등으로 창을 닫았을 때(결정 없이) 한 번 불린다. 결정을 기다리는 창에서 쓴다.
  let closeCb = null;

  function openModal(card, onClose) {
    ensureRoot();
    closeModal();
    closeCb = onClose || null;
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
    const cb = closeCb;
    closeCb = null;
    overlayEl?.remove();
    overlayEl = null;
    cb?.();
    if (lastFocus?.isConnected) lastFocus.focus();
    lastFocus = null;
  }

  function header(tone, icon, title, sub) {
    return h("div", { class: "head", dataset: { tone } },
      h("div", { class: "icon", "aria-hidden": "true" }, icon),
      h("div", null, h("p", { class: "title" }, title), sub && h("p", { class: "sub" }, sub)));
  }

  function preview(text, findings) {
    const box = h("div", { class: "preview" });
    let pos = 0;
    const sorted = [...findings].sort((a, b) => a.span.start_utf16 - b.span.start_utf16);
    for (const f of sorted) {
      const { start_utf16: s, end_utf16: e } = f.span;
      if (s < pos) continue;
      box.append(text.slice(pos, s));
      box.append(h("mark", { dataset: { action: f.action }, title: PG.findingLabel(f) },
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
        h("span", { class: "fname" }, PG.findingLabel(f)),
        h("span", { class: "fmeta" },
          [f.reason, PG.CONFIDENCE_LABELS[f.confidence]].filter(Boolean).join(" · ")))));
  }

  function notices(codes, extra) {
    const lines = [...(extra ? [extra] : []), ...(codes || []).map((c) => PG.NOTICE_LABELS[c] || c)];
    if (!lines.length) return null;
    return h("div", { class: "notice" }, lines.map((l) => h("p", null, l)));
  }

  const FINE = "판정은 선택한 검사 방식의 기준이며 안전을 보장하지 않습니다. 기기 내 AI는 원문을 저장하거나 외부로 보내지 않습니다.";

  // ── 경고 화면 ──
  // opts: { text, result?, error?, onSanitize, onSendAnyway, onRetry }
  function showWarning(opts) {
    const { text, result, error } = opts;

    if (!result) {
      openModal(h("div", { class: "card" },
        header("gray", "!", "검사를 완료하지 못해 전송을 보류했습니다", PG.errorLabel(error)),
        h("div", { class: "body" },
          notices(null, "설정에서 검사 방식과 AI 준비 상태를 확인한 뒤 다시 시도하세요. 검사를 완료하기 전에는 전송하지 않습니다."),
          retentionNotice()),
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
    const canSendAnyway = !incomplete && ["warn", "block"].includes(result.decision);

    let tone, icon, title;
    if (incomplete) [tone, icon, title] = ["gray", "!", "검사가 완료되지 않아 전송을 보류했습니다"];
    else if (result.decision === "block") [tone, icon, title] = ["red", "✕", "민감정보 전송 여부를 확인해 주세요"];
    else [tone, icon, title] = ["yellow", "!", "보내기 전에 확인이 필요합니다"];

    const summary = relevant.length
      ? `${relevant.length}개 항목이 발견되었습니다.`
      : result.ai_assessment && result.ai_assessment.decision !== "allow"
        ? "기기 내 AI가 개인정보 가능성을 감지했습니다. 정확한 위치는 제공하지 않습니다."
        : "내용 검사 결과를 확인하고 전송 여부를 선택하세요.";

    const ack = canSendAnyway
      ? h("label", { class: "ack" },
          h("input", { type: "checkbox", onchange: (e) => { sendBtn.disabled = !e.target.checked; } }),
          "내용을 확인했고, 이 텍스트를 외부 AI에 보내는 것에 동의합니다.")
      : null;
    const sendBtn = canSendAnyway
      ? h("button", { class: "danger", disabled: true, onclick: () => { closeModal(); opts.onSendAnyway(); } },
          result.decision === "block" ? "그래도 전송" : "확인 후 전송")
      : null;

    openModal(h("div", { class: "card" },
      header(tone, icon, title, summary),
      h("div", { class: "body" },
        retentionNotice(),
        h("div", null, h("p", { class: "section-title" }, "입력 내용"), preview(text, findings)),
        findings.length ? h("div", null, h("p", { class: "section-title" }, "탐지 항목"), findingList(findings)) : null,
        notices(result.notices?.filter(code => !code.startsWith("destination_") && code !== "site_context_uncertain"),
          hasBlock ? "치환으로 해결되지 않는 항목이 있습니다. 해당 내용을 직접 지우거나 승인된 경로를 이용하세요." : null),
        ack),
      h("div", { class: "foot" },
        h("p", { class: "fine" }, FINE),
        h("button", { onclick: closeModal }, "돌아가서 수정"),
        incomplete ? h("button", { onclick: opts.onRetry }, "다시 검사") : null,
        sendBtn,
        canSanitize ? h("button", { class: "primary", onclick: opts.onSanitize }, "안전 다듬기") : null)));
  }

  // 진입 안내는 전송 승인과 별개다. 닫아도 본문/파일 검사를 우회하지 않는다.
  function showEntryPolicy(policy) {
    const card = h("div", { class: "card entry-policy", "aria-labelledby": "pg-entry-title" },
      header("gray", "i", "학습·데이터 이용 안내", policy.name),
      h("div", { class: "body" },
        h("p", { class: "entry-copy" }, "현재 화면에서 관측한 설정과 제공사·접근 경로 정책입니다. 실제 모델별 학습 여부는 확인한 범위에서만 안내합니다."),
        h("dl", { class: "policy-sources" }, policy.items.map(item =>
          h("div", null, h("dt", { class: "section-title" }, item.label), h("dd", { class: "entry-copy" }, item.text)))),
        retentionNotice()),
      h("div", { class: "foot" },
        h("p", { class: "fine" }, "이 안내는 판정이나 전송 승인을 바꾸지 않습니다. 전송 전 개인정보 검사는 계속 적용됩니다."),
        h("button", { class: "primary", onclick: closeModal }, "확인하고 닫기")));
    card.querySelector(".title").id = "pg-entry-title";
    // 진입 직후 키보드 포커스가 뒤쪽 사이트로 빠지지 않도록 제한한다.
    card.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const controls = [...card.querySelectorAll("a[href], button")];
      const first = controls[0], last = controls.at(-1), active = card.getRootNode().activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    });
    openModal(card);
    overlayEl.setAttribute("aria-labelledby", "pg-entry-title");
    overlayEl.dataset.kind = "entry-policy";
    overlayEl.dataset.policyKey = policy.key;
  }

  let toastTimer;

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
        retentionNotice(),
        opts.aiAssessment && opts.aiAssessment.decision !== "allow"
          ? notices(null, "기기 내 AI가 개인정보 가능성을 감지했습니다. 정확한 위치는 제공하지 않습니다.") : null,
        opts.findings?.length ? h("div", null, h("p", { class: "section-title" }, "보내지는 민감정보"), findingList(opts.findings)) : null,
        h("label", { class: "ack" },
          h("input", { type: "checkbox", onchange: (e) => { confirmBtn.disabled = !e.target.checked; } }),
          "민감정보가 외부 AI 서비스에 전송되는 것을 이해했고, 그래도 보내겠습니다.")),
      h("div", { class: "foot" },
        h("button", { class: "primary", onclick: closeModal }, "돌아가서 수정"),
        confirmBtn)));
  }

  // ── 첨부 파일 확인 ──
  // files: [{ name, kind: "sensitive" | "unreadable", reason?, total?, items?: [{ where, label, action, before, value, after }] }]
  // 반환: Promise<boolean> — true 면 그래도 진행, false 면 첨부 취소(Esc 포함)
  function reviewFiles(files) {
    return new Promise((resolve) => {
      let decided = false;
      const decide = (v) => {
        if (decided) return;
        decided = true;
        closeCb = null;
        closeModal();
        resolve(v);
      };
      const hasSensitive = files.some((f) => f.kind === "sensitive");
      const needsAck = hasSensitive;
      const unreadable = files.filter((f) => f.kind === "unreadable");

      const blocks = files.map((f) => {
        if (f.kind === "unreadable") {
          return h("div", { class: "fileblock" },
            h("h4", null, f.name),
            h("p", { class: "why" }, f.reason),
            h("p", { class: "why" }, "읽을 수 없는 파일이라 안전한지 알 수 없습니다."));
        }
        const hits = f.items.map((it) => h("li", null,
          h("span", { class: "where" }, it.where),
          h("span", { class: "hitname" }, it.label),
          h("span", { class: "snippet" }, it.before, h("mark", { dataset: { action: it.action } }, it.value), it.after)));
        return h("div", { class: "fileblock" },
          h("h4", null, f.name),
          h("p", { class: "why" }, `확인이 필요한 항목 ${f.total}건이 있습니다.${f.total > f.items.length ? ` (앞쪽 ${f.items.length}건만 표시)` : ""}`),
          h("ul", { class: "hits" }, hits));
      });

      const proceed = h("button", { class: "danger", disabled: needsAck, onclick: () => decide(true) }, "그래도 진행");
      const ack = needsAck
        ? h("label", { class: "ack" },
            h("input", { type: "checkbox", onchange: (e) => { proceed.disabled = !e.target.checked; } }),
            "민감정보가 든 파일이 외부 AI 서비스에 업로드되는 것을 이해했고, 그래도 진행하겠습니다.")
        : null;

      const title = hasSensitive ? "첨부하려는 파일에 민감정보가 있습니다" : "읽을 수 없는 파일이지만, 그래도 진행할까요?";
      const sub = hasSensitive
        ? "아래 위치를 확인하고, 그래도 올릴지 선택하세요."
        : "내용을 분석할 수 없어 안전한지 알 수 없습니다.";
      const card = h("div", { class: "card" },
        header(hasSensitive ? "red" : "gray", hasSensitive ? "✕" : "!", title, sub),
        h("div", { class: "body" }, retentionNotice(), blocks,
          hasSensitive && unreadable.length
            ? h("div", { class: "notice" }, h("p", null, "읽을 수 없는 파일은 안전한지 알 수 없습니다.")) : null,
          ack),
        h("div", { class: "foot" },
          h("p", { class: "fine" }, "취소하면 이 파일은 첨부되지 않습니다. " + FINE),
          h("button", { class: "primary", onclick: () => decide(false) }, "첨부 취소"),
          proceed));
      openModal(card, () => decide(false));
    });
  }

  PG.ui = { entryPolicyKey: () => overlayEl?.dataset.kind === "entry-policy" ? overlayEl.dataset.policyKey : null,
            showEntryPolicy, reviewFiles, setHandlers, renderWidget, hideWidget, shakeWidget, showWarning, showForce,
            showTokenOverlay, clearTokenOverlay, refreshTokenOverlay, hasTokenOverlay: () => !!ov,
            closeModal, toast, isOpen: () => !!overlayEl };
})();
