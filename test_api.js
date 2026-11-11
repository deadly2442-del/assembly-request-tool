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

function fakeOpenAIResponse(content, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] };
    },
  };
}

async function testAiRecommendations() {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  try {
    const noStorage = { async read() { throw new Error("AI추천은 저장소를 읽지 않아야 합니다."); }, async write() { throw new Error("AI추천은 저장소에 쓰지 않아야 합니다."); } };
    let capturedRequest;
    const withCandidates = createHandler({
      storage: noStorage,
      org: organization,
      async fetchImpl(url, options) {
        capturedRequest = { url, options };
        return fakeOpenAIResponse({
          후보: [
            { 과: "없는과", 근거: "조직도 밖 예시입니다." },
            { 과: "디지털정책과", 근거: "디지털전환 사업의 총괄 정책을 담당합니다." },
            { 과: "정보화담당관", 근거: "정보시스템 구축과 운영을 담당합니다." },
            { 과: "데이터정책과", 근거: "공공데이터의 정책과 개방을 담당합니다." },
            { 과: "기획재정담당관", 근거: "네 번째 후보는 제외되어야 합니다." },
          ],
          해당없음: false,
        });
      },
    });
    let response = await invoke(withCandidates, "POST", { 작업: "AI추천", 요구내용: "최근 3년간 디지털전환 사업 추진 실적" });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      후보: [
        { 과: "디지털정책과", 근거: "디지털전환 사업의 총괄 정책을 담당합니다." },
        { 과: "정보화담당관", 근거: "정보시스템 구축과 운영을 담당합니다." },
        { 과: "데이터정책과", 근거: "공공데이터의 정책과 개방을 담당합니다." },
      ],
      해당없음: false,
    });
    assert.equal(capturedRequest.url, "https://api.openai.com/v1/chat/completions");
    const sentBody = JSON.parse(capturedRequest.options.body);
    assert.equal(sentBody.model, "gpt-4o-mini");
    assert.equal(sentBody.temperature, 0);
    assert.deepEqual(sentBody.response_format, { type: "json_object" });
    assert.match(sentBody.messages[0].content, /허용 과 목록/);
    assert.match(sentBody.messages[0].content, /디지털정책과/);
    assert.match(sentBody.messages[0].content, /조직도 업무 참고/);
    assert.match(sentBody.messages[0].content, /운영지원과/);
    assert.match(sentBody.messages[0].content, /청사/);
    assert.equal(sentBody.messages[1].content, "최근 3년간 디지털전환 사업 추진 실적");

    const filteredOnly = createHandler({
      storage: noStorage,
      async fetchImpl() {
        return fakeOpenAIResponse({ 후보: [{ 과: "조직도밖과", 근거: "잘못된 과입니다." }], 해당없음: false });
      },
    });
    response = await invoke(filteredOnly, "POST", { 작업: "AI추천", 요구내용: "일반 행정업무 현황" });
    assert.equal(response.status, 502);
    assert.match(response.body.error, /유효한 과 후보/);

    const inconsistentFlag = createHandler({
      storage: noStorage,
      async fetchImpl() {
        return fakeOpenAIResponse({ 후보: [{ 과: "운영지원과", 근거: "조직도 업무를 참고한 후보입니다." }], 해당없음: true });
      },
    });
    response = await invoke(inconsistentFlag, "POST", { 작업: "AI추천", 요구내용: "일반 행정업무 현황" });
    assert.deepEqual(response.body, { 후보: [{ 과: "운영지원과", 근거: "조직도 업무를 참고한 후보입니다." }], 해당없음: false });

    const noDepartment = createHandler({
      storage: noStorage,
      async fetchImpl() {
        return fakeOpenAIResponse({ 후보: [], 해당없음: true });
      },
    });
    response = await invoke(noDepartment, "POST", { 작업: "AI추천", 요구내용: "소관 과를 찾기 어려운 요구" });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { 후보: [], 해당없음: true });

    const invalidJson = createHandler({
      storage: noStorage,
      async fetchImpl() {
        return fakeOpenAIResponse("응답 형식이 잘못되었습니다.");
      },
    });
    response = await invoke(invalidJson, "POST", { 작업: "AI추천", 요구내용: "디지털 정책 현황" });
    assert.equal(response.status, 502);
    assert.match(response.body.error, /AI 응답 형식/);

    delete process.env.OPENAI_API_KEY;
    const missingKey = createHandler({ storage: noStorage, async fetchImpl() { throw new Error("키가 없으면 호출하면 안 됩니다."); } });
    response = await invoke(missingKey, "POST", { 작업: "AI추천", 요구내용: "디지털 정책 현황" });
    assert.equal(response.status, 500);
    assert.match(response.body.error, /OPENAI_API_KEY/);
    console.log("AI 추천 시험 통과: 조직도 업무 참고, 허용 과·최대 3개 필터, 해당없음·걸러진 후보 구분, 잘못된 JSON 거부, 키 누락 안내");
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
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
  await testAiRecommendations();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
