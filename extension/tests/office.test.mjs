// 문서(docx·xlsx·pptx·hwpx·odt·rtf) 글자 추출 단위 테스트: node --test tests/*.test.mjs  (브라우저·서버 없이 실행)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileLike, makeDocx, makeHwpx, makeOdt, makePptx, makeXlsx, makeZip } from "./zip.mjs";

await import("../src/office.js");
const { extractText, isDocument, legacyName } = globalThis.PG.office;

test("docx: 본문·머리글·메모·삭제된 글자까지 읽고, 위치를 문단으로 알려 준다", async () => {
  const buf = makeDocx(["첫 문단 &amp; 소개", "연락처 010-1234-5678"], {
    "word/header1.xml": '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>대외비 문서</w:t></w:r></w:p></w:hdr>',
    "word/comments.xml": '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment><w:p><w:r><w:t>메모: 비밀</w:t></w:r></w:p></w:comment></w:comments>',
  });
  const r = await extractText(fileLike("a.docx", buf));
  assert.match(r.text, /첫 문단 & 소개/);
  assert.match(r.text, /대외비 문서/);
  assert.match(r.text, /메모: 비밀/);
  assert.equal(r.where(r.text.indexOf("010-1234")), "문단 2");
  assert.equal(r.where(r.text.indexOf("대외비")), "머리글 1");
  assert.equal(r.where(r.text.indexOf("메모")), "메모 1");
  assert.match(r.label, /Word 문서/);
});

test("docx: 줄바꿈·탭·삭제된 글자, 비어 있는 문단", async () => {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>가</w:t><w:tab/><w:t>나</w:t><w:br/><w:t>다</w:t></w:r></w:p><w:p/><w:p><w:del><w:r><w:delText>지운 비밀</w:delText></w:r></w:del></w:p></w:body></w:document>';
  const r = await extractText(fileLike("b.docx", makeZip({ "word/document.xml": xml })));
  assert.match(r.text, /가\t나\n다/);
  assert.match(r.text, /지운 비밀/); // 변경 추적으로 지운 글자도 파일 안에는 남아 있다
});

test("xlsx: 공유 문자열·숫자·시트 이름, 위치는 시트!셀", async () => {
  const buf = makeXlsx([["이름", "주민번호"], ["홍길동", "900101-1234567"], ["합계", 1234]], "고객");
  const r = await extractText(fileLike("c.xlsx", buf));
  assert.match(r.text, /홍길동\t900101-1234567/);
  assert.equal(r.where(r.text.indexOf("900101")), "고객!B2");
  assert.equal(r.where(r.text.indexOf("1234\t")), "고객!B3");
  assert.match(r.label, /Excel 1개 시트/);
});

test("xlsx: 인라인 문자열과 서식 있는 문자열, 읽는 법(rPh)은 건너뜀", async () => {
  const buf = makeZip({
    "xl/workbook.xml": '<workbook xmlns:r="x"><sheets><sheet name="S" r:id="rId9"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId9" Target="/xl/worksheets/data.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><r><t>서식</t></r><r><t> 문자열</t></r><rPh><t>후리가나</t></rPh></si></sst>",
    "xl/worksheets/data.xml": '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>인라인</t></is></c></row></sheetData></worksheet>',
  });
  const r = await extractText(fileLike("d.xlsx", buf));
  assert.match(r.text, /서식 문자열\t인라인/);
  assert.doesNotMatch(r.text, /후리가나/);
});

test("pptx: 슬라이드 순서와 위치(슬라이드 n)", async () => {
  const r = await extractText(fileLike("e.pptx", makePptx([["제목"], ["고객 kim@example.com"]])));
  assert.equal(r.where(r.text.indexOf("kim@")), "슬라이드 2");
  assert.match(r.label, /PowerPoint 2장/);
});

test("hwpx: 한글 문단", async () => {
  const r = await extractText(fileLike("f.hwpx", makeHwpx(["인사 기록", "주민등록번호 900101-1234567"])));
  assert.equal(r.where(r.text.indexOf("900101")), "문단 2");
});

test("odt: 일반 텍스트와 공백·탭 요소", async () => {
  const buf = makeOdt(["가<text:s text:c=\"3\"/>나<text:tab/>다"]);
  const r = await extractText(fileLike("g.odt", buf));
  assert.match(r.text, /가 {3}나\t다/);
});

test("rtf: 한글(CP949 \\'hh)과 유니코드(\\uN)", async () => {
  const rtf = "{\\rtf1\\ansi\\ansicpg949{\\fonttbl{\\f0 Arial;}}{\\*\\generator X;}\\f0 A\\'b0\\'a1 \\u44032? B\\par Next}";
  const r = await extractText(fileLike("h.rtf", Buffer.from(rtf, "latin1")));
  assert.match(r.text, /A가 가 B/);
  assert.match(r.text, /Next/);
  assert.doesNotMatch(r.text, /Arial|generator/);
});

test("오류: 구형(OLE)·깨진 파일·암호·압축 폭탄은 이유와 함께 throw", async () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]);
  await assert.rejects(extractText(fileLike("a.docx", ole)), /ole/);
  await assert.rejects(extractText(fileLike("a.docx", Buffer.from("not a zip at all, just text"))), /corrupt/);
  await assert.rejects(extractText(fileLike("a.docx", makeZip({ "word/document.xml": "<x/>" }, { encrypted: ["word/document.xml"] }))), /encrypted/);
  await assert.rejects(extractText(fileLike("a.pdf.bin", Buffer.alloc(3))), /unsupported/);
});

test("저장(무압축)과 압축 항목이 섞여 있어도 읽는다", async () => {
  const buf = makeZip({ "word/document.xml": makeDocx(["저장됨"]).length ? (await import("./zip.mjs")).docxXml(["저장됨"]) : "" }, { store: ["word/document.xml"] });
  const r = await extractText(fileLike("i.docx", buf));
  assert.match(r.text, /저장됨/);
});

test("아주 큰 문서는 잘라서 truncated 로 알린다", async () => {
  const para = "가".repeat(2000);
  const r = await extractText(fileLike("big.docx", makeDocx(Array.from({ length: 400 }, () => para))));
  assert.equal(r.truncated, true);
  assert.ok(r.text.length >= 300_000 && r.text.length < 310_000);
});

test("형식 판별: 읽을 수 있는 문서 / 구형 이진 형식", () => {
  for (const n of ["a.docx", "a.XLSX", "a.pptx", "a.hwpx", "a.odt", "a.rtf"]) assert.equal(isDocument({ name: n }), true, n);
  for (const n of ["a.pdf", "a.txt", "a.png", "a.doc"]) assert.equal(isDocument({ name: n }), false, n);
  assert.equal(legacyName({ name: "a.doc" }), "Word(.doc)");
  assert.equal(legacyName({ name: "a.hwp" }), "한글(.hwp)");
  assert.equal(legacyName({ name: "a.docx" }), null);
});
