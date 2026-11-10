(function attachRequestSplitter(globalObject) {
  "use strict";

  const columns = [
    "파일명",
    "위원회",
    "의원",
    "제출기한",
    "문항번호",
    "요구내용",
    "세부항목",
    "비고",
  ];

  const titlePattern = /^(?<committee>.+?위원회)\s+(?<legislator>.+?)\s+의원실\s+자료요구서\s*$/;
  const duePattern = /제출기한\s*:\s*(?<year>\d{4})\.\s*(?<month>\d{1,2})\.\s*(?<day>\d{1,2})\./;
  const questionPattern = /^(?<number>\d+)\.\s*(?<text>.*)$/;
  const detailPattern = /^(?<label>[가-힣])\.\s*(?<text>.*)$/;
  const expectedCountPattern = /_(?<count>\d+)문항\.pdf$/i;

  function appendText(existing, addition, newItem = false) {
    const clean = String(addition ?? "").trim();
    if (!clean) return existing;
    if (!existing) return clean;
    return `${existing}${newItem ? " / " : " "}${clean}`;
  }

  function splitRequestText(text, fileName = "") {
    const lines = String(text ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new Error(`${fileName || "PDF"}: 글자를 읽지 못했습니다.`);
    }

    const title = lines[0].match(titlePattern);
    if (!title) {
      throw new Error(`${fileName || "PDF"}: 첫 줄에서 위원회·의원을 찾지 못했습니다.`);
    }

    const dueLine = lines.find((line) => line.startsWith("수신:"));
    const due = dueLine?.match(duePattern);
    if (!due) {
      throw new Error(`${fileName || "PDF"}: 제출기한을 찾지 못했습니다.`);
    }

    const common = {
      파일명: fileName,
      위원회: title.groups.committee,
      의원: title.groups.legislator,
      제출기한: `${due.groups.year}-${String(due.groups.month).padStart(2, "0")}-${String(
        due.groups.day,
      ).padStart(2, "0")}`,
    };
    const rows = [];
    let current = null;
    let currentField = "요구내용";

    for (const line of lines.slice(1)) {
      if (line.startsWith("수신:") || line.startsWith("담당 보좌관:") || line === "끝.") {
        continue;
      }

      const question = line.match(questionPattern);
      if (question) {
        if (current) rows.push(current);
        current = {
          ...common,
          문항번호: question.groups.number,
          요구내용: question.groups.text.trim(),
          세부항목: "",
          비고: "",
        };
        currentField = "요구내용";
        continue;
      }

      if (!current) continue;

      const detail = line.match(detailPattern);
      if (detail) {
        current.세부항목 = appendText(
          current.세부항목,
          `${detail.groups.label}. ${detail.groups.text.trim()}`.trim(),
          true,
        );
        currentField = "세부항목";
      } else if (line.startsWith("※")) {
        current.비고 = appendText(current.비고, line.replace(/^※\s*/, ""), true);
        currentField = "비고";
      } else {
        current[currentField] = appendText(current[currentField], line);
      }
    }

    if (current) rows.push(current);
    return rows;
  }

  function verifyRows(rows, fileName) {
    const expectedMatch = String(fileName ?? "").match(expectedCountPattern);
    const expected = expectedMatch ? Number(expectedMatch.groups.count) : null;
    const numbers = rows.map((row) => Number(row.문항번호));
    const consecutive = numbers.every((number, index) => number === index + 1);
    const lastNumber = numbers.at(-1) ?? null;
    return {
      파일명: fileName,
      파일명의문항수: expected,
      뽑은문항수: rows.length,
      마지막번호: lastNumber,
      번호연속: consecutive,
      일치:
        expected === null
          ? consecutive
          : expected === rows.length && expected === lastNumber && consecutive,
    };
  }

  const api = { columns, splitRequestText, verifyRows };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalObject.RequestSplitter = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
