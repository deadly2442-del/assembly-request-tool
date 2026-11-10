"use strict";

const Flow = require("../web/flow.js");
const organization = require("./org.json");

const CASES_PATHNAME = "cases.json";

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

function createHandler({ storage, org = organization } = {}) {
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
      const currentDb = await activeStorage.read();
      const result = Flow.apply(currentDb, command, org);
      await activeStorage.write(result.db);
      return send(response, 200, { ok: true, 상태: result.item.상태, 사건: result.item });
    } catch (error) {
      const status = error instanceof Flow.FlowError ? error.status : 500;
      const message = status === 500 ? "서버 저장소 처리 중 오류가 발생했습니다." : error.message;
      if (status === 500) console.error("API 처리 오류:", error?.message || "알 수 없는 오류");
      return send(response, status, { error: message });
    }
  };
}

const handler = createHandler();
module.exports = handler;
module.exports.createHandler = createHandler;
module.exports.createBlobStore = createBlobStore;
