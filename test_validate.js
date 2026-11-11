"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("./web/lib/xlsx.full.min.js");
const Papa = require("./web/lib/papaparse.min.js");
const Validate = require("./web/validate.js");
const Flow = require("./web/flow.js");
const organization = require("./api/org.json");

function matrixFromExample(name) {
  const workbook = XLSX.read(fs.readFileSync(path.join(__dirname, "부서회신", name)), { type: "buffer" });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: false });
}

function has(issues, name) { return issues.some((entry) => entry.항목 === name); }

function main() {
  const matrix = [
    ["요구: 최근 3년간 현황"],
    ["연도", "항목", "예산(천원)", "집행액(천원)", "비고"],
    ["2024", "가", "100", "120", ""],
    ["2026", "나", "200", "180", ""],
    ["합계", "", "999", "300", ""],
  ];
  const checked = Validate.inspectReplyMatrix(matrix, "최근 3년간 현황", { referenceYear: 2026 });
  assert.deepEqual(checked.행[0], { 연도: "2024", 항목: "가", "예산(천원)": "100", "집행액(천원)": "120", 비고: "" });
  ["연도 누락", "예산 초과", "합계 불일치"].forEach((name) => assert.ok(has(checked.확인필요, name), name));
  assert.equal(checked.행[2]["예산(천원)"], "999", "원본 합계는 고치지 않는다");
  assert.ok(has(Validate.inspectReplyMatrix([["잘못된 표시"], ["연도"]], "").확인필요, "요구 표시"));
  assert.ok(has(Validate.inspectReplyMatrix([["요구: 항목"], ["연도"]], "").확인필요, "머리글"));
  const duplicateHeader = Validate.inspectReplyMatrix([["요구: 항목"], ["연도", "연도"], ["2025", "2026"]], "");
  assert.equal(duplicateHeader.행[0]["연도 (2)"], "2026", "중복 머리글의 값도 보존한다");

  const missingYear = Validate.inspectReplyMatrix(matrixFromExample("회신_지역정책과.xlsx"), "최근 5년간 위원회 운영 현황", { referenceYear: 2026 });
  const overBudget = Validate.inspectReplyMatrix(matrixFromExample("회신_안전정책과.xlsx"), "최근 5년간 위원회 운영 현황", { referenceYear: 2026 });
  const wrongTotal = Validate.inspectReplyMatrix(matrixFromExample("회신_산업정책과.xlsx"), "최근 5년간 위원회 운영 현황", { referenceYear: 2026 });
  assert.ok(has(missingYear.확인필요, "연도 누락"));
  assert.ok(has(overBudget.확인필요, "예산 초과"));
  assert.ok(has(wrongTotal.확인필요, "합계 불일치"));

  const csv = fs.readFileSync(path.join(__dirname, "data", "검증용_접수대장_120건.csv"), "utf8");
  const parsed = Papa.parse(csv.replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: "greedy" });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.data.length, 120);
  const registryIssues = Validate.validateRegistry(parsed.data, organization, { today: "2026-11-11" });
  assert.ok(registryIssues.length > 0);
  assert.ok(registryIssues.every((entry) => entry.항목 && entry.내용));
  assert.ok(has(Validate.validateRegistry([
    { 접수번호: "2026-1", 문항번호: "1", 접수일: "2026-11-02", 제출기한: "2026-11-01", 요구기간_시작: "2026", 요구기간_끝: "2024", 배분과: "없는과", 요구내용: "최근 3년", 처리상태: "접수" },
    { 접수번호: "2026-1", 문항번호: "3", 접수일: "2026-11-02", 제출기한: "2026/11/04", 배분과: "없는과", 요구내용: "  요구  " },
    { 접수번호: "2026-1", 문항번호: "3" },
  ], organization, { today: "2026-11-11" }), "문항 누락"));

  const first = organization[0].과;
  const second = organization[1].과;
  let db = [];
  function apply(request) { const result = Flow.apply(db, request, organization); db = result.db; return result.item; }
  apply({ 작업: "접수", 문항: { id: "test::1", 파일명: "test.pdf", 문항번호: "1", 요구내용: "최근 3년 현황" } });
  apply({ 작업: "배분", id: "test::1", 주관과: first, 협조과: [second], 확정방법: "수정" });
  apply({ 작업: "회신", id: "test::1", 과: first, 파일명: "a.xlsx", 행: checked.행, 확인필요: checked.확인필요 });
  assert.equal(apply({ 작업: "회신", id: "test::1", 과: second, 메모: "해당 없음" }).상태, "회신완료");
  assert.equal(apply({ 작업: "보완요청", id: "test::1", 과: first, 사유: "연도를 확인해 주세요" }).상태, "보완요청");
  assert.throws(() => apply({ 작업: "회신", id: "test::1", 과: second, 메모: "재회신" }), /보완요청을 받은 과만/);
  assert.throws(() => apply({ 작업: "확정", id: "test::1", 확정코멘트: "완료" }), /상태에서는 확정/);
  assert.equal(apply({ 작업: "회신", id: "test::1", 과: first, 메모: "보완 회신" }).상태, "회신완료");
  assert.equal(db[0].과별회신.length, 3);
  assert.equal(db[0].보완.length, 1);
  assert.throws(() => apply({ 작업: "확정", id: "test::1" }), /확정 코멘트/);
  assert.equal(apply({ 작업: "확정", id: "test::1", 확정코멘트: "원자료 대조 완료" }).상태, "확정");
  assert.equal(db[0].log.at(-1).작업, "확정");

  console.log(`점검 시험 통과: 회신 예시 3건, 검증용 접수대장 ${parsed.data.length}건(확인필요 ${registryIssues.length}건), 보완·확정 이력`);
}

main();
