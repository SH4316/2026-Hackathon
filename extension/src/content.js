// 입력 감지 → 검사 → 전송 가로채기.
// - 입력이 바뀌면 이전 결과를 무효화하고(input_version), 늦게 온 응답은 버린다.
// - 전송 시점의 텍스트와 검사한 텍스트가 정확히 같고 '검사 완료 + allow' 일 때만 그대로 보낸다.
// - 선택한 검사 방식의 완료 결과만 사용한다. 기기 내 AI를 켜면 서버 연결 없이도 검사한다.
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

  let enabled = true, userEnabled = true, orgManaged = false, settingsReady = false;
  let sending = false;
  let settingsVersion = 0;
  let editor = null;
  let version = 0;
  let latest = null; // { version, text, result, error } 선택한 검사 방식의 결과
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
    orgManaged = !!(r?.data?.orgManaged || r?.data?.linkedClient?.managed);
    userEnabled = r?.data?.enabled !== false;
    enabled = userEnabled || orgManaged;
    settingsReady = !!r?.ok;
    setTestMode(!!r?.data?.testMode);
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) userEnabled = changes.enabled.newValue !== false;
    if (changes.linkedClient) orgManaged = !!changes.linkedClient.newValue?.managed;
    enabled = userEnabled || orgManaged;
    if (["enabled", "serverEnabled", "localAiEnabled", "serverUrl", "apiKey", "linkedClient", "personalRules", "ruleBundle"].some((key) => changes[key])) {
      settingsVersion++;
      version++;
      latest = null; bypass = null; prepared = null;
      PG.ui.closeModal();
      if (editor) scheduleInspect(editor);
      else refresh();
    }
    if (changes.aiState && ["ready", "error"].includes(changes.aiState.newValue?.phase) && editor) scheduleInspect(editor);
    if (changes.testMode) setTestMode(!!changes.testMode.newValue);
  });

  // A model/account/route change invalidates both text results and one-shot approvals.
  PG.siteContext.read();
  PG.siteContext.subscribe(() => {
    settingsVersion++;
    version++;
    latest = null; localEntry = null; bypass = null; prepared = null;
    if (editor?.isConnected) scheduleInspect(editor);
    else refresh();
  });

  // ── 입력창 ──
  const EDITOR_SEL = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';

  // 사용자가 실제로 보고 입력하는 입력창인가. 편집기가 내부적으로 쓰는 숨은 편집 영역은 제외한다.
  // 예) Gemini(Quill)는 붙여넣기를 처리하려고 화면 밖의 .ql-clipboard 에 잠깐 내용을 넣었다가 지운다.
  //     이 영역을 입력창으로 잘못 잡으면, 붙여넣은 직후 "빈 입력창"으로 보여 신호등이 사라진다.
  function isUserEditor(el) {
    if (el.closest('.ql-clipboard, [aria-hidden="true"], [hidden]')) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 20 && r.height >= 8 && r.right > 0;
  }

  function editorFrom(target) {
    if (!(target instanceof Element) || target.closest("#pg-root-host")) return null;
    const el = target.closest(EDITOR_SEL);
    if (!el || el.disabled || el.readOnly) return null;
    // 가장 바깥 contenteditable 을 입력창으로 본다
    let found = el;
    if (el.isContentEditable) {
      while (found.parentElement?.isContentEditable) found = found.parentElement;
    }
    return isUserEditor(found) ? found : null;
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
      const label = PG.findingLabel(f);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts].map(([l, n]) => `${l} ${n}건`).join(", ");
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
    // 입력창 오버레이는 다듬은 문장이 그대로 있을 때만 보인다(사용자가 고치거나 보내면 사라짐).
    if (applied) PG.ui.refreshTokenOverlay();
    else PG.ui.clearTokenOverlay();
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
    if (provisional) chip += " (검사 확인 중)";
    else if (result?.inspection_source === "local_ai") chip += " · 기기 내 검사";
    else if (result?.inspection_source === "server_and_local_ai") chip += " · 서버 + 기기 내 AI";

    const serverResult = !prep && latest && latest.text === text ? latest.result : null;
    const complete = serverResult?.status === "complete";
    const findings = serverResult?.findings || [];
    const hasBlock = findings.some((f) => f.action === "block");
    const canSanitize = hasText && !prep && complete && (lamp === "red" || lamp === "yellow") && !hasBlock
      && findings.some((f) => f.action === "mask" || f.action === "warn");

    PG.ui.renderWidget({
      visible: hasText || !!notice,
      siteContext: null,
      lamp,
      chip,
      reason: lamp === "idle" ? "" : [
        result?.ai_assessment?.decision !== "allow" && result?.ai_assessment
          ? "AI가 개인정보 가능성을 감지했습니다. 정확한 위치는 제공하지 않습니다." : "",
        result?.notices?.includes("server_unavailable_local_check") ? "서버 연결 실패 · 기기 내 AI와 캐시된 규칙으로 검사했습니다." : "",
        result?.notices?.includes("report_failed") ? PG.errorLabel("report_failed") : "",
      ].filter(Boolean).join(" "),
      // 정제 오버레이가 입력창에 표시된 동안 위젯 미리보기는 중복하지 않는다.
      preview: prep && text !== prep.sanitized ? previewOf(prep, text) : null,
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
      return { text, result: PG.siteContext.apply(PG.local.inspect(text, { destination: PG.resolveDestination() })) };
    } catch {
      return null;
    }
  }

  // stage: draft(입력 중) | submit(전송 직전). 조직 서버는 submit 만 대시보드에 기록한다.
  async function inspect(text, stage = "draft", sendAction) {
    const context = PG.siteContext.read();
    const v = ++version;
    const res = await chrome.runtime.sendMessage({
      type: "inspect", text, inputVersion: v, destination: PG.resolveDestination(), stage, sendAction,
    }).catch(() => ({ ok: false, error: "network" }));
    PG.siteContext.read(); // Catch a page change even before the observer callback runs.
    const entry = { version: v, text, result: res?.ok ? PG.siteContext.apply(res.data, context) : null, error: res?.ok ? null : res?.error };
    // 응답이 늦게 와서 더 새로운 요청이 있으면 버린다
    if (v !== version) return null;
    if (entry.result && String(entry.result.input_version) !== String(v)) {
      entry.result = null;
      entry.error = "invalid_inspection";
    }
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
    if (ed) { trackEditor(ed); PG.siteContext.read(); refresh(); }
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
    const approved = !!bypass && bypass.text === text && Date.now() < bypass.until;
    if (approved) {
      const consumed = bypass;
      setTimeout(() => { if (bypass === consumed) bypass = null; }, 0);
    }
    return approved;
  }

  // 사이트가 전송 후 입력창을 비우면(input 이벤트 없이) 위젯을 정리한다.
  function afterSend(ed) {
    setTimeout(() => { if (!getText(ed).trim()) refresh(); }, 400);
  }

  function triggerSend(ed, text, approvedSettings = settingsVersion) {
    PG.siteContext.read();
    if (approvedSettings !== settingsVersion || !ed.isConnected || getText(ed) !== text) return;
    if (testMode) { dryRun(ed, "승인 후 전송"); return; }
    const wait = SETTLE_MS - (Date.now() - lastProgrammaticSet);
    if (wait > 0) {
      setTimeout(() => { if (getText(ed) === text) triggerSend(ed, text, approvedSettings); }, wait);
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
    const approvedSettings = settingsVersion;
    PG.ui.showWarning({
      text: entry.text,
      result: entry.result,
      error: entry.error,
      onRetry: () => { PG.ui.closeModal(); gate(ed, entry.text); },
      onSendAnyway: () => approvedSend(ed, entry.text,
        entry.result?.decision === "block" ? "forced" : "confirmed", approvedSettings),
      // 정제는 위젯의 '안전 다듬기' 한 경로로만 한다(경고 창 → 별도 정제 창 경로는 중복이라 제거).
      // 경고 창을 닫고 바로 입력창에 반영 → 오버레이로 바뀐 부분 표시 → 사용자가 직접 전송.
      onSanitize: () => {
        PG.ui.closeModal();
        editor = ed;
        ed.focus();
        sanitizeInline();
      },
    });
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
      const context = PG.siteContext.read();
      const v = ++version;
      const res = await chrome.runtime.sendMessage({
        type: "sanitize", text, inputVersion: v, destination: PG.resolveDestination(),
      }).catch(() => ({ ok: false, error: "network" }));
      if (!res?.ok) { setNotice(`정제하지 못했습니다. ${PG.errorLabel(res?.error)}`, "warn"); return; }
      PG.siteContext.read();
      if (getText(ed) !== text || version !== v) return; // 입력·검사 설정이 바뀐 정제 결과는 폐기
      const result = PG.siteContext.apply(res.data, context);
      if (result.sanitized_text == null) { setNotice("정제하지 못했습니다.", "warn"); return; }
      const built = PG.restore.buildTokenMap(text, entry.result.findings, result.sanitized_text);
      prepared = { original: text, sanitized: result.sanitized_text, result, entries: built.entries, verified: built.verified };
      stat("sanitized");
      // 미리보기 단계를 두지 않고 바로 입력창에 넣는다. 바뀐 부분은 입력창 위 오버레이로 보여 주고,
      // [원문으로 되돌리기]로 언제든 되돌릴 수 있다. 전송은 여전히 사용자가 직접 한다.
      applyPrepared();
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
    const count = (p.result.changes || []).reduce((a, c) => a + c.count, 0);
    if (count) PG.ui.showTokenOverlay(ed, count);
    PG.ui.toast("민감정보를 토큰으로 바꿨습니다. 강조된 부분을 확인하고 직접 전송하세요.");
  }

  function revert() {
    const ed = editor;
    if (!ed || !applied) return;
    const { original } = applied;
    applied = null;
    prepared = null; // 원문으로 돌아갔으므로 정제 미리보기도 닫는다
    PG.restore.cancel();
    PG.ui.clearTokenOverlay();
    setText(ed, original);
  }

  function force() {
    const ed = editor;
    if (!ed) return;
    const text = getText(ed);
    const result = latest && latest.text === text ? latest.result : null;
    if (!result || result.status !== "complete") return;
    if (result.decision === "warn") { openWarning(ed, latest); return; }
    const approvedSettings = settingsVersion;
    PG.ui.showForce({
      aiAssessment: result.ai_assessment,
      findings: result.findings.filter((f) => f.action !== "allow"),
      onConfirm: () => {
        if (getText(ed) !== text) return;
        stat("forced");
        void approvedSend(ed, text, "forced", approvedSettings);
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
    PG.siteContext.read();
    if (!enabled || (!text.trim() && !orgManaged)) return true;
    if (consumeBypass(text)) return true;
    if (orgManaged || !settingsReady) return false;
    const ok = !!latest && latest.text === text && passed(latest.result);
    if (ok) afterSend(ed);
    return ok;
  }

  async function gate(ed, text) {
    if (sending) return;
    sending = true;
    clearTimeout(timer);
    try {
      const entry = await inspect(text, "submit", "normal");
      if (!entry) return;
      if (!ed.isConnected || getText(ed) !== text) { scheduleInspect(ed); return; }
      prepared = null;
      refresh();
      if (passed(entry.result)) triggerSend(ed, text);
      else openWarning(ed, entry);
    } finally { sending = false; }
  }

  // 관리 상태의 확인/강행 전송은 전송 직전에 실제 선택을 다시 기록한다.
  async function approvedSend(ed, text, action, approvedSettings) {
    PG.siteContext.read();
    if (sending || approvedSettings !== settingsVersion || getText(ed) !== text) return;
    if (!orgManaged) { triggerSend(ed, text, approvedSettings); return; }
    sending = true;
    clearTimeout(timer);
    try {
      const entry = await inspect(text, "submit", action);
      PG.siteContext.read();
      if (approvedSettings !== settingsVersion || !ed.isConnected || getText(ed) !== text || !entry) return;
      refresh();
      if (!entry.result || entry.result.status !== "complete") {
        setNotice("기록 실패 · 전송을 보류했습니다.", "warn");
        openWarning(ed, entry);
        return;
      }
      if (action === "confirmed" && entry.result.decision === "block") { openWarning(ed, entry); return; }
      triggerSend(ed, text, approvedSettings);
    } finally { sending = false; }
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
    if (!enabled || (!text.trim() && !orgManaged)) return;
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
