// 파일 첨부 검사. 입력창 텍스트와 달리 첨부는 사이트가 곧바로 업로드하므로,
// 이벤트를 먼저 멈추고 검사한 뒤 통과한 경우에만 같은 이벤트를 다시 보낸다.
//  - 텍스트·코드 파일: 내용을 검사 서버에서 확인, 민감정보가 있으면 첨부를 막는다.
//  - PDF: pdf.js 로 글자를 뽑아 같은 방식으로 검사한다(스캔본처럼 글자가 없으면 '검사 불가').
//  - 음성·영상·이미지 등: 브라우저만으로는 내용을 분석할 수 없다고 알린다(설정에서 막기로 바꿀 수 있다).
//  - 서버 글자 수 제한(50,000자)을 넘는 내용은 나눠서 모두 검사한다.
var PG = (globalThis.PG = globalThis.PG || {});

PG.files = (() => {
  const TEXT_EXT = /\.(txt|md|csv|tsv|json|log|py|js|ts|tsx|jsx|java|c|cc|cpp|h|go|rs|sql|ya?ml|xml|html|css|sh|env|ini|toml|conf)$/i;
  const MEDIA_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma|mp4|mov|mkv|webm|avi)$/i;
  const MAX_BYTES = 1_000_000; // 텍스트 파일 상한(PDF 는 pdf.js 쪽 상한)
  const MAX_CHARS = 50_000; // 서버 PG_MAX_TEXT_CHARS 기본값
  const MAX_CHUNKS = 6; // 한 파일에서 최대 30만 자까지 검사
  let reentry = false;
  let settings = { enabled: true, blockUnscannableFiles: false };

  const isText = (f) => (f.type.startsWith("text/") || TEXT_EXT.test(f.name)) && f.size <= MAX_BYTES;
  const isMedia = (f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || MEDIA_EXT.test(f.name);

  // 서버 한도에 맞게 줄바꿈·공백 근처에서 나눈다.
  function chunk(text) {
    const parts = [];
    let i = 0;
    while (i < text.length && parts.length < MAX_CHUNKS) {
      let end = Math.min(i + MAX_CHARS, text.length);
      if (end < text.length) {
        const cut = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(" ", end));
        if (cut > i + MAX_CHARS - 2000) end = cut + 1;
      }
      parts.push(text.slice(i, end));
      i = end;
    }
    return { parts, truncated: i < text.length };
  }

  async function inspectPart(name, text) {
    const res = await chrome.runtime.sendMessage({
      type: "inspect", text, inputVersion: `file:${name}`, destination: PG.resolveDestination(),
    }).catch(() => ({ ok: false, error: "network" }));
    return res?.ok ? res.data : null;
  }

  // 반환: { state: "ok" | "blocked" | "failed", types?, truncated? }
  async function inspectAll(name, text) {
    const { parts, truncated } = chunk(text);
    for (let i = 0; i < parts.length; i++) {
      const result = await inspectPart(`${name}#${i + 1}`, parts[i]);
      if (!result || result.status !== "complete") return { state: "failed" };
      if (result.decision === "block" || result.findings.some((x) => x.action === "mask")) {
        const types = [...new Set(result.findings.filter((x) => x.action !== "allow")
          .map((x) => PG.TYPE_LABELS[x.type] || x.type))];
        return { state: "blocked", types };
      }
    }
    return { state: "ok", truncated };
  }

  // 모두 통과하면 true. 하나라도 막히면 false.
  async function vet(files) {
    const done = []; // 실제로 내용을 검사해 통과한 파일 설명
    let warned = false;

    // 내용을 분석할 수 없는 파일: 설정에 따라 막거나 경고만 한다.
    const unscannable = (f, reason) => {
      if (settings.blockUnscannableFiles) {
        PG.hooks.notice(`${f.name}: ${reason} 첨부를 막았습니다.`, "warn");
        PG.hooks.stat("blocked");
        return false;
      }
      PG.hooks.notice(`${f.name}: ${reason} 민감한 내용이 없는지 직접 확인하세요.`, "warn");
      warned = true;
      return true;
    };

    for (const f of files) {
      let text = null;
      let label = "";

      if (PG.pdf.isPdf(f)) {
        let r;
        try {
          r = await PG.pdf.extractText(f);
        } catch {
          if (!unscannable(f, "PDF 를 읽지 못했습니다.")) return false;
          continue;
        }
        if (!r.text.trim()) {
          if (!unscannable(f, "글자 정보가 없는 PDF(스캔본)라 내용을 분석할 수 없습니다.")) return false;
          continue;
        }
        text = r.text;
        label = `PDF ${r.pages}쪽${r.truncated ? " 중 앞부분" : ""}`;
      } else if (isText(f)) {
        text = await f.text();
        label = "텍스트";
      } else if (isMedia(f)) {
        if (!unscannable(f, "음성·영상 파일은 이 브라우저만으로는 내용을 분석할 수 없습니다(음성 인식 서버가 필요합니다).")) return false;
        continue;
      } else if (f.type.startsWith("image/")) {
        if (!unscannable(f, "이미지는 글자를 읽을 수 없어 내용을 분석할 수 없습니다(글자 인식 서버가 필요합니다).")) return false;
        continue;
      } else {
        if (!unscannable(f, "이 형식은 내용을 분석할 수 없습니다.")) return false;
        continue;
      }

      const r = await inspectAll(f.name, text);
      if (r.state === "failed") {
        PG.hooks.notice(`${f.name}: 검사를 완료하지 못해 첨부를 막았습니다. 서버 연결을 확인하세요.`, "warn");
        return false;
      }
      if (r.state === "blocked") {
        PG.hooks.notice(`${f.name}: 민감정보(${r.types.join(", ")})가 있어 첨부를 막았습니다.`, "warn");
        PG.hooks.stat("blocked");
        return false;
      }
      if (r.truncated) {
        PG.hooks.notice(`${f.name}: 내용이 너무 길어 앞쪽 ${(MAX_CHARS * MAX_CHUNKS).toLocaleString()}자까지만 검사했습니다.`, "warn");
        warned = true;
      } else {
        done.push(`${f.name}(${label})`);
      }
    }
    // 경고가 없을 때만 "검사했다"고 알려 준다(검사가 됐는지 사용자가 알 수 있게).
    if (!warned && done.length) PG.hooks.notice(`검사 완료, 민감정보 없음: ${done.join(", ")}`, "info");
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
      PG.hooks.notice("첨부 파일을 검사하는 중…", "info");
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
      PG.hooks.notice("첨부 파일을 검사하는 중…", "info");
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
      PG.hooks.notice("첨부 파일을 검사하는 중…", "info");
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
