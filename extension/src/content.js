// 입력 감지 → 검사 → 전송 가로채기.
// - 입력이 바뀌면 이전 결과를 무효화하고(input_version), 늦게 온 응답은 버린다.
// - 전송 시점의 텍스트와 검사한 텍스트가 정확히 같고 '검사 완료 + allow' 일 때만 그대로 보낸다.
// - 서버 오류·시간 초과는 전송을 보류한다(자동 폴백 없음).
// - 테스트 모드: 어떤 경우에도 실제로 전송하지 않고, 진단 패널에 감지·가로채기 결과를 보여 준다.
(() => {
  const PG = globalThis.PG;
  const DEBOUNCE_MS = 700;
  const BYPASS_MS = 3000;
  // 확장프로그램이 입력창을 바꾼 직후에는 사이트 내부 상태가 아직 옛 값일 수 있다.
  // 그 사이에 대신 전송 버튼을 누르지 않도록 이 시간만큼 기다린다.
  const SETTLE_MS = 500;

  let enabled = true;
  let editor = null;
  let version = 0;
  let latest = null; // { version, text, result, error }
  let bypass = null; // { text, until } 사용자가 승인한 다음 1회 전송
  let timer = null;
  let testMode = false;
  let lastProgrammaticSet = 0;

  chrome.runtime.sendMessage({ type: "settings" }).then((r) => {
    enabled = r?.data?.enabled !== false;
    setTestMode(!!r?.data?.testMode);
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      if (!enabled) PG.ui.hideBadge();
    }
    if (changes.testMode) setTestMode(!!changes.testMode.newValue);
  });

  // ── 입력창 ──
  const EDITOR_SEL = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';

  function editorFrom(target) {
    if (!(target instanceof Element) || target.closest("#pg-root-host")) return null;
    const el = target.closest(EDITOR_SEL);
    if (!el || el.disabled || el.readOnly) return null;
    // 가장 바깥 contenteditable 을 입력창으로 본다
    if (el.isContentEditable) {
      let top = el;
      while (top.parentElement?.isContentEditable) top = top.parentElement;
      return top;
    }
    return el;
  }

  function getText(el) {
    return el.tagName === "TEXTAREA" ? el.value : el.innerText.replace(/\n$/, "");
  }

  function setText(el, text) {
    lastProgrammaticSet = Date.now();
    el.focus();
    if (el.tagName === "TEXTAREA") {
      // React 등 프레임워크가 변경을 인식하도록 네이티브 setter + input 이벤트
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // ProseMirror·Lexical 등 편집기는 execCommand 로 넣어야 내부 상태가 갱신된다
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      if (!document.execCommand("insertText", false, text)) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    }
  }

  const passed = (r) => r?.status === "complete" && r?.decision === "allow";

  function badgeState(entry) {
    if (!entry.result) return "gray";
    if (entry.result.status !== "complete") return "gray";
    return { allow: "green", warn: "yellow", block: "red" }[entry.result.decision];
  }

  // ── 검사 ──
  async function inspect(text) {
    const v = ++version;
    const res = await chrome.runtime.sendMessage({
      type: "inspect", text, inputVersion: v, destination: PG.resolveDestination(),
    }).catch(() => ({ ok: false, error: "network" }));
    const entry = { version: v, text, result: res?.ok ? res.data : null, error: res?.ok ? null : res?.error };
    // 응답이 늦게 와서 더 새로운 요청이 있으면 버린다
    if (v !== version) return null;
    if (entry.result && String(entry.result.input_version) !== String(v)) return null;
    latest = entry;
    return entry;
  }

  function showDetails(entry, ed) {
    if (passed(entry.result)) return;
    openWarning(ed, entry);
  }

  function scheduleInspect(ed) {
    clearTimeout(timer);
    latest = null; // 입력이 바뀌면 이전 결과와 전송 승인은 무효
    bypass = null;
    version++;
    const text = getText(ed);
    if (!enabled || !text.trim()) { PG.ui.hideBadge(); return; }
    PG.ui.setBadge("checking");
    timer = setTimeout(async () => {
      const entry = await inspect(text);
      if (!entry || getText(ed) !== text) return;
      PG.ui.setBadge(badgeState(entry), passed(entry.result) ? null : () => showDetails(entry, ed));
    }, DEBOUNCE_MS);
  }

  window.addEventListener("input", (e) => {
    const ed = editorFrom(e.target);
    if (!ed) return;
    editor = ed;
    scheduleInspect(ed);
  }, true);

  window.addEventListener("focusin", (e) => {
    const ed = editorFrom(e.target);
    if (ed) editor = ed;
  }, true);

  // ── 전송 가로채기 ──
  // 승인된 전송은 짧은 시간 동안 같은 텍스트에 한해 유효하다.
  // 한 번의 전송이 click → submit 처럼 여러 이벤트를 거쳐도 다시 막지 않기 위해 즉시 지우지 않는다.
  function consumeBypass(text) {
    return !!bypass && bypass.text === text && Date.now() < bypass.until;
  }

  // 사이트가 전송 후 입력창을 비우면(input 이벤트 없이) 배지를 정리한다.
  function clearBadgeAfterSend(ed) {
    setTimeout(() => { if (!getText(ed).trim()) PG.ui.hideBadge(); }, 400);
  }

  function triggerSend(ed, text) {
    if (testMode) { dryRun(ed, "승인 후 전송"); return; }
    const wait = SETTLE_MS - (Date.now() - lastProgrammaticSet);
    if (wait > 0) {
      setTimeout(() => { if (getText(ed) === text) triggerSend(ed, text); }, wait);
      return;
    }
    clearBadgeAfterSend(ed);
    bypass = { text, until: Date.now() + BYPASS_MS };
    const btn = PG.findSendButton(ed);
    if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") { btn.click(); return; }
    // 대신 보낼 방법을 못 찾으면 합성 Enter 를 쓰지 않는다(사이트가 무시하는 경우가 많다).
    // 이 텍스트는 이미 통과 판정이므로 사용자가 다시 Enter 를 누르면 그대로 전송된다.
    PG.ui.toast("검사를 통과했습니다. Enter 를 한 번 더 누르면 전송됩니다.");
    ed.focus();
  }

  function openWarning(ed, entry) {
    PG.ui.showWarning({
      text: entry.text,
      result: entry.result,
      error: entry.error,
      onRetry: () => { PG.ui.closeModal(); gate(ed, entry.text); },
      onSendAnyway: () => {
        if (getText(ed) === entry.text) triggerSend(ed, entry.text);
      },
      onSanitize: () => runSanitize(ed, entry),
    });
  }

  async function runSanitize(ed, entry) {
    PG.ui.showLoading("민감정보를 치환하고 다시 검사하는 중…");
    const res = await chrome.runtime.sendMessage({
      type: "sanitize", text: entry.text, inputVersion: ++version, destination: PG.resolveDestination(),
    }).catch(() => ({ ok: false, error: "network" }));
    const result = res?.ok ? res.data : null;
    PG.ui.showSanitized({
      result,
      error: res?.ok ? null : res?.error,
      onBack: () => openWarning(ed, entry),
      onApply: () => apply(ed, result),
    });
  }

  // 치환문을 입력창에 넣기만 하고 자동 전송하지 않는다.
  // ChatGPT(ProseMirror+React) 등은 DOM 변경을 비동기로 내부 상태에 반영하므로,
  // 바로 전송 버튼을 누르면 화면은 치환문인데 원문이 전송될 수 있다(실제 재현됨).
  // 사용자가 확인 후 직접 전송하면 그 시점에 다시 검사된다.
  function apply(ed, result) {
    if (!result?.sanitized_text) return;
    clearTimeout(timer);
    setText(ed, result.sanitized_text);
    PG.ui.toast("치환된 내용을 입력창에 넣었습니다. 확인한 뒤 직접 전송하세요.");
  }

  // 전송 허용 여부. true 면 원래 이벤트를 그대로 둔다.
  function gateSync(ed, text) {
    if (!enabled || !text.trim()) return true;
    if (consumeBypass(text)) return true;
    const ok = !!latest && latest.text === text && passed(latest.result);
    if (ok) clearBadgeAfterSend(ed);
    return ok;
  }

  async function gate(ed, text) {
    clearTimeout(timer);
    PG.ui.setBadge("checking");
    const entry = await inspect(text);
    if (!entry) return;
    if (getText(ed) !== text) { scheduleInspect(ed); return; } // 검사 중 입력이 바뀜 → 보내지 않음
    PG.ui.setBadge(badgeState(entry), passed(entry.result) ? null : () => showDetails(entry, ed));
    if (passed(entry.result)) triggerSend(ed, text);
    else openWarning(ed, entry);
  }

  function block(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // 전송 시도 공통 처리. kind: enter | click | submit
  function intercept(e, ed, kind) {
    const text = getText(ed);
    if (!enabled || !text.trim()) return;
    diag.intercepts[kind] = (diag.intercepts[kind] || 0) + 1;
    diag.lastEvent = kind;
    if (gateSync(ed, text)) {
      if (!testMode) return; // 통과: 원래 이벤트 그대로
      block(e);
      dryRun(ed, "검사 통과");
      return;
    }
    block(e);
    diag.lastOutcome = "검사 후 판단";
    renderDiag();
    gate(ed, text);
  }

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey) return;
    if (e.isComposing || e.keyCode === 229) return; // 한글 IME 조합 중 Enter 는 전송이 아님
    if (PG.ui.isOpen()) return;
    const ed = editorFrom(e.target);
    if (ed) intercept(e, ed, "enter");
  }, true);

  window.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const btn = e.target.closest(PG.clickTargetSelector());
    if (!btn || !PG.isSendButton(btn)) return;
    const ed = (editor?.isConnected && editor) || editorFrom(btn.form?.querySelector(EDITOR_SEL));
    if (ed) intercept(e, ed, "click");
  }, true);

  window.addEventListener("submit", (e) => {
    const ed = editorFrom(e.target.querySelector?.(EDITOR_SEL));
    if (ed) intercept(e, ed, "submit");
  }, true);

  // ── 테스트 모드 진단 ──
  const diag = { intercepts: {}, lastEvent: null, lastOutcome: null, dryRuns: 0, server: null };
  let probeTimer = null;

  function dryRun(ed, why) {
    diag.dryRuns++;
    diag.lastOutcome = `${why} → 테스트 모드라 전송하지 않음`;
    renderDiag();
    PG.ui.toast("테스트 모드: 실제로 전송하지 않았습니다.");
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 10 && getComputedStyle(el).visibility !== "hidden";
  }

  // 포커스된 입력창, 없으면 화면에 보이는 가장 큰 입력창
  function probeEditor() {
    const focused = editorFrom(document.activeElement);
    if (focused) return focused;
    const all = [...document.querySelectorAll(EDITOR_SEL)].map(editorFrom).filter((el) => el && isVisible(el));
    const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    return all.sort((a, b) => area(b) - area(a))[0] || null;
  }

  function describe(el) {
    if (!el) return null;
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const testid = el.getAttribute("data-testid");
    if (testid) s += `[data-testid="${testid}"]`;
    const label = el.getAttribute("aria-label");
    if (label) s += `[aria-label="${label.slice(0, 30)}"]`;
    if (el.isContentEditable) s += " (contenteditable)";
    return s;
  }

  function renderDiag() {
    if (!testMode) return;
    const ed = probeEditor();
    const btn = ed && PG.findSendButton(ed);
    const dest = PG.resolveDestination();
    PG.ui.setDiag({
      host: location.hostname,
      destination: dest ? `${dest.provider}/${dest.channel}` : null,
      editor: describe(ed),
      sendButton: btn ? `${describe(btn)} ← ${PG.matchSendSelector(btn)}` : null,
      server: diag.server,
      intercepts: diag.intercepts,
      lastEvent: diag.lastEvent,
      lastOutcome: diag.lastOutcome,
      dryRuns: diag.dryRuns,
    });
  }

  function setTestMode(on) {
    testMode = on;
    clearInterval(probeTimer);
    if (!on) { PG.ui.hideDiag(); return; }
    chrome.runtime.sendMessage({ type: "health" }).then((r) => {
      diag.server = r?.ok ? `연결됨 · 정책 ${r.data.policy_version}` : `연결 안 됨(${r?.error})`;
      renderDiag();
    });
    renderDiag();
    probeTimer = setInterval(renderDiag, 1500);
  }
})();
