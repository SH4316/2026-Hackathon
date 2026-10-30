// 파일 첨부 검사. 입력창 텍스트와 달리 첨부는 사이트가 곧바로 업로드하므로,
// 이벤트를 먼저 멈추고 검사한 뒤 사용자가 허락한 경우에만 같은 이벤트를 다시 보낸다.
//  - 텍스트·코드 파일, PDF(pdf.js), 글자로 된 문서(Word·Excel·PowerPoint·한글 hwpx·OpenDocument·RTF): 선택한 서버/기기 내 AI로 검사한다.
//    민감정보가 있으면 어디에 있는지(PDF 는 쪽, 문서는 문단·시트와 셀·슬라이드, 텍스트는 줄) 보여 주고 "그래도 진행할지" 묻는다.
//  - 읽을 수 없는 파일(음성·영상·이미지·스캔본 PDF·구형 doc/xls/ppt/hwp·암호 문서 등): "읽을 수 없는 파일이라 안전한지 알 수 없다, 그래도 진행할지" 묻는다.
//    (설정에서 '묻지 않고 막기'로 바꿀 수 있다)
//  - 서버 글자 수 제한(50,000자)을 넘는 내용은 나눠서 모두 검사한다.
//  - 선택한 검사 경로가 완료되지 않으면 묻지 않고 막는다.
var PG = (globalThis.PG = globalThis.PG || {});

PG.files = (() => {
  const TEXT_EXT = /\.(txt|md|csv|tsv|json|log|py|js|ts|tsx|jsx|java|c|cc|cpp|h|go|rs|sql|ya?ml|xml|html|css|sh|env|ini|toml|conf)$/i;
  const MEDIA_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma|mp4|mov|mkv|webm|avi)$/i;
  const MAX_BYTES = 1_000_000; // 텍스트 파일 상한(PDF 는 pdf.js 쪽 상한)
  const MAX_CHARS = 50_000; // 서버 PG_MAX_TEXT_CHARS 기본값
  const MAX_CHUNKS = 6; // 한 파일에서 최대 30만 자까지 검사
  const MAX_SHOWN = 30; // 확인 창에 보여 줄 민감 위치 수
  const CONTEXT = 28; // 민감 값 앞뒤로 보여 줄 글자 수
  let reentry = false;
  let settingsVersion = 0;
  let settings = { enabled: true, blockUnscannableFiles: false };

  const isText = (f) => (f.type.startsWith("text/") || TEXT_EXT.test(f.name)) && f.size <= MAX_BYTES;
  const isMedia = (f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || MEDIA_EXT.test(f.name);

  // 서버 한도에 맞게 줄바꿈·공백 근처에서 나눈다. 각 조각이 전체 글자에서 시작하는 위치도 함께 돌려준다.
  function chunk(text) {
    const parts = [];
    let i = 0;
    while (i < text.length && parts.length < MAX_CHUNKS) {
      let end = Math.min(i + MAX_CHARS, text.length);
      if (end < text.length) {
        const cut = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(" ", end));
        if (cut > i + MAX_CHARS - 2000) end = cut + 1;
      }
      parts.push({ text: text.slice(i, end), start: i });
      i = end;
    }
    return { parts, truncated: i < text.length };
  }

  async function inspectPart(name, text, fileName) {
    const context = PG.siteContext.read();
    const res = await chrome.runtime.sendMessage({
      type: "inspect", text, inputVersion: `file:${name}`, destination: PG.resolveDestination(), stage: "submit", files: [{ name: fileName }],
    }).catch(() => ({ ok: false, error: "network" }));
    PG.siteContext.read();
    return res?.ok ? PG.siteContext.apply(res.data, context) : null;
  }

  // 반환: { state: "ok" | "failed", hits: [{ type, action, start, end }], truncated }
  // hits 는 전체 글자 기준 위치. 모든 조각을 끝까지 검사해서 민감한 곳을 빠짐없이 센다.
  async function inspectAll(name, text) {
    const { parts, truncated } = chunk(text);
    const hits = [];
    for (let i = 0; i < parts.length; i++) {
      const result = await inspectPart(`${name}#${i + 1}`, parts[i].text, name);
      if (!result || result.status !== "complete") return { state: "failed", hits: [], truncated };
      for (const f of result.findings) {
        if (!["mask", "block", "warn"].includes(f.action)) continue;
        hits.push({ type: f.type, rule_id: f.rule_id, reason: f.reason, action: f.action,
                    start: parts[i].start + f.span.start_utf16, end: parts[i].start + f.span.end_utf16 });
      }
      const aiWarning = result.ai_assessment && result.ai_assessment.decision !== "allow";
      if (result.decision !== "allow" && (aiWarning || !result.findings.length)) {
        hits.push({ type: "local_ai_pii", action: result.decision, unlocated: true });
      }
    }
    return { state: "ok", hits, truncated };
  }

  const lineOf = (text, pos) => {
    let n = 1;
    for (let i = text.indexOf("\n"); i !== -1 && i < pos; i = text.indexOf("\n", i + 1)) n++;
    return n;
  };

  // starts: PDF 쪽 시작 위치 배열. pos 가 속한 쪽 번호(1부터)
  const pageOf = (starts, pos) => {
    let page = 1;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= pos) page = i + 1;
    return page;
  };

  // 민감 값 앞뒤 글자를 잘라 "…앞글자 [값] 뒷글자…" 로 보여 준다.
  function excerpt(text, start, end) {
    const flat = (t) => t.replace(/\s+/g, " ");
    const value = flat(text.slice(start, Math.min(end, start + 80))) + (end - start > 80 ? "…" : "");
    return {
      before: (start > CONTEXT ? "…" : "") + flat(text.slice(Math.max(0, start - CONTEXT), start)),
      value,
      after: flat(text.slice(end, end + CONTEXT)) + (end + CONTEXT < text.length ? "…" : ""),
    };
  }

  // 모든 파일을 검사해 "묻지 않고 통과 / 물어볼 것 / 막을 것"으로 나눈다.
  // 반환: true 면 첨부 진행, false 면 첨부 안 함
  async function vet(files) {
    const asks = []; // 사용자에게 확인받을 파일들
    const done = []; // 내용을 검사해 민감정보가 없던 파일
    let partial = false;

    // 읽을 수 없는 파일: 설정에 따라 바로 막거나 사용자에게 묻는다.
    const unreadable = (f, reason) => {
      if (settings.blockUnscannableFiles) {
        PG.hooks.notice(`${f.name}: ${reason} 읽을 수 없는 파일이라 첨부를 막았습니다.`, "warn");
        PG.hooks.stat("blocked");
        return false;
      }
      asks.push({ name: f.name, kind: "unreadable", reason });
      return true;
    };

    for (const f of files) {
      let text = null;
      let label = "";
      let whereFn = null; // 글자 위치 → "2쪽" · "문단 3" · "Sheet1!B2" · "슬라이드 4" · "12줄"

      if (PG.pdf.isPdf(f)) {
        let r;
        try {
          // 쪽이 많으면 오래 걸리므로 진행 상황을 보여 준다(멈춘 것처럼 보이지 않게).
          r = await PG.pdf.extractText(f, (done, total) => {
            if (total > 5 && (done === total || done % 5 === 0)) PG.hooks.notice(`${f.name}: PDF 글자를 읽는 중… (${done}/${total}쪽)`, "info");
          });
        } catch (e) {
          const why = e?.message === "too_large" ? "파일이 너무 커서(30MB 초과) 읽지 못했습니다."
            : e?.message === "timeout" ? "읽는 데 시간이 너무 오래 걸려 중단했습니다."
            : "PDF 를 읽지 못했습니다(암호가 걸렸거나 손상된 파일일 수 있습니다).";
          if (!unreadable(f, why)) return false;
          continue;
        }
        if (!r.text.trim()) {
          if (!unreadable(f, "글자 정보가 없는 PDF(스캔본)입니다.")) return false;
          continue;
        }
        text = r.text;
        whereFn = (pos) => `${pageOf(r.starts, pos)}쪽`;
        label = `PDF ${r.pages}쪽${r.truncated ? " 중 앞부분" : ""}`;
      } else if (PG.office.isDocument(f)) {
        let r;
        try {
          r = await PG.office.extractText(f);
        } catch (e) {
          const why = {
            ole: "암호가 걸렸거나 구형 형식의 문서입니다.",
            encrypted: "암호가 걸린 문서입니다.",
            too_large: "문서가 너무 커서 읽지 못했습니다.",
          }[e?.message] || "손상되었거나 읽을 수 없는 문서입니다.";
          if (!unreadable(f, why)) return false;
          continue;
        }
        if (!r.text.trim()) {
          if (!unreadable(f, "읽을 수 있는 글자가 없는 문서입니다(그림으로만 이뤄졌을 수 있습니다).")) return false;
          continue;
        }
        text = r.text;
        whereFn = r.where;
        label = `${r.label}${r.truncated ? " 중 앞부분" : ""}`;
      } else if (PG.office.legacyName(f)) {
        if (!unreadable(f, `${PG.office.legacyName(f)} 형식은 읽을 수 없습니다(.docx·.xlsx·.pptx·.hwpx 로 저장하면 검사할 수 있습니다).`)) return false;
        continue;
      } else if (isText(f)) {
        text = await f.text();
        whereFn = (pos) => `${lineOf(text, pos)}줄`;
        label = "텍스트";
      } else if (isMedia(f)) {
        if (!unreadable(f, "음성·영상 파일은 내용을 분석할 수 없습니다(음성 인식 서버가 필요합니다).")) return false;
        continue;
      } else if (f.type.startsWith("image/")) {
        if (!unreadable(f, "이미지는 글자를 읽을 수 없습니다(글자 인식 서버가 필요합니다).")) return false;
        continue;
      } else {
        if (!unreadable(f, f.size > MAX_BYTES ? "파일이 너무 커서 분석하지 못했습니다." : "이 형식은 내용을 분석할 수 없습니다.")) return false;
        continue;
      }

      const r = await inspectAll(f.name, text);
      if (r.state === "failed") {
        PG.hooks.notice(`${f.name}: 검사를 완료하지 못해 첨부를 막았습니다. 검사 설정과 AI 준비 상태를 확인하세요.`, "warn");
        return false;
      }
      if (r.truncated) partial = true;
      if (r.hits.length) {
        const items = r.hits.slice(0, MAX_SHOWN).map((h) => h.unlocated ? {
          where: "위치 미제공", label: "문서 전체 확인 필요", action: h.action,
          before: "", value: "내용 검사에서 확인이 필요합니다.", after: "",
        } : ({
          where: whereFn(h.start),
          label: PG.findingLabel(h),
          action: h.action,
          ...excerpt(text, h.start, h.end),
        }));
        asks.push({ name: f.name, kind: "sensitive", total: r.hits.length, items });
      } else {
        done.push(`${f.name}(${label})`);
      }
    }

    if (asks.length) {
      const proceed = await PG.ui.reviewFiles(asks);
      if (!proceed) {
        PG.hooks.notice("첨부를 취소했습니다.", "info");
        PG.hooks.stat("blocked");
        return false;
      }
      if (asks.some((a) => a.kind === "sensitive")) PG.hooks.stat("forced");
      PG.hooks.notice(`확인하고 진행했습니다: ${asks.map((a) => a.name).join(", ")}`, "warn");
      return report(files, asks.some(a => a.kind === "sensitive") ? "forced" : "confirmed");
    }
    if (partial) {
      PG.hooks.notice(`내용이 너무 길어 앞쪽 ${(MAX_CHARS * MAX_CHUNKS).toLocaleString()}자까지만 검사했습니다.`, "warn");
    } else if (done.length) {
      // 검사가 실제로 됐다는 것을 사용자가 알 수 있게 알려 준다.
      PG.hooks.notice(`검사 완료, 민감정보 없음: ${done.join(", ")}`, "info");
    }
    return report(files, "normal");
  }

  // 보고용 원본은 메시지와 메모리에서만 사용한다. 보고 실패로 첨부를 취소하지 않는다.
  async function report(files, sendAction) {
    if (!settings.orgManaged && !settings.linkedClient?.managed) return true;
    try {
      for (let start = 0; start < files.length; start += 100) {
        const batch = files.slice(start, start + 100), images = [];
        let bytes = 0;
        for (const file of batch) {
          if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024 ||
              bytes + file.size > 10 * 1024 * 1024 || images.length >= 20) continue;
          const data = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
          images.push({ name: file.name, media_type: file.type, data_base64: btoa(binary) });
          bytes += file.size;
        }
        const res = await chrome.runtime.sendMessage({ type: "files:report", inputVersion: `file:${batch[0].name}`,
          destination: PG.resolveDestination(), sendAction, files: batch.map(f => ({ name: f.name })), images });
        if (!res?.ok || !res.data?.recorded) PG.hooks.notice("기록 실패 · 첨부 파일 정보를 기록하지 못했습니다. 첨부는 진행합니다.", "warn");
      }
    } catch { PG.hooks.notice("기록 실패 · 첨부 파일 정보를 기록하지 못했습니다. 첨부는 진행합니다.", "warn"); }
    return true;
  }

  function redispatch(target, ev) {
    reentry = true;
    try { target.dispatchEvent(ev); } finally { reentry = false; }
  }

  function install() {
    PG.siteContext.subscribe(() => { settingsVersion++; });
    chrome.runtime.sendMessage({ type: "settings" }).then((r) => { if (r?.data) settings = r.data; });
    chrome.storage.onChanged.addListener((c) => {
      if (["enabled", "serverEnabled", "localAiEnabled", "serverUrl", "apiKey", "personalRules", "linkedClient", "ruleBundle", "blockUnscannableFiles"].some((key) => c[key])) settingsVersion++;
      if (c.enabled) settings.enabled = c.enabled.newValue !== false || settings.orgManaged;
      if (c.linkedClient) {
        settings.linkedClient = c.linkedClient.newValue;
        settings.orgManaged = !!c.linkedClient.newValue?.managed;
        if (settings.orgManaged) settings.enabled = true;
      }
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
      PG.siteContext.read();
      const version = settingsVersion;
      vet(list).then((ok) => {
        PG.siteContext.read();
        if (!ok || version !== settingsVersion) { input.value = ""; return; }
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
      PG.siteContext.read();
      const version = settingsVersion;
      vet(list).then((ok) => {
        PG.siteContext.read();
        if (!ok || !target || version !== settingsVersion) return;
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
      PG.siteContext.read();
      const version = settingsVersion;
      vet(list).then((ok) => {
        PG.siteContext.read();
        if (!ok || !target || version !== settingsVersion) return;
        const dt = new DataTransfer();
        list.forEach((f) => dt.items.add(f));
        if (text) dt.setData("text/plain", text);
        redispatch(target, new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      });
    }, true);
  }

  return { install };
})();
