// 시험용 ZIP 만들기(의존성 없음). 단위 테스트와 E2E 에서 docx·xlsx·pptx·hwpx·odt 모양의 파일을 만들 때 쓴다.
import { deflateRawSync } from "node:zlib";

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** files: { "경로": 문자열|Buffer }. opts.store: 압축하지 않고 저장할 경로들, opts.encrypted: 암호 플래그를 켤 경로들 */
export function makeZip(files, opts = {}) {
  const store = new Set(opts.store || []);
  const enc = new Set(opts.encrypted || []);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const method = store.has(name) ? 0 : 8;
    const comp = method ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, "utf8");
    const flags = 0x0800 | (enc.has(name) ? 1 : 0);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Node 의 Blob 에 name 을 붙여 File 처럼 쓴다 */
export const fileLike = (name, buf) => Object.defineProperty(new Blob([buf]), "name", { value: name });

// ── 최소한의 문서 XML ──
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
export const docxXml = (paras) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${paras.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;
export const makeDocx = (paras, extra = {}) => makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": docxXml(paras), ...extra });

export const makeXlsx = (rows, sheetName = "Sheet1") => {
  const shared = [];
  const idx = (s) => { let i = shared.indexOf(s); if (i < 0) { shared.push(s); i = shared.length - 1; } return i; };
  const colName = (c) => String.fromCharCode(65 + c);
  const rowsXml = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => typeof v === "number"
    ? `<c r="${colName(ci)}${ri + 1}"><v>${v}</v></c>`
    : `<c r="${colName(ci)}${ri + 1}" t="s"><v>${idx(v)}</v></c>`).join("")}</row>`).join("");
  return makeZip({
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`,
  });
};

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
export const makePptx = (slides) => makeZip(Object.fromEntries(slides.map((paras, i) => [
  `ppt/slides/slide${i + 1}.xml`,
  `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ${A}><p:cSld><p:spTree><p:sp><p:txBody>${paras.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
])));

export const makeHwpx = (paras) => makeZip({
  "Contents/section0.xml": `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${paras.map((t) => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`).join("")}</hs:sec>`,
});

export const makeOdt = (paras) => makeZip({
  mimetype: "application/vnd.oasis.opendocument.text",
  "content.xml": `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${paras.map((t) => `<text:p>${t}</text:p>`).join("")}</office:text></office:body></office:document-content>`,
}, { store: ["mimetype"] });
