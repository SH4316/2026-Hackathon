// 입력 감지 → 검사 → 전송 가로채기.
// - 입력이 바뀌면 이전 결과를 무효화하고(input_version), 늦게 온 응답은 버린다.
// - 전송 시점의 텍스트와 검사한 텍스트가 정확히 같고 '검사 완료 + allow' 일 때만 그대로 보낸다.
// - 서버 오류·시간 초과는 전송을 보류한다(자동 폴백 없음).
// - 브라우저 안의 규칙 엔진(PG.local)은 입력 즉시 위험을 알려 주는 '임시 표시'일 뿐, 전송 근거가 되지 않는다.
// - 테스트 모드: 어떤 경우에도 실제로 전송하지 않고, 진단 패널에 감지·가로채기 결과를 보여 준다.
(() => {
  const PG = globalThis.PG;
  const DEBOUNCE_MS = 300;
  const BYPASS_MS = 3000;
  const MAX_LOCAL_CHARS = 50_000;
  // 확장프로그램이 입력창을 바꾼 직후에는 사이트 내부 상태가 아직 옛 값일 수 있다.
  // 그 사이에 대신 전송 버튼을 누르지 않도록 이 시간만큼 기다린다.
  const SETTLE_MS = 500;

  let enabled = true;
  let editor = null;
  let version = 0;
  let latest = null; // { version, text, result, error } 서버 검사 결과
  let localEntry = null; // { text, result } 브라우저 규칙 엔진의 임시 결과
  let bypass = null; // { text, until } 사용자가 승인한 다음 1회 전송
  let prepared = null; // 정제 결과 { original, sanitized, result, entries, verified }
  let applied = null; // 입력창에 정제문을 넣기 전 원문 { original, sanitized }
  let busy = false;
  let notice = "";
  let noticeTone = "info";
  let noticeTimer = null;
  let timer = null;
  let testMode = false;
  let lastProgrammaticSet = 0;

  PG.hooks = PG.hooks || {};

  function stat(name) { chrome.runtime.sendMessage({ type: "stat", name }).catch(() => {}); }

  function setNotice(text, tone = "info") {
    notice = text;
    noticeTone = tone;
    clearTimeout(noticeTimer);
    if (text) noticeTimer = setTimeout(() => setNotice(""), 9000);
    refresh();
  }

  PG.hooks.notice = setNotice;
  PG.hooks.stat = stat;
  PG.hooks.localReady = () => { if (editor && getText(editor).trim()) scheduleInspect(editor); };

  chrome.runtime.sendMessage({ type: "settings" }).then((r) => {
    enabled = r?.data?.enabled !== false;
    setTestMode(!!r?.data?.testMode);
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      refresh();
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

  const lampOf = (result) => badgeState({ result });

  // ── 화면 ──
  const TOKEN_RE = /\[[A-Z][A-Z0-9_]*_\d+\]/g;

  function activePrepared(text) {
    if (!prepared) return null;
    return text === prepared.original || text === prepared.sanitized ? prepared : null;
  }

  function summary(findings) {
    const counts = new Map();
    for (const f of findings || []) {
      if (f.action === "allow") continue;
      const label = PG.TYPE_LABELS[f.type] || f.type;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts].map(([l, n]) => `${l} ${n}건`).join(", ");
  }

  function destinationText(dest) {
    if (!dest) return "";
    const name = PG.PROVIDER_LABELS[dest.provider] || dest.provider;
    return `전송 대상: ${name} · ${PG.TIER_LABELS[dest.tier] || dest.tier} 기준`;
  }

  function previewOf(p, text) {
    const parts = [];
    let last = 0;
    for (const m of p.sanitized.matchAll(TOKEN_RE)) {
      if (m.index > last) parts.push({ text: p.sanitized.slice(last, m.index), token: false });
      parts.push({ text: m[0], token: true });
      last = m.index + m[0].length;
    }
    if (last < p.sanitized.length) parts.push({ text: p.sanitized.slice(last), token: false });
    const n = (p.result.changes || []).reduce((a, c) => a + c.count, 0);
    const remaining = (p.result.remaining_findings || []).filter((f) => f.action !== "allow");
    const notes = [];
    if (n && !p.verified) notes.push("복원 값을 확인하지 못해 답변의 토큰은 그대로 보입니다.");
    if (remaining.length) notes.push(`아직 확인이 필요한 항목이 ${remaining.length}건 남았습니다.`);
    if (passed(p.result) && text === p.sanitized) notes.push("입력창에 반영했습니다. 내용을 확인하고 직접 전송하세요.");
    const label = !n ? "바꿀 민감정보가 없습니다"
      : passed(p.result) ? `정제 완료: 민감 토큰 ${n}건 안전 치환됨` : `치환했지만 확인이 필요합니다 (${n}건 치환)`;
    return { parts, label, note: notes.join(" ") };
  }

  function refresh() {
    if (!enabled || !editor || !editor.isConnected) { PG.ui.hideWidget(); return; }
    const text = getText(editor);
    const hasText = !!text.trim();
    if (!hasText) { prepared = null; applied = null; }
    if (prepared && !activePrepared(text)) prepared = null;
    if (applied && text !== applied.sanitized) applied = null;
    const prep = activePrepared(text);

    let lamp = "idle";
    let result = null;
    let provisional = false;
    if (hasText) {
      if (prep) { lamp = lampOf(prep.result); result = prep.result; }
      else if (latest && latest.text === text) { lamp = badgeState(latest); result = latest.result; }
      else if (localEntry && localEntry.text === text && localEntry.result.decision !== "allow") {
        lamp = localEntry.result.decision === "block" ? "red" : "yellow";
        provisional = true;
        result = localEntry.result;
      } else lamp = "checking";
    }

    const sum = summary(result?.findings);
    let chip = "";
    if (lamp === "checking") chip = "검사 중…";
    else if (lamp === "red") chip = `Tier 1 차단${sum ? ` · ${sum}` : ""}`;
    else if (lamp === "yellow") chip = `Tier 2 주의${sum ? ` · ${sum}` : ""}`;
    else if (lamp === "green") chip = prep ? "안전: 정제 완료 (Safe to Send)" : "Tier 3 안전 · 검사 통과";
    else if (lamp === "gray") chip = latest?.error ? "검사 불가 · 전송 보류" : "검사 미완료 · 전송 보류";
    if (provisional) chip += " (서버 확인 중)";

    const serverResult = !prep && latest && latest.text === text ? latest.result : null;
    const complete = serverResult?.status === "complete";
    const findings = serverResult?.findings || [];
    const hasBlock = findings.some((f) => f.action === "block");
    const canSanitize = hasText && !prep && complete && (lamp === "red" || lamp === "yellow") && !hasBlock
      && findings.some((f) => f.action === "mask" || f.action === "warn");

    PG.ui.renderWidget({
      visible: hasText || !!notice,
      lamp,
      chip,
      reason: lamp === "idle" ? "" : destinationText(result?.destination),
      preview: prep ? previewOf(prep, text) : null,
      busy,
      canSanitize,
      canApply: !!prep && text !== prep.sanitized,
      canRevert: !!applied && text === applied.sanitized,
      canForce: hasText && !prep && complete && (lamp === "red" || lamp === "yellow"),
      chipClickable: !!serverResult && !passed(serverResult),
      notice,
      noticeTone,
    }, editor);
  }

  // ── 검사 ──
  function localInspect(text) {
    if (!PG.local || text.length > MAX_LOCAL_CHARS) return null;
    try {
      return { text, result: PG.local.inspect(text, { destination: PG.resolveDestination() }) };
    } catch {
      return null;
    }
  }

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

  const lastScheduled = new WeakMap(); // 입력창 → 마지막으로 검사를 예약한 텍스트
  const observed = new WeakSet();

  function scheduleInspect(ed) {
    clearTimeout(timer);
    latest = null; // 입력이 바뀌면 이전 결과와 전송 승인은 무효
    bypass = null;
    version++;
    const text = getText(ed);
    lastScheduled.set(ed, text);
    localEntry = text.trim() ? localInspect(text) : null;
    refresh();
    if (!enabled || !text.trim()) return;
    timer = setTimeout(async () => {
      const entry = await inspect(text);
      if (!entry || getText(ed) !== text) return;
      refresh();
    }, DEBOUNCE_MS);
  }

  // 텍스트가 실제로 바뀐 경우에만 다시 예약한다(사이트가 같은 내용을 다시 그려도 깜빡이지 않게).
  function checkIfChanged(ed) {
    if (!ed.isConnected || lastScheduled.get(ed) === getText(ed)) return;
    editor = ed;
    scheduleInspect(ed);
  }

  // Gemini·Claude 같은 편집기는 붙여넣기를 직접 처리해 'input' 이벤트를 내지 않는 경우가 있다.
  // 그러면 다음 입력이 올 때까지 위젯이 "검사 중"에 머물므로, 편집기 DOM 변화를 직접 지켜본다.
  function observeEditor(ed) {
    if (observed.has(ed)) return;
    observed.add(ed);
    new MutationObserver(() => checkIfChanged(ed))
      .observe(ed, { childList: true, subtree: true, characterData: true });
  }

  function trackEditor(ed) {
    editor = ed;
    if (ed.tagName !== "TEXTAREA") observeEditor(ed);
  }

  window.addEventListener("input", (e) => {
    const ed = editorFrom(e.target);
    if (!ed) return;
    trackEditor(ed);
    scheduleInspect(ed);
  }, true);

  window.addEventListener("focusin", (e) => {
    const ed = editorFrom(e.target);
    if (ed) trackEditor(ed);
  }, true);

  // 붙여넣기·잘라내기·끌어놓기·조합 입력이 끝난 직후 편집기가 내용을 바꾸는 시점이 사이트마다 달라서 여러 번 확인한다.
  for (const type of ["paste", "cut", "drop", "compositionend"]) {
    window.addEventListener(type, (e) => {
      const ed = editorFrom(e.target);
      if (!ed) return;
      trackEditor(ed);
      for (const delay of [0, 80, 250, 700]) setTimeout(() => checkIfChanged(ed), delay);
    }, true);
  }

  // ── 전송 가로채기 ──
  // 승인된 전송은 짧은 시간 동안 같은 텍스트에 한해 유효하다.
  // 한 번의 전송이 click → submit 처럼 여러 이벤트를 거쳐도 다시 막지 않기 위해 즉시 지우지 않는다.
  function consumeBypass(text) {
    return !!bypass && bypass.text === text && Date.now() < bypass.until;
  }

  // 사이트가 전송 후 입력창을 비우면(input 이벤트 없이) 위젯을 정리한다.
  function afterSend(ed) {
    setTimeout(() => { if (!getText(ed).trim()) refresh(); }, 400);
  }

  function triggerSend(ed, text) {
    if (testMode) { dryRun(ed, "승인 후 전송"); return; }
    const wait = SETTLE_MS - (Date.now() - lastProgrammaticSet);
    if (wait > 0) {
      setTimeout(() => { if (getText(ed) === text) triggerSend(ed, text); }, wait);
      return;
    }
    afterSend(ed);
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
    if (result) stat("sanitized");
    PG.ui.showSanitized({
      result,
      error: res?.ok ? null : res?.error,
      onBack: () => openWarning(ed, entry),
      onApply: () => apply(ed, result, entry),
    });
  }

  // 정제문을 입력창에 넣기만 하고 자동 전송하지 않는다.
  // ChatGPT(ProseMirror+React) 등은 DOM 변경을 비동기로 내부 상태에 반영하므로,
  // 바로 전송 버튼을 누르면 화면은 정제문인데 원문이 전송될 수 있다(실제 재현됨).
  // 사용자가 확인 후 직접 전송하면 그 시점에 다시 검사된다.
  // 답변의 토큰을 되돌릴 수 있게 매핑도 함께 준비한다.
  function apply(ed, result, entry) {
    if (!result?.sanitized_text) return;
    const original = getText(ed);
    const built = entry?.result
      ? PG.restore.buildTokenMap(original, entry.result.findings, result.sanitized_text)
      : { entries: {}, verified: false };
    prepared = { original, sanitized: result.sanitized_text, result, entries: built.entries, verified: built.verified };
    applied = { original, sanitized: result.sanitized_text };
    if (built.verified) PG.restore.begin(built.entries);
    else PG.restore.cancel();
    clearTimeout(timer);
    setText(ed, result.sanitized_text);
    PG.ui.toast("치환된 내용을 입력창에 넣었습니다. 확인한 뒤 직접 전송하세요.");
  }

  // ── 위젯 버튼 ──
  async function sanitizeInline() {
    const ed = editor;
    if (!ed || busy) return;
    const text = getText(ed);
    if (!text.trim()) return;
    busy = true;
    setNotice("");
    try {
      const entry = latest && latest.text === text && latest.result ? latest : await inspect(text);
      if (!entry?.result) { setNotice(`정제하지 못했습니다. ${PG.errorLabel(entry?.error || "network")}`, "warn"); return; }
      const res = await chrome.runtime.sendMessage({
        type: "sanitize", text, inputVersion: ++version, destination: PG.resolveDestination(),
      }).catch(() => ({ ok: false, error: "network" }));
      if (!res?.ok) { setNotice(`정제하지 못했습니다. ${PG.errorLabel(res?.error)}`, "warn"); return; }
      if (getText(ed) !== text) return; // 정제하는 사이 입력이 바뀜
      const result = res.data;
      if (result.sanitized_text == null) { setNotice("정제하지 못했습니다.", "warn"); return; }
      const built = PG.restore.buildTokenMap(text, entry.result.findings, result.sanitized_text);
      prepared = { original: text, sanitized: result.sanitized_text, result, entries: built.entries, verified: built.verified };
      stat("sanitized");
    } finally {
      busy = false;
      refresh();
    }
  }

  function applyPrepared() {
    const ed = editor;
    const p = ed && activePrepared(getText(ed));
    if (!p) return;
    applied = { original: getText(ed), sanitized: p.sanitized };
    if (p.verified) PG.restore.begin(p.entries);
    else PG.restore.cancel();
    clearTimeout(timer);
    setText(ed, p.sanitized);
    PG.ui.toast("정제문을 입력창에 넣었습니다. 확인한 뒤 직접 전송하세요.");
  }

  function revert() {
    const ed = editor;
    if (!ed || !applied) return;
    const { original } = applied;
    applied = null;
    prepared = null; // 원문으로 돌아갔으므로 정제 미리보기도 닫는다
    PG.restore.cancel();
    setText(ed, original);
  }

  function force() {
    const ed = editor;
    if (!ed) return;
    const text = getText(ed);
    const result = latest && latest.text === text ? latest.result : null;
    if (!result || result.status !== "complete") return;
    PG.ui.showForce({
      findings: result.findings.filter((f) => f.action !== "allow"),
      onConfirm: () => {
        if (getText(ed) !== text) return;
        stat("forced");
        triggerSend(ed, text);
      },
    });
  }

  PG.ui.setHandlers({
    sanitize: sanitizeInline,
    apply: applyPrepared,
    revert,
    force,
    details: () => {
      const ed = editor;
      if (ed && latest && latest.text === getText(ed)) showDetails(latest, ed);
    },
  });

  // 전송 허용 여부. true 면 원래 이벤트를 그대로 둔다.
  function gateSync(ed, text) {
    if (!enabled || !text.trim()) return true;
    if (consumeBypass(text)) return true;
    const ok = !!latest && latest.text === text && passed(latest.result);
    if (ok) afterSend(ed);
    return ok;
  }

  async function gate(ed, text) {
    clearTimeout(timer);
    refresh();
    const entry = await inspect(text);
    if (!entry) return;
    if (getText(ed) !== text) { scheduleInspect(ed); return; } // 검사 중 입력이 바뀜 → 보내지 않음
    refresh();
    if (passed(entry.result)) triggerSend(ed, text);
    else openWarning(ed, entry);
  }

  function block(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    stat("blocked");
    PG.ui.shakeWidget();
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

  PG.files.install();
})();
