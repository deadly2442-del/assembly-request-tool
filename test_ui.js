"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function read(name) {
  return fs.readFileSync(path.join(__dirname, "web", name), "utf8");
}

function scriptsOf(html) {
  return [...html.matchAll(/<script(?<attributes>[^>]*)>(?<code>[\s\S]*?)<\/script>/gi)]
    .filter((match) => match.groups.code.trim())
    .map((match) => ({
      module: /type=["']module["']/i.test(match.groups.attributes),
      code: match.groups.code,
    }));
}

async function parseScripts(name, html) {
  for (const script of scriptsOf(html)) {
    if (script.module) await new vm.SourceTextModule(script.code, { identifier: name });
    else new vm.Script(script.code, { filename: name });
  }
}

function testCollectExports(html) {
  const start = html.indexOf("    function exportSelection() {");
  const end = html.indexOf('    document.querySelector("#export-xlsx").addEventListener', start);
  assert.ok(start >= 0 && end > start, "취합 내려받기 함수 누락");
  for (const id of ["export-xlsx", "export-md"]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
    assert.ok(button, `${id} 버튼 누락`);
    assert.doesNotMatch(button[0], /\bdisabled\b/, `${id} 버튼이 비활성화됨`);
  }
  const cases = [{ 의원: "홍길동", 문항번호: "1", 요구내용: "현황", 주관과: "총무과", 협조과: [], 상태: "접수" }];
  const written = [];
  const links = [];
  const context = {
    AppCommon: { loadCases: () => cases, toast: message => { throw new Error(message); } },
    XLSX: { utils: {
      book_new: () => ({ sheets: [] }),
      book_append_sheet: (book, sheet, name) => book.sheets.push(name),
      aoa_to_sheet: data => data,
      json_to_sheet: data => data,
    }, writeFile: (book, name) => written.push({ sheets: book.sheets, name }) },
    merged: () => ({ headers: ["항목", "회신과"], rows: [{ 항목: "답변", 회신과: "총무과" }] }),
    latestReplies: () => [],
    document: { body: { append: link => links.push(link) }, createElement: () => ({ click() { this.clicked = true; }, remove() { this.removed = true; } }) },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
    Blob, Intl, Date, setTimeout: () => {},
  };
  vm.runInNewContext(`${html.slice(start, end)}\nthis.exports = { exportSelection, exportWorkbook, exportMarkdown };`, context);
  context.exports.exportWorkbook();
  context.exports.exportMarkdown();
  assert.match(written[0].name, /검토용_초안.*\.xlsx$/);
  assert.ok(written[0].sheets.includes("안내") && written[0].sheets.includes("검토목록"));
  assert.match(links[0].download, /검토용_초안.*\.md$/);
  assert.ok(links[0].clicked && links[0].removed);
  cases[0].상태 = "확정";
  context.exports.exportWorkbook();
  context.exports.exportMarkdown();
  assert.match(written[1].name, /제출본.*\.xlsx$/);
  assert.ok(written[1].sheets.includes("제출목록") && !written[1].sheets.includes("안내"));
  assert.match(links[1].download, /제출본.*\.md$/);
}

async function main() {
  const index = read("index.html");
  const assign = read("assign.html");
  const dept = read("dept.html");
  const collect = read("collect.html");

  await parseScripts("index.html", index);
  await parseScripts("assign.html", assign);
  await parseScripts("dept.html", dept);
  await parseScripts("collect.html", collect);

  ["내 과", "회신 엑셀 올리기", "회신 제출", "재배정 요청", "사유(필수)", "희망 과"].forEach((label) =>
    assert.ok(dept.includes(label), `현업 화면 필수 항목 누락: ${label}`),
  );
  ["재배정 요청", "다시 배분", "과거 이력"].forEach((label) =>
    assert.ok(assign.includes(label), `배분 화면 필수 항목 누락: ${label}`),
  );
  assert.ok(index.includes('href="dept.html"'));
  assert.ok(index.includes('href="collect.html"'));
  ["검사·확정", "보완요청", "확인 완료", "검토용 초안 엑셀", "검토용 초안 Markdown", "검증용 접수대장"].forEach((label) =>
    assert.ok(collect.includes(label), `취합 화면 필수 항목 누락: ${label}`),
  );
  assert.ok(collect.indexOf('id="status-title"') < collect.indexOf('id="inspect-title"'), "현황·제출본이 검사 목록보다 먼저 보여야 합니다.");
  assert.ok(collect.includes('<details class="case-details">'), "문항별 검사 내용은 접어서 보여야 합니다.");
  testCollectExports(collect);

  console.log("화면 구조 시험 통과: 시작·배분·현업 회신·취합 스크립트 문법과 필수 항목 확인");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
