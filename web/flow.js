(function attachFlow(globalObject) {
  "use strict";

  class FlowError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "FlowError";
      this.status = status;
    }
  }

  const ASSIGN_METHODS = new Set(["규칙", "AI", "수정"]);
  const SENSITIVE_COLUMN = /(이름|성명|연락처|전화|휴대전화|주민등록번호|이메일)/;

  function copy(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function timestamp(value) {
    const parsed = value ? new Date(value) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  function departmentsOf(organization) {
    if (!Array.isArray(organization)) {
      throw new FlowError(500, "조직도 형식이 올바르지 않습니다.");
    }
    return new Set(
      organization
        .map((item) => text(typeof item === "string" ? item : item?.과))
        .filter(Boolean),
    );
  }

  function requireDepartment(department, departments, label = "과") {
    const value = text(department);
    if (!value) throw new FlowError(400, `${label}가 필요합니다.`);
    if (!departments.has(value)) {
      throw new FlowError(400, `${value}은(는) 조직도에 없는 과입니다.`);
    }
    return value;
  }

  function cleanRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return {};
      return Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => !SENSITIVE_COLUMN.test(key))
          .map(([key, value]) => [text(key), copy(value)]),
      );
    });
  }

  function cleanCandidates(candidates, departments) {
    if (!Array.isArray(candidates)) return [];
    return candidates.map((candidate) => {
      const source = typeof candidate === "string" ? { 과: candidate } : candidate || {};
      const department = requireDepartment(source.과, departments, "후보 과");
      const result = { 과: department };
      if (Number.isFinite(Number(source.점수))) result.점수 = Number(source.점수);
      if (text(source.근거키워드)) result.근거키워드 = text(source.근거키워드);
      if (text(source.근거)) result.근거 = text(source.근거);
      return result;
    });
  }

  function cleanStoredCandidates(candidates) {
    if (!Array.isArray(candidates)) return [];
    return candidates.map((candidate) => {
      const source = typeof candidate === "string" ? { 과: candidate } : candidate || {};
      const result = { 과: text(source.과) };
      if (Number.isFinite(Number(source.점수))) result.점수 = Number(source.점수);
      if (text(source.근거키워드)) result.근거키워드 = text(source.근거키워드);
      if (text(source.근거)) result.근거 = text(source.근거);
      return result;
    }).filter((candidate) => candidate.과);
  }

  function cleanLogs(logs) {
    if (!Array.isArray(logs)) return [];
    return logs.map((entry) => ({
      일시: text(entry?.일시),
      작업: text(entry?.작업),
      문항: text(entry?.문항),
      처리주체: text(entry?.처리주체),
      주관과: text(entry?.주관과),
      협조과: Array.isArray(entry?.협조과) ? entry.협조과.map(text).filter(Boolean) : [],
      확정방법: text(entry?.확정방법),
      과: text(entry?.과),
      사유: text(entry?.사유),
      희망과: text(entry?.희망과),
      파일명: text(entry?.파일명),
      상태: text(entry?.상태),
    }));
  }

  function cleanReplies(replies) {
    if (!Array.isArray(replies)) return [];
    return replies.map((reply) => ({
      과: text(reply?.과),
      파일명: text(reply?.파일명),
      요구표시: text(reply?.요구표시),
      머리글: Array.isArray(reply?.머리글) ? reply.머리글.map(text) : [],
      행: cleanRows(reply?.행),
      확인필요: cleanIssues(reply?.확인필요),
      메모: text(reply?.메모),
      일시: text(reply?.일시),
    }));
  }

  function cleanIssues(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      항목: text(item?.항목),
      내용: text(item?.내용),
      행: Number.isInteger(Number(item?.행)) ? Number(item.행) : 0,
    })).filter((item) => item.항목 && item.내용);
  }

  function cleanReassignments(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      과: text(item?.과),
      사유: text(item?.사유),
      희망과: text(item?.희망과),
      일시: text(item?.일시),
    }));
  }


  function cleanComplements(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      과: text(item?.과),
      사유: text(item?.사유),
      일시: text(item?.일시),
      기준회신수: Number.isInteger(Number(item?.기준회신수)) ? Number(item.기준회신수) : 0,
    }));
  }

  function cleanCase(item) {
    return {
      id: text(item?.id),
      파일명: text(item?.파일명),
      위원회: text(item?.위원회),
      의원: text(item?.의원),
      제출기한: text(item?.제출기한),
      문항번호: text(item?.문항번호),
      요구내용: text(item?.요구내용),
      세부항목: text(item?.세부항목),
      비고: text(item?.비고),
      상태: text(item?.상태),
      주관과: text(item?.주관과),
      협조과: Array.isArray(item?.협조과) ? item.협조과.map(text).filter(Boolean) : [],
      확정방법: text(item?.확정방법),
      후보: cleanStoredCandidates(item?.후보),
      과별회신: cleanReplies(item?.과별회신),
      재배정: cleanReassignments(item?.재배정),
      보완: cleanComplements(item?.보완),
      확정코멘트: text(item?.확정코멘트),
      등록일시: text(item?.등록일시),
      수정일시: text(item?.수정일시),
      log: cleanLogs(item?.log),
    };
  }

  function sanitizeDb(db) {
    if (!Array.isArray(db)) throw new FlowError(500, "cases.json은 배열이어야 합니다.");
    return db.map(cleanCase);
  }

  function caseId(row) {
    return text(row.id) || `${text(row.파일명)}::${text(row.문항번호)}`;
  }

  function requireCase(db, request) {
    const id = text(request.id);
    if (!id) throw new FlowError(400, "문항 id가 필요합니다.");
    const index = db.findIndex((item) => item.id === id);
    if (index < 0) throw new FlowError(400, "저장된 문항을 찾지 못했습니다.");
    return { item: db[index], index };
  }

  function requireState(item, allowed, action) {
    if (!allowed.includes(item.상태)) {
      throw new FlowError(409, `${item.상태 || "상태 없음"} 상태에서는 ${action} 작업을 할 수 없습니다.`);
    }
  }

  function assignedDepartments(item) {
    return [...new Set([item.주관과, ...(item.협조과 || [])].filter(Boolean))];
  }

  function actorFor(action, request) {
    return action === "회신" || action === "재배정요청" ? text(request.과) : "총괄";
  }

  function appendLog(item, action, request, now, extra = {}) {
    item.log = [
      ...(item.log || []),
      {
        일시: now,
        작업: action,
        문항: `${item.의원}-${item.문항번호}`,
        처리주체: actorFor(action, request),
        상태: item.상태,
        ...extra,
      },
    ];
  }

  function receive(db, request, departments, now) {
    const source = request.문항 && typeof request.문항 === "object" ? request.문항 : request;
    const id = caseId(source);
    if (!id || id === "::") throw new FlowError(400, "접수할 문항의 id 또는 파일명·문항번호가 필요합니다.");
    if (db.some((item) => item.id === id)) throw new FlowError(409, `${id} 문항은 이미 접수되었습니다.`);
    if (!text(source.요구내용)) throw new FlowError(400, "요구내용이 필요합니다.");

    const item = cleanCase({
      id,
      파일명: source.파일명,
      위원회: source.위원회,
      의원: source.의원,
      제출기한: source.제출기한,
      문항번호: source.문항번호,
      요구내용: source.요구내용,
      세부항목: source.세부항목,
      비고: source.비고,
      상태: "접수",
      주관과: "",
      협조과: [],
      확정방법: "",
      후보: cleanCandidates(source.후보, departments),
      과별회신: [],
      재배정: [],
      보완: [],
      확정코멘트: "",
      등록일시: now,
      수정일시: now,
      log: [],
    });
    appendLog(item, "접수", request, now);
    db.push(item);
    return item;
  }

  function assign(db, request, departments, now) {
    const { item } = requireCase(db, request);
    requireState(item, ["접수", "재배정요청", "배분확정"], "배분");
    const lead = requireDepartment(request.주관과, departments, "주관과");
    const assists = Array.isArray(request.협조과) ? request.협조과 : [];
    const uniqueAssists = [...new Set(assists.map((value) => requireDepartment(value, departments, "협조과")))].filter(
      (value) => value !== lead,
    );
    const method = text(request.확정방법);
    if (!ASSIGN_METHODS.has(method)) {
      throw new FlowError(400, "확정방법은 규칙, AI, 수정 중 하나여야 합니다.");
    }
    item.상태 = "배분확정";
    item.주관과 = lead;
    item.협조과 = uniqueAssists;
    item.확정방법 = method;
    item.수정일시 = now;
    appendLog(item, "배분", request, now, { 주관과: lead, 협조과: uniqueAssists, 확정방법: method });
    return item;
  }

  function reply(db, request, departments, now) {
    const { item } = requireCase(db, request);
    requireState(item, ["배분확정", "회신중", "보완요청"], "회신");
    const department = requireDepartment(request.과, departments, "회신 과");
    const assigned = assignedDepartments(item);
    if (!assigned.includes(department)) {
      throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
    }
    if (item.상태 === "보완요청" && item.보완.at(-1)?.과 !== department) {
      throw new FlowError(403, "보완요청을 받은 과만 다시 회신할 수 있습니다.");
    }
    const replyItem = {
      과: department,
      파일명: text(request.파일명),
      요구표시: text(request.요구표시),
      머리글: Array.isArray(request.머리글) ? request.머리글.map(text) : [],
      행: cleanRows(request.행),
      확인필요: cleanIssues(request.확인필요),
      메모: text(request.메모),
      일시: now,
    };
    if (!replyItem.파일명 && replyItem.행.length === 0 && !replyItem.메모) {
      throw new FlowError(400, "회신 파일명, 행 또는 메모 중 하나가 필요합니다.");
    }
    item.과별회신 = [...(item.과별회신 || []), replyItem];
    const replied = new Set(item.과별회신.map((value) => value.과));
    item.상태 = assigned.every((value) => replied.has(value)) ? "회신완료" : "회신중";
    item.수정일시 = now;
    appendLog(item, "회신", request, now, { 과: department, 파일명: replyItem.파일명 });
    return item;
  }

  function requestReassignment(db, request, departments, now) {
    const { item } = requireCase(db, request);
    requireState(item, ["배분확정", "회신중", "보완요청"], "재배정요청");
    const department = requireDepartment(request.과, departments, "요청 과");
    if (!assignedDepartments(item).includes(department)) {
      throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
    }
    const reason = text(request.사유);
    if (!reason) throw new FlowError(400, "재배정요청 사유가 필요합니다.");
    const desired = text(request.희망과)
      ? requireDepartment(request.희망과, departments, "희망 과")
      : "";
    const history = { 과: department, 사유: reason, 희망과: desired, 일시: now };
    item.재배정 = [...(item.재배정 || []), history];
    item.상태 = "재배정요청";
    item.수정일시 = now;
    appendLog(item, "재배정요청", request, now, { 과: department, 사유: reason, 희망과: desired });
    return item;
  }

  function requestComplement(db, request, departments, now) {
    const { item } = requireCase(db, request);
    requireState(item, ["회신중", "회신완료"], "보완요청");
    const department = requireDepartment(request.과, departments, "보완 대상 과");
    if (!assignedDepartments(item).includes(department)) {
      throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
    }
    if (!(item.과별회신 || []).some((replyItem) => replyItem.과 === department)) {
      throw new FlowError(409, `${department}의 회신이 없어 보완을 요청할 수 없습니다.`);
    }
    const reason = text(request.사유);
    if (!reason) throw new FlowError(400, "보완요청 사유가 필요합니다.");
    const history = { 과: department, 사유: reason, 일시: now, 기준회신수: item.과별회신.length };
    item.보완 = [...(item.보완 || []), history];
    item.상태 = "보완요청";
    item.수정일시 = now;
    appendLog(item, "보완요청", request, now, { 과: department, 사유: reason });
    return item;
  }

  function confirm(db, request, now) {
    const { item } = requireCase(db, request);
    requireState(item, ["회신완료"], "확정");
    const comment = text(request.확정코멘트);
    if (!comment) throw new FlowError(400, "확정 코멘트가 필요합니다.");
    const assigned = assignedDepartments(item);
    if (!assigned.length || !assigned.every((department) =>
      item.과별회신.some((replyItem) => replyItem.과 === department))) {
      throw new FlowError(409, "모든 담당 과의 회신을 확인해 주세요.");
    }
    item.상태 = "확정";
    item.확정코멘트 = comment;
    item.수정일시 = now;
    appendLog(item, "확정", request, now, { 사유: comment });
    return item;
  }

  function apply(db, request, organization) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new FlowError(400, "JSON 요청 본문이 필요합니다.");
    }
    const nextDb = sanitizeDb(db);
    const departments = departmentsOf(organization);
    const action = text(request.작업);
    const now = timestamp(request.일시);
    let item;
    if (action === "접수") item = receive(nextDb, request, departments, now);
    else if (action === "배분") item = assign(nextDb, request, departments, now);
    else if (action === "회신") item = reply(nextDb, request, departments, now);
    else if (action === "재배정요청") item = requestReassignment(nextDb, request, departments, now);
    else if (action === "보완요청") item = requestComplement(nextDb, request, departments, now);
    else if (action === "확정") item = confirm(nextDb, request, now);
    else throw new FlowError(400, `${action || "빈 작업"}은(는) 현재 지원하지 않는 작업입니다.`);
    return { db: nextDb, item: copy(item) };
  }

  const api = { apply, sanitizeDb, FlowError };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalObject.AppFlow = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
