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

async function main() {
  const index = read("index.html");
  const assign = read("assign.html");
  const dept = read("dept.html");

  await parseScripts("index.html", index);
  await parseScripts("assign.html", assign);
  await parseScripts("dept.html", dept);

  ["내 과", "회신 엑셀 올리기", "회신 제출", "재배정 요청", "사유(필수)", "희망 과"].forEach((label) =>
    assert.ok(dept.includes(label), `현업 화면 필수 항목 누락: ${label}`),
  );
  ["재배정 요청", "다시 배분", "과거 이력"].forEach((label) =>
    assert.ok(assign.includes(label), `배분 화면 필수 항목 누락: ${label}`),
  );
  assert.ok(index.includes('href="dept.html"'));

  console.log("화면 구조 시험 통과: 시작·배분·현업 회신 스크립트 문법과 필수 항목 확인");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
