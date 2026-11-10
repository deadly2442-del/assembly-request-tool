"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Flow = require("./web/flow.js");
const organization = require("./api/org.json");
const Papa = require("./web/lib/papaparse.min.js");

const commonSource = fs.readFileSync(path.join(__dirname, "web", "common.js"), "utf8");
const historyText = fs.readFileSync(path.join(__dirname, "web", "data", "접수대장.csv"), "utf8");

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return JSON.parse(JSON.stringify(payload)); },
    async text() { return String(payload); },
  };
}

function createContext(hostname, fetchImpl, initialLocal = []) {
  let stored = JSON.stringify(initialLocal);
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    location: { hostname },
    matchMedia: () => ({ matches: false }),
    AppFlow: Flow,
    Papa,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    dispatchEvent() {},
    localStorage: {
      getItem() { return stored; },
      setItem(_key, value) { stored = value; },
    },
    fetch: fetchImpl,
  });
  vm.runInContext(commonSource, context, { filename: "web/common.js" });
  return { app: context.AppCommon, stored: () => JSON.parse(stored) };
}

async function main() {
  const local = createContext("localhost", async (url) => {
    if (url === "data/접수대장.csv") return response(historyText);
    throw new Error(`예상하지 않은 요청: ${url}`);
  });
  await local.app.initStorage();
  assert.equal(local.app.storageInfo().mode, "browser");
  await local.app.applyRequest({
    작업: "접수",
    문항: {
      id: "local::1",
      파일명: "local.pdf",
      문항번호: "1",
      요구내용: "안전교육 현황",
      후보: [{ 과: "안전정책과", 점수: 2, 근거키워드: "안전교육" }],
    },
  }, organization);
  assert.equal(local.stored().length, 1);
  assert.equal(local.stored()[0].상태, "접수");
  const history = await local.app.loadPastCases();
  assert.equal(history.length, 520);
  const similar = local.app.pastHistoryFor(local.app.loadCases()[0]);
  assert.ok(similar.count > 0);
  assert.ok(similar.recent.length <= 5);

  let serverDb = [];
  const serverCalls = [];
  const server = createContext("sample.vercel.app", async (url, options = {}) => {
    serverCalls.push({ url, method: options.method || "GET" });
    if (url !== "/api/app") throw new Error(`예상하지 않은 요청: ${url}`);
    if (!options.method || options.method === "GET") return response(serverDb);
    const result = Flow.apply(serverDb, JSON.parse(options.body), organization);
    serverDb = result.db;
    return response({ ok: true, 상태: result.item.상태, 사건: result.item });
  });
  await server.app.initStorage();
  assert.equal(server.app.storageInfo().mode, "server");
  await server.app.applyRequest({
    작업: "접수",
    문항: { id: "server::1", 파일명: "server.pdf", 문항번호: "1", 요구내용: "청사 관리" },
  }, organization);
  assert.deepEqual(serverCalls, [
    { url: "/api/app", method: "GET" },
    { url: "/api/app", method: "POST" },
  ]);
  assert.equal(serverDb.length, 1);
  assert.equal(server.app.loadCases()[0].상태, "접수");

  console.log("공통 저장 시험 통과: localhost 브라우저 저장 / *.vercel.app GET·POST / 상단 저장 표시");
  console.log(`과거 이력 시험 통과: ${history.length}건 로드 / '${similar.keyword}' ${similar.count}건 / 최근 ${similar.recent.length}건`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
