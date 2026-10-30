// 파일 첨부 검사. 입력창 텍스트와 달리 첨부는 사이트가 곧바로 업로드하므로,
// 이벤트를 먼저 멈추고 검사한 뒤 통과한 경우에만 같은 이벤트를 다시 보낸다.
//  - 텍스트·코드 파일: 내용을 검사 서버에서 확인, 민감정보가 있으면 첨부를 막는다.
//  - 이미지·음성·PDF 등: 내용을 분석할 수 없다고 알린다(설정에서 막기로 바꿀 수 있다).
var PG = (globalThis.PG = globalThis.PG || {});

PG.files = (() => {
  const TEXT_EXT = /\.(txt|md|csv|tsv|json|log|py|js|ts|tsx|jsx|java|c|cc|cpp|h|go|rs|sql|ya?ml|xml|html|css|sh|env|ini|toml|conf)$/i;
  const MAX_BYTES = 1_000_000;
  const MAX_CHARS = 50_000; // 서버 PG_MAX_TEXT_CHARS 기본값
  let reentry = false;
  let settings = { enabled: true, blockUnscannableFiles: false };

  const isText = (f) => (f.type.startsWith("text/") || TEXT_EXT.test(f.name)) && f.size <= MAX_BYTES;

  async function inspectText(name, text) {
    const res = await chrome.runtime.sendMessage({
      type: "inspect", text: text.slice(0, MAX_CHARS), inputVersion: `file:${name}`,
      destination: PG.resolveDestination(),
    }).catch(() => ({ ok: false, error: "network" }));
    return res?.ok ? res.data : null;
  }

  // 모두 통과하면 true. 하나라도 막히면 false.
  async function vet(files) {
    for (const f of files) {
      if (!isText(f)) {
        if (settings.blockUnscannableFiles) {
          PG.hooks.notice(`${f.name}: 내용을 검사할 수 없는 파일이라 첨부를 막았습니다.`, "warn");
          PG.hooks.stat("blocked");
          return false;
        }
        PG.hooks.notice(`${f.name}: 이미지·음성·문서는 내용을 검사하지 못합니다. 민감한 내용이 없는지 직접 확인하세요.`, "warn");
        continue;
      }
      const result = await inspectText(f.name, await f.text());
      if (!result || result.status !== "complete") {
        PG.hooks.notice(`${f.name}: 검사를 완료하지 못해 첨부를 막았습니다. 서버 연결을 확인하세요.`, "warn");
        return false;
      }
      if (result.decision === "block" || result.findings.some((x) => x.action === "mask")) {
        const names = [...new Set(result.findings.filter((x) => x.action !== "allow")
          .map((x) => PG.TYPE_LABELS[x.type] || x.type))].join(", ");
        PG.hooks.notice(`${f.name}: 민감정보(${names})가 있어 첨부를 막았습니다.`, "warn");
        PG.hooks.stat("blocked");
        return false;
      }
    }
    return true;
  }

  function redispatch(target, ev) {
    reentry = true;
    try { target.dispatchEvent(ev); } finally { reentry = false; }
  }

  function install() {
    chrome.runtime.sendMessage({ type: "settings" }).then((r) => { if (r?.data) settings = r.data; });
    chrome.storage.onChanged.addListener((c) => {
      if (c.enabled) settings.enabled = c.enabled.newValue !== false;
      if (c.blockUnscannableFiles) settings.blockUnscannableFiles = !!c.blockUnscannableFiles.newValue;
    });

    // <input type="file"> 로 고른 경우
    document.addEventListener("change", (e) => {
      const input = e.target;
      if (reentry || settings.enabled === false) return;
      if (!(input instanceof HTMLInputElement) || input.type !== "file" || !input.files?.length) return;
      const list = [...input.files];
      e.stopImmediatePropagation();
      vet(list).then((ok) => {
        if (!ok) { input.value = ""; return; }
        const dt = new DataTransfer();
        list.forEach((f) => dt.items.add(f));
        input.files = dt.files;
        redispatch(input, new Event("change", { bubbles: true }));
      });
    }, true);

    // 끌어다 놓기
    document.addEventListener("drop", (e) => {
      if (reentry || settings.enabled === false || !e.dataTransfer?.files?.length) return;
      const list = [...e.dataTransfer.files];
      const { target, clientX, clientY } = e;
      e.preventDefault();
      e.stopImmediatePropagation();
      vet(list).then((ok) => {
        if (!ok || !target) return;
        const dt = new DataTransfer();
        list.forEach((f) => dt.items.add(f));
        redispatch(target, new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX, clientY }));
      });
    }, true);

    // 붙여넣기(스크린샷·복사한 파일)
    document.addEventListener("paste", (e) => {
      if (reentry || settings.enabled === false || !e.clipboardData?.files?.length) return;
      const list = [...e.clipboardData.files];
      const text = e.clipboardData.getData("text/plain");
      const { target } = e;
      e.preventDefault();
      e.stopImmediatePropagation();
      vet(list).then((ok) => {
        if (!ok || !target) return;
        const dt = new DataTransfer();
        list.forEach((f) => dt.items.add(f));
        if (text) dt.setData("text/plain", text);
        redispatch(target, new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      });
    }, true);
  }

  return { install };
})();
