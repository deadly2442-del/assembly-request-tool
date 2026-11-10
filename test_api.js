"use strict";

const assert = require("node:assert/strict");
const { createHandler } = require("./api/app.js");
const organization = require("./api/org.json");

function fakeStorage() {
  let db = [];
  let writes = 0;
  return {
    async read() {
      return JSON.parse(JSON.stringify(db));
    },
    async write(next) {
      db = JSON.parse(JSON.stringify(next));
      writes += 1;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(db));
    },
    writes() {
      return writes;
    },
  };
}

async function invoke(handler, method, body) {
  const result = { status: 0, headers: {}, body: null };
  const response = {
    setHeader(name, value) {
      result.headers[name] = value;
    },
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return payload;
    },
    end(payload) {
      result.body = JSON.parse(payload);
    },
  };
  await handler({ method, body }, response);
  return result;
}

async function main() {
  const storage = fakeStorage();
  const handler = createHandler({ storage, org: organization });
  const id = "요구서.pdf::1";

  let response = await invoke(handler, "GET");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, []);

  response = await invoke(handler, "POST", {
    작업: "접수",
    문항: {
      id,
      파일명: "요구서.pdf",
      위원회: "행정안전위원회",
      의원: "의원A",
      문항번호: "1",
      요구내용: "디지털전환 사업 현황",
      이름: "저장하면 안 됨",
      연락처: "저장하면 안 됨",
      후보: [{ 과: "디지털정책과", 점수: 3.7, 근거키워드: "디지털전환" }],
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.상태, "접수");
  assert.equal("이름" in response.body.사건, false);
  assert.equal("연락처" in response.body.사건, false);

  response = await invoke(handler, "POST", {
    작업: "회신",
    id,
    과: "디지털정책과",
    메모: "순서 오류 시험",
  });
  assert.equal(response.status, 409);

  response = await invoke(handler, "POST", {
    작업: "배분",
    id,
    주관과: "없는과",
    협조과: [],
    확정방법: "수정",
  });
  assert.equal(response.status, 400);

  response = await invoke(handler, "POST", {
    작업: "배분",
    id,
    주관과: "디지털정책과",
    협조과: ["운영지원과"],
    확정방법: "규칙",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.상태, "배분확정");

  response = await invoke(handler, "POST", {
    작업: "회신",
    id,
    과: "안전정책과",
    메모: "담당 아님",
  });
  assert.equal(response.status, 403);

  response = await invoke(handler, "POST", {
    작업: "회신",
    id,
    과: "디지털정책과",
    파일명: "디지털정책과.xlsx",
    행: [{ 연도: "2026", "예산(천원)": 1000, 이름: "버림" }],
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.상태, "회신중");
  assert.equal("이름" in response.body.사건.과별회신[0].행[0], false);

  response = await invoke(handler, "POST", {
    작업: "재배정요청",
    id,
    과: "운영지원과",
    희망과: "정보화담당관",
  });
  assert.equal(response.status, 400);

  response = await invoke(handler, "POST", {
    작업: "회신",
    id,
    과: "운영지원과",
    메모: "해당 없음",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.상태, "회신완료");

  const secondId = "요구서.pdf::2";
  await invoke(handler, "POST", {
    작업: "접수",
    문항: { id: secondId, 파일명: "요구서.pdf", 문항번호: "2", 요구내용: "청사 관리 현황" },
  });
  await invoke(handler, "POST", {
    작업: "배분",
    id: secondId,
    주관과: "운영지원과",
    협조과: [],
    확정방법: "수정",
  });
  response = await invoke(handler, "POST", {
    작업: "재배정요청",
    id: secondId,
    과: "운영지원과",
    사유: "정보시스템 운영 내용이 중심임",
    희망과: "정보화담당관",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.상태, "재배정요청");

  response = await invoke(handler, "GET");
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 2);
  assert.equal(storage.snapshot()[0].과별회신.length, 2);
  assert.equal(storage.writes(), 7);

  console.log("API 시험 통과: GET, 접수, 배분, 회신중·회신완료, 재배정요청");
  console.log("오류 시험 통과: 순서 409, 조직도 밖 과 400, 담당 아닌 과 403, 사유 누락 400");
  console.log(`가짜 저장소 결과: ${response.body.length}문항, 저장 ${storage.writes()}회`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
