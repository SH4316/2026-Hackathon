// 설정 화면: 개인 정규식 규칙 추가·시험·켜기/끄기·삭제. 규칙은 chrome.storage.local 에만 저장한다.
import {
  MAX_RULES, STORAGE_KEY, newRuleId, normalizeToken, testRule, validateRule,
} from "./personal.js";

const $ = (id) => document.getElementById(id);
const ACTION_LABELS = { mask: "치환 필요", warn: "확인 필요", block: "전송 불가" };

async function load() {
  const { [STORAGE_KEY]: rules = [] } = await chrome.storage.local.get(STORAGE_KEY);
  return rules;
}

const save = (rules) => chrome.storage.local.set({ [STORAGE_KEY]: rules });

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children.filter((c) => c != null));
  return el;
}

async function render() {
  const rules = await load();
  $("ruleEmpty").hidden = rules.length > 0;
  $("ruleList").replaceChildren(...rules.map((r) => {
    const problem = validateRule(r);
    const toggle = h("input", { type: "checkbox", checked: r.enabled !== false, title: "사용" });
    toggle.addEventListener("change", () => update(r.id, { enabled: toggle.checked }));
    const del = h("button", { type: "button", textContent: "삭제" });
    del.addEventListener("click", async () => save((await load()).filter((x) => x.id !== r.id)));
    return h("li", null,
      h("div", null,
        h("span", { className: "name", textContent: r.label }),
        h("span", { className: "muted small", textContent: ` · ${ACTION_LABELS[r.action]} · [${r.token}_n]` }),
        h("code", { textContent: r.pattern }),
        problem ? h("span", { className: "bad", textContent: `사용 안 됨: ${problem}` }) : null),
      toggle, del);
  }));
}

async function update(id, patch) {
  await save((await load()).map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

function formRule() {
  return {
    label: $("ruleLabel").value.trim(),
    pattern: $("rulePattern").value,
    action: $("ruleAction").value,
    token: normalizeToken($("ruleToken").value),
    case_sensitive: $("ruleCase").checked,
    enabled: true,
  };
}

// 시험 결과는 화면에만 그린다(textContent 로만 넣고 저장하지 않음).
function showTest() {
  const out = $("ruleTestOut");
  const sample = $("ruleSample").value;
  const rule = formRule();
  if (!rule.pattern) { out.replaceChildren(); return; }
  let hits;
  try {
    hits = testRule(rule, sample);
  } catch (e) {
    out.replaceChildren(h("span", { className: "bad", textContent: e.message }));
    return;
  }
  if (!sample) { out.replaceChildren("문법 확인됨. 시험 문장을 넣으면 일치 위치를 보여 줍니다."); return; }
  const parts = [`일치 ${hits.length}건: `];
  let last = 0;
  for (const m of hits) {
    parts.push(sample.slice(last, m.start), h("mark", { textContent: sample.slice(m.start, m.end) }));
    last = m.end;
  }
  parts.push(sample.slice(last));
  out.replaceChildren(...parts);
}

$("ruleToken").addEventListener("input", () => {
  $("tokenPreview").textContent = `[${normalizeToken($("ruleToken").value || "EMP_ID")}_1]`;
});
$("ruleTest").addEventListener("click", showTest);

$("ruleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("ruleMsg");
  const rule = { id: newRuleId(), ...formRule() };
  const problem = validateRule(rule);
  if (problem) { msg.textContent = problem; return; }
  const rules = await load();
  if (rules.length >= MAX_RULES) { msg.textContent = `규칙은 ${MAX_RULES}개까지 추가할 수 있습니다.`; return; }
  await save([...rules, rule]);
  e.target.reset();
  $("ruleTestOut").replaceChildren();
  msg.textContent = "추가했습니다. 열려 있는 AI 사이트에도 바로 적용됩니다.";
});

chrome.storage.onChanged.addListener((changes) => { if (changes[STORAGE_KEY]) render(); });
render();
