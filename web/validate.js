(function attachValidate(globalObject) {
  "use strict";

  const COMMON_HEADERS = ["연도", "예산(천원)", "집행액(천원)", "비고"];
  const MONEY_HEADERS = ["예산(천원)", "집행액(천원)"];
  const text = (value) => String(value ?? "").trim();
  const issue = (항목, 내용, 행 = 0) => ({ 항목, 내용, 행 });

  function number(value) {
    const raw = text(value).replaceAll(",", "");
    if (!raw) return null;
    return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  }

  function year(value) {
    const raw = text(value);
    return /^\d{4}$/.test(raw) ? Number(raw) : null;
  }

  function expectedYears(requirement, referenceYear = new Date().getFullYear()) {
    const match = text(requirement).match(/최근\s*(\d{1,2})\s*년/);
    if (!match) return [];
    const count = Number(match[1]);
    if (count < 1 || count > 30) return [];
    return Array.from({ length: count }, (_, index) => referenceYear - count + index + 1);
  }

  function isTotal(row) {
    return Object.values(row || {}).some((value) => /^합계$/.test(text(value)));
  }

  function validateReplyRows(rows, requirement, options = {}) {
    const issues = [];
    if (!Array.isArray(rows)) return [issue("형식", "회신 행을 읽지 못했습니다.")];
    const years = expectedYears(requirement, options.referenceYear);
    const detail = rows.filter((row) => !isTotal(row));
    const present = new Set(detail.map((row) => year(row.연도)).filter((value) => value !== null));
    for (const year of years) {
      if (!present.has(year)) issues.push(issue("연도 누락", `${year}년 자료가 없습니다. 자료가 없으면 비고에 해당 없음을 적어 주세요.`));
    }
    rows.forEach((row, index) => {
      if (isTotal(row)) return;
      const budget = number(row["예산(천원)"]);
      const spent = number(row["집행액(천원)"]);
      if ((Number.isNaN(budget) || Number.isNaN(spent)) &&
          (text(row["예산(천원)"]) || text(row["집행액(천원)"]))) {
        issues.push(issue("금액 형식", "예산·집행액은 천원 단위 숫자로 확인해 주세요.", index + 3));
      } else if (budget !== null && spent !== null && spent > budget && !text(row.비고)) {
        issues.push(issue("예산 초과", "집행액이 예산보다 크지만 비고에 사유가 없습니다.", index + 3));
      }
    });
    rows.forEach((row, index) => {
      if (!isTotal(row)) return;
      for (const header of MONEY_HEADERS) {
        const total = number(row[header]);
        if (total === null) continue;
        const values = detail.map((entry) => number(entry[header]));
        if (Number.isNaN(total) || values.some(Number.isNaN)) continue;
        const sum = values.reduce((acc, value) => acc + (value || 0), 0);
        if (Math.abs(total - sum) > 0.000001) {
          issues.push(issue("합계 불일치", `${header} 합계 ${text(row[header])}와 세부 행 합 ${sum}이 다릅니다.`, index + 3));
        }
      }
    });
    return issues;
  }

  function inspectReplyMatrix(matrix, requirement, options = {}) {
    const issues = [];
    if (!Array.isArray(matrix) || matrix.length < 2) {
      return { 요구표시: "", 머리글: [], 행: [], 확인필요: [issue("형식", "1행 요구 표시와 2행 머리글이 필요합니다.")] };
    }
    const marker = text((matrix[0] || []).find((value) => text(value)));
    if (!marker || !/^요구\s*[:：]/.test(marker)) issues.push(issue("요구 표시", "1행에 '요구: …' 표시가 필요합니다.", 1));
    const headers = (matrix[1] || []).map(text);
    if (!headers.some(Boolean)) issues.push(issue("머리글", "2행에 머리글이 필요합니다.", 2));
    const seenHeaders = new Map();
    const headerKeys = headers.map((header, index) => {
      const label = header || `열${index + 1}`;
      const count = (seenHeaders.get(label) || 0) + 1;
      seenHeaders.set(label, count);
      if (!header) issues.push(issue("머리글", `2행 ${index + 1}번째 열 이름이 비어 있습니다.`, 2));
      else if (count > 1) issues.push(issue("머리글", `2행의 ${label} 열 이름이 중복됐습니다.`, 2));
      return count === 1 ? label : `${label} (${count})`;
    });
    for (const header of COMMON_HEADERS) {
      if (!headers.includes(header)) issues.push(issue("머리글", `2행에 ${header} 열이 없습니다.`, 2));
    }
    const rows = matrix.slice(2)
      .filter((row) => Array.isArray(row) && row.some((value) => text(value)))
      .map((row) => Object.fromEntries(headerKeys.map((header, index) => [header, text(row[index])])));
    issues.push(...validateReplyRows(rows, requirement, options));
    return { 요구표시: marker, 머리글: headers, 행: rows, 확인필요: issues };
  }

  function validDate(value) {
    const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10) === match[0];
  }

  function validateRegistry(rows, organization, options = {}) {
    const issues = [];
    if (!Array.isArray(rows)) return [issue("형식", "접수대장 행을 읽지 못했습니다.")];
    const departments = new Set((organization || []).map((item) => text(typeof item === "string" ? item : item?.과)));
    const seen = new Set();
    const groups = new Map();
    const today = text(options.today) || new Date().toISOString().slice(0, 10);
    rows.forEach((row, index) => {
      const line = index + 2;
      const id = text(row.접수번호);
      const question = text(row.문항번호);
      const key = `${id}::${question}`;
      if (id && question && seen.has(key)) issues.push(issue("중복 접수", `${id} ${question}번 문항이 중복됐습니다.`, line));
      if (id && question) seen.add(key);
      const q = Number(question);
      if (id && Number.isInteger(q) && q > 0) {
        if (!groups.has(id)) groups.set(id, new Set());
        groups.get(id).add(q);
      }
      const dept = text(row.배분과);
      if (dept && !departments.has(dept)) issues.push(issue("조직도 밖 부서", `${dept}는 조직도에 없습니다.`, line));
      const start = year(row.요구기간_시작);
      const end = year(row.요구기간_끝);
      if (start !== null && end !== null && start > end) {
        issues.push(issue("기간 역전", `${start}년부터 ${end}년까지로 적혀 있습니다.`, line));
      }
      const referenceYear = validDate(row.제출기한) ? Number(text(row.제출기한).slice(0, 4))
        : validDate(row.접수일) ? Number(text(row.접수일).slice(0, 4)) : Number(today.slice(0, 4));
      const expected = expectedYears(row.요구내용, referenceYear);
      if (expected.length && start !== null && end !== null && start <= end &&
          (start !== expected[0] || end !== expected.at(-1))) {
        issues.push(issue("요구기간 확인", `최근 ${expected.length}년 요구와 기재된 ${start}~${end}년이 다릅니다.`, line));
      }
      const received = text(row.접수일);
      const due = text(row.제출기한);
      if (due && !validDate(due)) issues.push(issue("기한 형식", `제출기한 ${due}의 날짜 형식을 확인해 주세요.`, line));
      if (validDate(received) && validDate(due) && due < received) {
        issues.push(issue("기한 역전", `제출기한 ${due}이 접수일 ${received}보다 빠릅니다.`, line));
      }
      if (validDate(due) && due < today && text(row.처리상태) !== "제출완료") {
        issues.push(issue("기한 경과", `제출기한 ${due}이 지났습니다.`, line));
      }
      for (const [field, value] of Object.entries(row || {})) {
        if (typeof value === "string" && value !== value.trim()) {
          issues.push(issue("표기 공백", `${field} 앞뒤에 불필요한 공백이 있습니다.`, line));
        }
      }
      if ("예산(천원)" in row || "집행액(천원)" in row) {
        issues.push(...validateReplyRows([row], row.요구내용, { referenceYear: Number(today.slice(0, 4)) })
          .filter((entry) => entry.항목 !== "연도 누락")
          .map((entry) => ({ ...entry, 행: line })));
      }
    });
    for (const [id, numbers] of groups) {
      if (numbers.size < 2) continue;
      for (let value = Math.min(...numbers) + 1; value < Math.max(...numbers); value++) {
        if (!numbers.has(value)) issues.push(issue("문항 누락", `${id}의 ${value}번 문항이 없습니다.`));
      }
    }
    return issues;
  }

  const api = { expectedYears, validateReplyRows, inspectReplyMatrix, validateRegistry };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalObject.AppValidate = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
