// PDF 에서 텍스트를 뽑는다(pdf.js). 뽑은 텍스트는 일반 텍스트와 같이 검사 서버로 보낸다.
// - 번들러가 없어 vendor/pdfjs 의 두 파일을 동적 import 한다. 워커는 쓰지 않고 이 스크립트 안에서 돌린다
//   (사이트 출처에서는 확장프로그램 파일로 Worker 를 만들 수 없다).
// - 스캔본처럼 글자 층이 없는 PDF 는 텍스트가 비어 나오므로 '검사 불가'로 다룬다.
var PG = (globalThis.PG = globalThis.PG || {});

PG.pdf = (() => {
  const MAX_PAGES = 200;
  const MAX_BYTES = 30_000_000;
  let lib = null;

  async function load() {
    if (lib) return lib;
    const [pdfjs, worker] = await Promise.all([
      import(chrome.runtime.getURL("vendor/pdfjs/pdf.min.mjs")),
      import(chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs")),
    ]);
    globalThis.pdfjsWorker = worker; // pdf.js 가 Worker 대신 이 모듈을 직접 쓴다
    lib = pdfjs;
    return lib;
  }

  const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

  // 반환: { text, pages, truncated, starts } — 읽지 못하면 throw
  async function extractText(file) {
    if (file.size > MAX_BYTES) throw new Error("too_large");
    const pdfjs = await load();
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false, // 사이트 CSP 에서 eval 을 막아도 동작하게
      disableFontFace: true,  // 글자만 필요하다
      useSystemFonts: false,
    });
    const doc = await task.promise;
    try {
      const pages = Math.min(doc.numPages, MAX_PAGES);
      const parts = [];
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        parts.push(content.items.map((it) => it.str + (it.hasEOL ? "\n" : "")).join(""));
        page.cleanup();
      }
      // 쪽 사이는 빈 줄로 잇는다. starts[i] 는 i+1 쪽이 합친 글자에서 시작하는 위치(민감 위치 → 쪽 번호 계산용).
      const starts = [];
      let at = 0;
      for (const part of parts) { starts.push(at); at += part.length + 2; }
      return { text: parts.join("\n\n"), pages: doc.numPages, truncated: doc.numPages > MAX_PAGES, starts };
    } finally {
      await doc.destroy();
    }
  }

  return { isPdf, extractText };
})();
