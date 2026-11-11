"use strict";

const Flow = require("../web/flow.js");
const organization = require("./org.json");

const CASES_PATHNAME = "cases.json";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function requireToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN 환경변수가 필요합니다.");
  return token;
}

function createBlobStore() {
  const { get, list, put } = require("@vercel/blob");
  return {
    async read() {
      const token = requireToken();
      const result = await list({ prefix: CASES_PATHNAME, limit: 100, token });
      const blob = result.blobs.find((item) => item.pathname === CASES_PATHNAME);
      if (!blob) return [];
      const downloaded = await get(blob.url, { access: "private", token });
      if (!downloaded) return [];
      const body = await new Response(downloaded.stream).text();
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed)) throw new Error("Blob의 cases.json은 배열이어야 합니다.");
      return parsed;
    },
    async write(db) {
      const token = requireToken();
      await put(CASES_PATHNAME, JSON.stringify(db, null, 2), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json; charset=utf-8",
        token,
      });
    },
  };
}

function parseBody(body) {
  if (body === undefined || body === null || body === "") return null;
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString("utf8"));
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function send(response, status, payload) {
  response.statusCode = status;
  response.setHeader?.("Content-Type", "application/json; charset=utf-8");
  if (typeof response.status === "function" && typeof response.json === "function") {
    return response.status(status).json(payload);
  }
  return response.end(JSON.stringify(payload));
}

function departmentNames(org) {
  if (!Array.isArray(org)) throw new ApiError(500, "조직도 형식이 올바르지 않습니다.");
  return [...new Set(org.map((item) => String(typeof item === "string" ? item : item?.과 || "").trim()).filter(Boolean))];
}

async function recommendWithAI(requestBody, org, fetchImpl = fetch) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ApiError(500, "OPENAI_API_KEY 환경변수가 없습니다. Vercel 프로젝트 설정에 OPENAI_API_KEY를 등록한 뒤 다시 시도해 주세요.");
  }
  const requirement = String(requestBody?.요구내용 || "").trim();
  if (!requirement) throw new ApiError(400, "요구내용을 입력해 주세요.");

  const departments = departmentNames(org);
  const systemPrompt = [
    "당신은 국회 요구자료 문항의 소관 과 후보를 추천하는 보조자입니다.",
    "아래 허용 과 목록 안에서만 0개부터 최대 3개까지 추천하고, 각 후보의 근거는 한국어 한 문장으로 작성합니다.",
    "요구내용에 맞는 후보가 없으면 후보는 빈 배열, 해당없음은 true로 답합니다. 후보가 있으면 해당없음은 false로 답합니다.",
    "반드시 JSON 객체만 응답하고 다음 형식을 지킵니다: {\"후보\":[{\"과\":\"허용 과 이름\",\"근거\":\"한 문장\"}],\"해당없음\":false}",
    `허용 과 목록: ${JSON.stringify(departments)}`,
  ].join("\n");

  let response;
  try {
    response = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: requirement },
        ],
      }),
    });
  } catch (error) {
    console.error("OpenAI 요청 오류:", error?.message || "알 수 없는 오류");
    throw new ApiError(502, "AI 추천 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!response?.ok) {
    console.error("OpenAI 응답 오류:", response?.status || "응답 없음");
    throw new ApiError(502, "AI 추천 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }

  let completion;
  try {
    completion = await response.json();
  } catch {
    throw new ApiError(502, "AI 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  let result;
  try {
    const content = completion?.choices?.[0]?.message?.content;
    result = JSON.parse(content);
  } catch {
    throw new ApiError(502, "AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.");
  }
  if (!result || !Array.isArray(result.후보) || typeof result.해당없음 !== "boolean") {
    throw new ApiError(502, "AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.");
  }

  const allowed = new Set(departments);
  const candidates = [];
  for (const candidate of result.후보) {
    const department = String(candidate?.과 || "").trim();
    const reason = String(candidate?.근거 || "").trim();
    if (!allowed.has(department) || !reason || candidates.some((item) => item.과 === department)) continue;
    candidates.push({ 과: department, 근거: reason });
    if (candidates.length === 3) break;
  }
  if (result.해당없음 || !candidates.length) return { 후보: [], 해당없음: true };
  return { 후보: candidates, 해당없음: false };
}

function createHandler({ storage, org = organization, fetchImpl } = {}) {
  let activeStorage = storage;
  return async function handler(request, response) {
    try {
      activeStorage ||= createBlobStore();
      if (request.method === "GET") {
        const db = Flow.sanitizeDb(await activeStorage.read());
        return send(response, 200, db);
      }
      if (request.method !== "POST") {
        response.setHeader?.("Allow", "GET, POST");
        return send(response, 405, { error: "GET과 POST만 지원합니다." });
      }
      let command;
      try {
        command = parseBody(request.body);
      } catch {
        return send(response, 400, { error: "JSON 요청 본문을 읽지 못했습니다." });
      }
      if (command?.작업 === "AI추천") {
        return send(response, 200, await recommendWithAI(command, org, fetchImpl));
      }
      const currentDb = await activeStorage.read();
      const result = Flow.apply(currentDb, command, org);
      await activeStorage.write(result.db);
      return send(response, 200, { ok: true, 상태: result.item.상태, 사건: result.item });
    } catch (error) {
      const status = error instanceof Flow.FlowError || error instanceof ApiError ? error.status : 500;
      const message = status === 500 && !(error instanceof ApiError) ? "서버 저장소 처리 중 오류가 발생했습니다." : error.message;
      if (status === 500 && !(error instanceof ApiError)) console.error("API 처리 오류:", error?.message || "알 수 없는 오류");
      return send(response, status, { error: message });
    }
  };
}

const handler = createHandler();
module.exports = handler;
module.exports.createHandler = createHandler;
module.exports.createBlobStore = createBlobStore;
module.exports.recommendWithAI = recommendWithAI;
