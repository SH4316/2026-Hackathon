// Read only what the current page exposes; never retain hidden account settings.
var PG = (globalThis.PG = globalThis.PG || {});
PG.siteContext = (() => {
  const unknown = () => ({ value: null, status: "unknown" });
  const observed = (value) => ({ value, status: "observed" });
  const policyText = "제공사·접근 경로 기준 / 모델별 정책 미확인";
  let last = null, semantic = "", revision = 0, timer = null;
  const listeners = new Set();
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const attr = (el, name) => clean(el.getAttribute(name));
  const label = (el) => clean(attr(el, "aria-label") || attr(el, "title") || el.textContent);
  const visible = (el) => {
    if (!el || el.hidden || el.closest('[hidden], [aria-hidden="true"], [inert], [contenteditable]:not([contenteditable="false"]), [role="textbox"], textarea, [data-message-author-role], [data-pg-root], #pg-root-host, .prose, .markdown, .model-response-text, user-query, model-response, article[data-testid^="conversation-turn"]')) return false;
    if (typeof el.getClientRects === "function" && !el.getClientRects().length) return false;
    if (typeof getComputedStyle === "function") {
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      }
    }
    return true;
  };
  const collect = (selectors) => {
    const out = [], seen = new Set();
    let scanned = 0;
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (++scanned > 500 || out.length >= 150) return out;
        if (!seen.has(el) && visible(el)) { seen.add(el); out.push(el); }
      }
    }
    return out;
  };
  const unique = (values) => {
    const distinct = [...new Set(values.filter((v) => v !== null && v !== ""))];
    return distinct.length === 1 ? observed(distinct[0]) : unknown();
  };
  const modelSelectors = {
    openai: ['[data-testid="model-switcher-dropdown-button"]'],
    anthropic: ['[data-testid="model-selector-dropdown"]', '[data-testid="model-selector"]'],
    google: ['[data-test-id="bard-mode-menu-button"]', '[data-testid="model-selector"]'],
    perplexity: ['[data-testid="model-selector"]'],
    xai: ['[data-testid="model-selector"]'],
    mistral: ['[data-testid="model-selector"]'],
  };
  function model(provider) {
    const controls = collect([...(modelSelectors[provider] || []), 'button[aria-label]', '[role="button"][aria-label]', '[role="combobox"][aria-label]']);
    const values = [];
    for (const el of controls) {
      const explicit = (modelSelectors[provider] || []).some((s) => el.matches(s));
      const a = attr(el, "aria-label");
      if (!explicit && !/^(?:selected |current |choose |select )?(?:model|모델)(?:\s*[:：,\-]|\s+)/i.test(a)) continue;
      const parse = (raw) => clean(raw.replace(/^(?:selected |current |choose |select )?(?:model|모델)\s*[:：,\-]?\s*/i, ""));
      const placeholder = (v) => !v || /^(?:(?:select|choose|change)(?:\s+(?:a|the))?(?:\s+model)?|model|모델(?: 선택| 변경)?)$/i.test(v);
      let value = parse(clean(el.textContent));
      if (placeholder(value)) value = parse(a);
      if (!placeholder(value)) values.push(value);
    }
    const result = unique(values);
    if (result.status === "observed" && /^(?:auto(?:\s*\([^)]*\))?|자동(?:\s*선택)?)$/i.test(result.value)) result.status = "unknown";
    return result;
  }
  function account(kind) {
    const controls = collect(['button[aria-label]', '[role="button"][aria-label]', '[data-testid="account-menu-button"]', '[data-testid="profile-button"]', '[data-testid="current-workspace"]', '[data-testid="current-plan"]']);
    const values = [];
    for (const el of controls) {
      const a = attr(el, "aria-label");
      const explicit = el.matches(kind === "plan" ? '[data-testid="current-plan"]' : '[data-testid="current-workspace"]');
      const pattern = kind === "plan" ? /^(?:current plan|(?:현재 )?요금제)\s*[:：]/i : /^(?:current (?:workspace|account)|(?:현재 )?(?:워크스페이스|계정))\s*[:：]/i;
      if (!explicit && !pattern.test(a)) continue;
      const value = explicit ? clean(el.textContent) : clean(a.replace(/^[^:：]+[:：]\s*/, ""));
      if (value && !/upgrade|업그레이드|@/i.test(value)) values.push(value);
    }
    return unique(values);
  }
  function checked(el) {
    const aria = attr(el, "aria-checked").toLowerCase();
    if (aria === "true" || aria === "false") return aria === "true";
    const state = attr(el, "data-state").toLowerCase();
    if (["checked", "on"].includes(state)) return true;
    if (["unchecked", "off"].includes(state)) return false;
    if (el.tagName === "INPUT" && /^(checkbox|radio)$/i.test(el.type)) return !!el.checked;
    return null;
  }
  function training() {
    const controls = collect(['[role="switch"]', '[role="checkbox"]', 'input[type="checkbox"]']);
    const values = [];
    for (const el of controls) {
      const labelledBy = attr(el, "aria-labelledby").split(/\s+/).filter(Boolean).map((id) => document.getElementById?.(id)?.textContent || "").join(" ");
      const rowTitle = el.parentElement && [...el.parentElement.children].filter((node) => node !== el).map((node) => clean(node.textContent)).find((text) => /^(?:improve the model for everyone|improve model for everyone|model improvement|keep activity|모든 사용자를 위한 모델 개선|모델 개선|활동 저장)$/i.test(text) && text.length <= 150);
      const name = clean(attr(el, "aria-label") || labelledBy || (el.labels && [...el.labels].map((l) => l.textContent).join(" ")) || el.textContent || rowTitle);
      if (/^(?:improve the model for everyone|improve model for everyone|model improvement|keep activity|모든 사용자를 위한 모델 개선|모델 개선|활동 저장)$/i.test(name)) values.push(checked(el));
    }
    return unique(values);
  }
  function optIn() {
    const values = [];
    for (const el of collect(['[role="switch"]', '[role="checkbox"]', 'input[type="checkbox"]'])) {
      const name = label(el);
      if (/^(?:training opt-in|opt[ -]in to (?:model )?training|학습 (?:동의|opt-in))$/i.test(name)) values.push(checked(el));
    }
    return unique(values);
  }
  function temporary() {
    const controls = collect(['button[aria-pressed]', '[role="button"][aria-pressed]', '[role="status"]', '[role="alert"]']);
    const values = [];
    for (const el of controls) {
      const name = label(el);
      if (!/^(?:temporary chat|temporary conversation|incognito(?: chat)?|시크릿 대화|임시 채팅|임시 대화)(?:\s+(?:is )?(?:active|on)|\s*(?:사용 중|활성화))?$/i.test(name)) continue;
      const pressed = attr(el, "aria-pressed").toLowerCase();
      if (pressed === "true" || pressed === "false") values.push(pressed === "true");
      else if (/(?:active|on|사용 중|활성화)$/i.test(name)) values.push(true);
    }
    return unique(values);
  }
  function read() {
    const destination = PG.resolveDestination();
    const provider = destination?.provider || null;
    const fixture = !!PG.isTestHost();
    const result = fixture ? {
      provider, model: observed("Local test fixture"), account: observed("Local test fixture"), plan: observed("Local test fixture"),
      training: observed(false), optIn: unknown(), temporary: observed(false), policy: observed("Local test fixture"), uncertain: false, reasons: [],
    } : {
      provider, model: provider ? model(provider) : unknown(), account: provider ? account("account") : unknown(), plan: provider ? account("plan") : unknown(),
      training: provider ? training() : unknown(), optIn: provider ? optIn() : unknown(), temporary: provider ? temporary() : unknown(),
      policy: { value: policyText, status: "unknown" }, uncertain: true,
      reasons: ["모델별 정책이 확인되지 않았습니다."],
    };
    if (!fixture) {
      if (!provider) result.reasons.push("지원되는 사이트를 확인하지 못했습니다.");
      for (const [field, text] of [["model", "선택된 모델"], ["account", "계정 또는 워크스페이스"], ["plan", "요금제"], ["training", "학습 설정"], ["temporary", "임시 대화 설정"]]) {
        if (result[field].status === "unknown") result.reasons.push(`${text}을 확인하지 못했습니다.`);
      }
    }
    const route = typeof location === "undefined" ? "" : `${location.pathname || ""}${location.search || ""}`;
    const key = JSON.stringify([result, route]);
    const changed = key !== semantic;
    if (changed) { semantic = key; revision++; }
    last = { ...result, revision, checkedAt: new Date().toISOString() };
    if (changed) for (const fn of [...listeners]) { try { fn(last); } catch (_) {} }
    return last;
  }
  function refresh() {
    read();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 150); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function apply(result, snapshot = read()) {
    return { ...result, site_context: snapshot };
  }
  if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
    new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    setInterval(refresh, 5000);
    if (typeof addEventListener === "function") { addEventListener("popstate", schedule); addEventListener("pageshow", schedule); }
  }
  return { read, current: () => last, subscribe, apply };
})();
