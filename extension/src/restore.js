// 정제한 요청의 답변에서 토큰([EMAIL_1] 등)을 원래 값으로 되돌려 보여 준다.
//
// 서버는 복원 매핑을 반환·저장하지 않는다(server/app/sanitize/replacer.py). 그래서 브라우저가
// 서버와 같은 규칙으로 토큰 번호를 매겨 보고, 서버가 돌려준 정제문과 한 글자도 다르지 않을 때만 매핑을 믿는다.
// 다르면 복원하지 않는다(잘못된 값으로 복원하는 것보다 토큰이 그대로 보이는 쪽이 안전하다).
// 매핑은 이 탭의 메모리에만 두고, 저장소·로그에는 남기지 않는다. 새로고침하면 사라진다.
var PG = (globalThis.PG = globalThis.PG || {});

PG.restore = (() => {
  const PREFIX_RE = /^\[(.+)_n\]$/;
  const TOKEN_SRC = "\\[[A-Z][A-Z0-9_]*_\\d+\\]";

  // findings: 원문을 검사한 /v1/inspect 결과의 findings (같은 destination 으로 검사한 것)
  function buildTokenMap(original, findings, sanitized) {
    const targets = (findings || [])
      .filter((f) => f.replacement && PREFIX_RE.test(f.replacement) && (f.action === "mask" || f.action === "warn"))
      .map((f) => ({ start: f.span.start_utf16, end: f.span.end_utf16, type: f.type,
                     prefix: f.replacement.match(PREFIX_RE)[1] }))
      .sort((a, b) => a.start - b.start);

    const seen = new Map();
    const counters = new Map();
    const entries = {};
    const assigned = [];
    for (const t of targets) {
      const value = original.slice(t.start, t.end);
      const key = `${t.type}\u0000${value}`;
      let token = seen.get(key);
      if (!token) {
        const n = (counters.get(t.prefix) || 0) + 1;
        counters.set(t.prefix, n);
        token = `[${t.prefix}_${n}]`;
        seen.set(key, token);
        entries[token] = value;
      }
      assigned.push({ start: t.start, end: t.end, token });
    }
    let rebuilt = original;
    for (const a of assigned.sort((x, y) => y.start - x.start)) {
      rebuilt = rebuilt.slice(0, a.start) + a.token + rebuilt.slice(a.end);
    }
    return { entries, verified: rebuilt === sanitized };
  }

  function restoreText(text, entries) {
    return text.replace(new RegExp(TOKEN_SRC, "g"), (t) => (Object.hasOwn(entries, t) ? entries[t] : t));
  }

  // ── 답변 영역 감시 ──
  let job = null; // { entries, before: Set<Element> }
  let timer = 0;
  let observer = null;

  function responseEls() {
    const out = new Set();
    for (const sel of PG.responseSelectors?.() || []) {
      try { document.querySelectorAll(sel).forEach((e) => out.add(e)); } catch { /* 잘못된 선택자 무시 */ }
    }
    return [...out];
  }

  // 정제한 요청 '이후에' 새로 생긴 답변에만 적용한다. 대화마다 토큰 번호가 1부터 다시 시작하므로
  // 이전 답변에 새 매핑을 적용하면 엉뚱한 값이 보일 수 있다.
  function begin(entries) {
    if (!entries || !Object.keys(entries).length) { job = null; return; }
    job = { entries, before: new Set(responseEls()) };
    if (!observer) {
      observer = new MutationObserver(() => {
        if (!job) return;
        clearTimeout(timer);
        timer = setTimeout(run, 1000); // 스트리밍이 멈춘 뒤에 한 번
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
  }

  function cancel() { job = null; }

  function run() {
    if (!job) return;
    const re = new RegExp(TOKEN_SRC, "g");
    for (const root of responseEls()) {
      if (job.before.has(root)) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest(".pg-restored")) continue;
        if (new RegExp(TOKEN_SRC).test(n.nodeValue || "")) nodes.push(n);
      }
      for (const node of nodes) {
        const value = node.nodeValue || "";
        const frag = document.createDocumentFragment();
        let last = 0;
        let changed = false;
        for (const m of value.matchAll(re)) {
          if (!Object.hasOwn(job.entries, m[0])) continue;
          frag.append(document.createTextNode(value.slice(last, m.index)));
          const span = document.createElement("span");
          span.className = "pg-restored";
          span.title = "SafePrompt 가 원래 값으로 되돌렸습니다";
          span.style.cssText = "text-decoration: underline dotted; text-underline-offset: 3px;";
          span.textContent = job.entries[m[0]];
          frag.append(span);
          last = m.index + m[0].length;
          changed = true;
        }
        if (!changed) continue;
        frag.append(document.createTextNode(value.slice(last)));
        node.replaceWith(frag);
      }
    }
  }

  return { buildTokenMap, restoreText, begin, cancel };
})();
