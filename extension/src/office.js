// 글자로 된 문서(Word·Excel·PowerPoint·한글(hwpx)·OpenDocument·RTF)에서 텍스트를 뽑는다.
// PDF 와 같은 흐름으로 쓰려고 "어디에 있는지"(문단·시트와 셀·슬라이드)를 알려 주는 where(pos)도 함께 돌려준다.
//
// - docx·xlsx·pptx·hwpx·odt·ods·odp 는 ZIP 안에 XML 이 들어 있는 형식이다. 외부 라이브러리 없이
//   ZIP 을 직접 읽고(브라우저 내장 DecompressionStream) XML 은 가벼운 토큰 분해기로 읽는다.
// - 구형 이진 형식(.doc .xls .ppt .hwp)과 암호가 걸린 문서는 읽지 못한다(throw). 호출하는 쪽에서 '읽을 수 없는 파일'로 묻는다.
// - 원문은 이 탭의 메모리에서만 다루고 어디에도 저장하지 않는다.
var PG = (globalThis.PG = globalThis.PG || {});

PG.office = (() => {
  const MAX_FILE = 30_000_000;
  const MAX_ENTRY = 60_000_000; // ZIP 폭탄 방지: 압축을 푼 뒤 크기 상한
  const MAX_TEXT = 300_000; // 서버 검사 한도(5만 자 × 6조각)와 같은 상한

  const ZIP_KIND = {
    docx: "word", docm: "word", dotx: "word", dotm: "word",
    xlsx: "excel", xlsm: "excel", xltx: "excel", xltm: "excel",
    pptx: "ppt", pptm: "ppt", potx: "ppt", potm: "ppt", ppsx: "ppt", ppsm: "ppt",
    hwpx: "hwpx",
    odt: "odf", ott: "odf", ods: "odf", ots: "odf", odp: "odf", otp: "odf",
  };
  const LEGACY = {
    doc: "Word(.doc)", dot: "Word(.dot)", xls: "Excel(.xls)", xlt: "Excel(.xlt)",
    ppt: "PowerPoint(.ppt)", pps: "PowerPoint(.pps)", hwp: "한글(.hwp)",
  };
  const extOf = (name) => ((name.match(/\.([A-Za-z0-9]+)$/) || [])[1] || "").toLowerCase();

  /** 이 모듈이 글자를 뽑을 수 있는 문서인가(ZIP 계열과 RTF). */
  const isDocument = (f) => !!ZIP_KIND[extOf(f.name)] || extOf(f.name) === "rtf";
  /** 구형 이진 형식이면 사람이 읽는 이름(예: "Word(.doc)"), 아니면 null */
  const legacyName = (f) => LEGACY[extOf(f.name)] || null;

  // ── 위치 표시(문단·시트·슬라이드) ──
  class Doc {
    constructor() { this.text = ""; this.marks = []; this.truncated = false; this.units = 0; }
    full() { return this.text.length >= MAX_TEXT; }
    // label 은 이 조각이 시작하는 위치에 붙는다. sep 은 조각 뒤에 붙일 구분 글자.
    add(label, s, sep = "\n") {
      if (this.full()) { this.truncated = true; return; }
      this.marks.push({ start: this.text.length, label });
      this.text += s + sep;
      this.units++;
    }
    where(pos) {
      let lo = 0, hi = this.marks.length - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.marks[mid].start <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return this.marks[ans]?.label ?? "문서";
    }
  }

  // ── ZIP ──
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function openZip(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    // 암호가 걸린 Office 문서와 구형 문서는 ZIP 이 아니라 OLE(CFB) 컨테이너다.
    if (buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) throw new Error("ole");
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("corrupt");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    if (count === 0xffff || p === 0xffffffff) throw new Error("zip64");
    const entries = new Map();
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt");
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
      entries.set(name, { flags, method, csize, usize, lho });
      p += 46 + nlen + xlen + clen;
    }
    const names = [...entries.keys()];
    async function read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.flags & 1) throw new Error("encrypted");
      if (e.usize > MAX_ENTRY) throw new Error("too_large");
      const nlen = dv.getUint16(e.lho + 26, true);
      const xlen = dv.getUint16(e.lho + 28, true);
      const start = e.lho + 30 + nlen + xlen;
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return inflate(data);
      throw new Error("corrupt");
    }
    return { names, read, text: async (n) => { const b = await read(n); return b ? dec.decode(b) : null; } };
  }

  // ── XML 토큰 분해기 ──
  // DOM 없이 동작해(Node 단위 테스트 가능) 큰 시트도 메모리를 적게 쓴다. 이름은 접두어를 뗀 지역 이름만 쓴다.
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const unesc = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) =>
    g[0] === "#" ? String.fromCodePoint(g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : ENT[g]);
  const TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][^\s/>]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const ATTR_RE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const local = (n) => n.slice(n.indexOf(":") + 1);

  function* tokens(xml) {
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(xml))) {
      if (m[1] !== undefined) { yield { t: "text", text: m[1] }; continue; }
      if (m[3] !== undefined) {
        const name = local(m[3]);
        if (m[2]) { yield { t: "close", name }; continue; }
        const attrs = {};
        if (m[4]) for (const a of m[4].matchAll(ATTR_RE)) attrs[local(a[1])] = unesc(a[2] ?? a[3]);
        yield { t: "open", name, attrs };
        if (m[5]) yield { t: "close", name };
        continue;
      }
      if (m[6] !== undefined) yield { t: "text", text: unesc(m[6]) };
    }
  }

  // Word·PowerPoint·한글(hwpx): <p> 문단 안의 <t> 글자만 모은다. 줄바꿈·탭도 반영한다.
  function paragraphs(xml, textNames = ["t", "delText"]) {
    const out = [];
    const stack = [];
    let inT = 0;
    for (const tk of tokens(xml)) {
      if (tk.t === "open") {
        if (tk.name === "p") stack.push("");
        else if (textNames.includes(tk.name)) inT++;
        else if (stack.length && (tk.name === "br" || tk.name === "lineBreak")) stack[stack.length - 1] += "\n";
        else if (stack.length && tk.name === "tab") stack[stack.length - 1] += "\t";
      } else if (tk.t === "close") {
        if (tk.name === "p") { const s = stack.pop(); if (s && s.trim()) out.push(s); }
        else if (textNames.includes(tk.name)) inT = Math.max(0, inT - 1);
      } else if (inT && stack.length) stack[stack.length - 1] += tk.text;
    }
    return out;
  }

  const byNumber = (re) => (a, b) => Number(a.match(re)[1]) - Number(b.match(re)[1]);

  async function word(zip, doc) {
    const parts = [
      [/^word\/document\.xml$/, "문단"],
      [/^word\/header\d*\.xml$/, "머리글"],
      [/^word\/footer\d*\.xml$/, "바닥글"],
      [/^word\/footnotes\.xml$/, "각주"],
      [/^word\/endnotes\.xml$/, "미주"],
      [/^word\/comments\.xml$/, "메모"],
    ];
    for (const [re, label] of parts) {
      for (const name of zip.names.filter((n) => re.test(n))) {
        const xml = await zip.text(name);
        paragraphs(xml).forEach((s, i) => doc.add(`${label} ${i + 1}`, s));
      }
    }
    return `Word 문서 ${doc.units}문단`;
  }

  async function ppt(zip, doc) {
    const slides = zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber(/slide(\d+)\.xml$/));
    for (const name of slides) {
      const n = name.match(/slide(\d+)\.xml$/)[1];
      for (const s of paragraphs(await zip.text(name))) doc.add(`슬라이드 ${n}`, s);
    }
    const notes = zip.names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).sort(byNumber(/notesSlide(\d+)\.xml$/));
    for (const name of notes) {
      const n = name.match(/notesSlide(\d+)\.xml$/)[1];
      for (const s of paragraphs(await zip.text(name))) doc.add(`슬라이드 ${n} 노트`, s);
    }
    return `PowerPoint ${slides.length}장`;
  }

  async function hwpx(zip, doc) {
    const sections = zip.names.filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort(byNumber(/section(\d+)\.xml$/));
    let k = 0;
    for (const name of sections) for (const s of paragraphs(await zip.text(name))) doc.add(`문단 ${++k}`, s);
    return `한글(hwpx) ${k}문단`;
  }

  // Excel: 공유 문자열 + 시트별 셀. 위치는 "시트이름!B3" 처럼 보여 준다.
  function sharedStrings(xml) {
    const out = [];
    let cur = null, inT = 0, inPh = 0;
    for (const tk of tokens(xml)) {
      if (tk.t === "open") {
        if (tk.name === "si") cur = "";
        else if (tk.name === "rPh") inPh++;
        else if (tk.name === "t") inT++;
      } else if (tk.t === "close") {
        if (tk.name === "si") { out.push(cur ?? ""); cur = null; }
        else if (tk.name === "rPh") inPh = Math.max(0, inPh - 1);
        else if (tk.name === "t") inT = Math.max(0, inT - 1);
      } else if (cur !== null && inT && !inPh) cur += tk.text;
    }
    return out;
  }

  async function sheetList(zip) {
    const wb = await zip.text("xl/workbook.xml");
    const rels = await zip.text("xl/_rels/workbook.xml.rels");
    const target = {};
    if (rels) for (const tk of tokens(rels)) if (tk.t === "open" && tk.name === "Relationship") target[tk.attrs.Id] = tk.attrs.Target;
    const sheets = [];
    if (wb) for (const tk of tokens(wb)) if (tk.t === "open" && tk.name === "sheet") {
      const t = target[tk.attrs.id];
      const path = t ? (t.startsWith("/") ? t.slice(1) : `xl/${t}`) : `xl/worksheets/sheet${sheets.length + 1}.xml`;
      sheets.push({ name: tk.attrs.name || `시트${sheets.length + 1}`, path });
    }
    return sheets;
  }

  async function excel(zip, doc) {
    const sstXml = await zip.text("xl/sharedStrings.xml");
    const shared = sstXml ? sharedStrings(sstXml) : [];
    const sheets = await sheetList(zip);
    for (const sh of sheets) {
      const xml = await zip.text(sh.path);
      if (!xml) continue;
      let cell = null, inV = 0, inIs = 0, inT = 0, rowHas = false;
      for (const tk of tokens(xml)) {
        if (tk.t === "open") {
          if (tk.name === "c") cell = { ref: tk.attrs.r || "", type: tk.attrs.t || "n", v: "", is: "" };
          else if (cell && tk.name === "v") inV++;
          else if (cell && tk.name === "is") inIs++;
          else if (cell && inIs && tk.name === "t") inT++;
        } else if (tk.t === "close") {
          if (tk.name === "v") inV = Math.max(0, inV - 1);
          else if (tk.name === "is") inIs = Math.max(0, inIs - 1);
          else if (tk.name === "t") inT = Math.max(0, inT - 1);
          else if (tk.name === "c" && cell) {
            const value = cell.type === "s" ? (shared[Number(cell.v)] ?? "")
              : cell.type === "inlineStr" ? cell.is : cell.v;
            if (String(value).trim()) { doc.add(`${sh.name}!${cell.ref}`, String(value), "\t"); rowHas = true; }
            cell = null;
          } else if (tk.name === "row" && rowHas) { doc.text += "\n"; rowHas = false; }
        } else if (cell && inV) cell.v += tk.text;
        else if (cell && inIs && inT) cell.is += tk.text;
        if (doc.full()) { doc.truncated = true; break; }
      }
    }
    return `Excel ${sheets.length}개 시트`;
  }

  // OpenDocument: 글자가 <text:p>·<text:h> 안의 일반 텍스트다. 위치는 슬라이드/표 이름/문단 번호.
  async function odf(zip, doc) {
    const xml = await zip.text("content.xml");
    if (!xml) throw new Error("corrupt");
    const stack = [];
    let k = 0, slide = 0, inSlide = false, table = null;
    for (const tk of tokens(xml)) {
      if (tk.t === "open") {
        if (tk.name === "p" || tk.name === "h") stack.push("");
        else if (tk.name === "page") { slide++; inSlide = true; }
        else if (tk.name === "table") table = tk.attrs.name || "표";
        else if (stack.length && tk.name === "s") stack[stack.length - 1] += " ".repeat(Number(tk.attrs.c) || 1);
        else if (stack.length && tk.name === "tab") stack[stack.length - 1] += "\t";
        else if (stack.length && tk.name === "line-break") stack[stack.length - 1] += "\n";
      } else if (tk.t === "close") {
        if (tk.name === "p" || tk.name === "h") {
          const s = stack.pop();
          if (s && s.trim()) { k++; doc.add(inSlide ? `슬라이드 ${slide}` : table ? `표 ${table}` : `문단 ${k}`, s); }
        } else if (tk.name === "page") inSlide = false;
        else if (tk.name === "table") table = null;
      } else if (stack.length) stack[stack.length - 1] += tk.text;
    }
    return `OpenDocument ${doc.units}문단`;
  }

  // RTF: 제어어를 걷어 내고 글자만 남긴다. \'hh 는 한글(CP949) 바이트, \uN 은 유니코드.
  function rtfToText(src) {
    const SKIP = /^(\*|fonttbl|colortbl|stylesheet|info|pict|object|header|footer|footnote|themedata|colorschememapping|latentstyles|datastore)/;
    let out = "", i = 0, depth = 0, skipDepth = 0, uc = 1, bytes = [];
    const flush = () => { if (bytes.length) { out += new TextDecoder("euc-kr").decode(new Uint8Array(bytes)); bytes = []; } };
    while (i < src.length) {
      const c = src[i];
      if (c === "{") {
        depth++;
        if (!skipDepth && SKIP.test(src.slice(i + 1).replace(/^\\/, "").slice(0, 16))) skipDepth = depth;
        i++;
      } else if (c === "}") {
        if (skipDepth === depth) skipDepth = 0;
        depth = Math.max(0, depth - 1);
        i++;
      } else if (c === "\\") {
        const m = /^\\(?:([a-zA-Z]+)(-?\d+)? ?|'([0-9a-fA-F]{2})|([\s\S]))/.exec(src.slice(i, i + 40));
        if (!m) { i++; continue; }
        i += m[0].length;
        if (skipDepth) continue;
        if (m[3] !== undefined) { bytes.push(parseInt(m[3], 16)); continue; }
        flush();
        if (m[1]) {
          if (m[1] === "par" || m[1] === "line") out += "\n";
          else if (m[1] === "tab") out += "\t";
          else if (m[1] === "uc") uc = Number(m[2] ?? 1);
          else if (m[1] === "u") {
            const n = Number(m[2]);
            out += String.fromCharCode(n < 0 ? n + 65536 : n);
            for (let s = 0; s < uc && i < src.length; s++) {
              if (src[i] === "\\" && src[i + 1] === "'") i += 4; else i++;
            }
          }
        } else if (m[4] === "\n" || m[4] === "\r") {
          out += "\n"; // 백슬래시 뒤의 실제 줄바꿈은 \par 와 같다(macOS textutil 이 이렇게 쓴다)
          if (m[4] === "\r" && src[i] === "\n") i++;
        } else if (m[4] && "\\{}".includes(m[4])) out += m[4];
      } else {
        if (!skipDepth && c !== "\r" && c !== "\n") { flush(); out += c; }
        i++;
      }
    }
    flush();
    return out;
  }

  async function rtf(file, doc) {
    const src = new TextDecoder("windows-1252").decode(new Uint8Array(await file.arrayBuffer()));
    const text = rtfToText(src);
    text.split("\n").forEach((s, i) => { if (s.trim()) doc.add(`문단 ${i + 1}`, s); });
    return "RTF 문서";
  }

  // 반환: { text, label, where(pos), truncated }   (읽지 못하면 throw: ole·encrypted·corrupt·too_large·legacy …)
  async function extractText(file) {
    if (file.size > MAX_FILE) throw new Error("too_large");
    const ext = extOf(file.name);
    const doc = new Doc();
    let label;
    if (ext === "rtf") {
      label = await rtf(file, doc);
    } else {
      const kind = ZIP_KIND[ext];
      if (!kind) throw new Error("unsupported");
      const zip = await openZip(file);
      label = await { word, excel, ppt, hwpx, odf }[kind](zip, doc);
    }
    return { text: doc.text, label, where: (pos) => doc.where(pos), truncated: doc.truncated };
  }

  return { isDocument, legacyName, extractText, _internal: { tokens, paragraphs, rtfToText } };
})();
