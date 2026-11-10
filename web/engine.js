(function attachEngine(globalObject) {
  "use strict";

  const isNode =
    typeof module !== "undefined" &&
    module.exports &&
    typeof process !== "undefined" &&
    process.versions?.node;
  const browserScriptUrl =
    !isNode && typeof document !== "undefined" && document.currentScript
      ? document.currentScript.src
      : null;

  let rules = null;
  let departments = null;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }

    if (inQuotes) {
      throw new Error("CSV의 따옴표가 닫히지 않았습니다.");
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }

    const nonEmptyRows = rows.filter((values) =>
      values.some((value) => value.trim() !== ""),
    );
    if (nonEmptyRows.length === 0) {
      return [];
    }

    const headers = nonEmptyRows[0].map((header, index) =>
      (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
    );

    return nonEmptyRows.slice(1).map((values, rowIndex) => {
      if (values.length !== headers.length) {
        throw new Error(
          `CSV ${rowIndex + 2}행의 열 수가 다릅니다: ${values.length}/${headers.length}`,
        );
      }
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index].trim()]),
      );
    });
  }

  function requireColumns(rows, columns, label) {
    if (rows.length === 0) {
      throw new Error(`${label}에 데이터가 없습니다.`);
    }
    const available = new Set(Object.keys(rows[0]));
    const missing = columns.filter((column) => !available.has(column));
    if (missing.length > 0) {
      throw new Error(`${label}에 필수 열이 없습니다: ${missing.join(", ")}`);
    }
  }

  function normalize(value) {
    return String(value ?? "")
      .replace(/\s+/g, "")
      .toLocaleLowerCase("ko-KR");
  }

  function splitValues(value) {
    return String(value ?? "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function keywordLength(keyword) {
    return Array.from(keyword).length;
  }

  async function readText(location) {
    if (isNode) {
      const fs = require("node:fs/promises");
      return fs.readFile(location, "utf8");
    }

    const baseUrl = browserScriptUrl
      ? new URL(".", browserScriptUrl)
      : new URL(".", globalObject.location.href);
    const response = await fetch(new URL(location, baseUrl));
    if (!response.ok) {
      throw new Error(`CSV를 불러오지 못했습니다: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  function configure(ruleRows, organizationRows) {
    requireColumns(ruleRows, ["과", "키워드", "제외어", "우선순위"], "배분기준표");
    requireColumns(organizationRows, ["과"], "조직도");

    departments = new Set(
      organizationRows.map((row) => row.과.trim()).filter(Boolean),
    );
    rules = ruleRows.map((row, index) => {
      const priority = Number(row.우선순위);
      if (!Number.isFinite(priority)) {
        throw new Error(`배분기준표 ${index + 2}행의 우선순위가 숫자가 아닙니다.`);
      }
      return {
        과: row.과.trim(),
        키워드: row.키워드.trim(),
        제외어: splitValues(row.제외어),
        우선순위: priority,
      };
    });
  }

  function defaultNodePaths() {
    const path = require("node:path");
    return {
      rulesPath: path.resolve(
        __dirname,
        "..",
        "data",
        "배분기준표_소관키워드_304건.csv",
      ),
      organizationPath: path.resolve(
        __dirname,
        "..",
        "data",
        "A부_조직도_26개과.csv",
      ),
    };
  }

  async function init(options = {}) {
    let rulesPath = options.rulesPath;
    let organizationPath = options.organizationPath;

    if (isNode) {
      const defaults = defaultNodePaths();
      rulesPath ??= defaults.rulesPath;
      organizationPath ??= defaults.organizationPath;
    } else {
      rulesPath ??= "data/rules_보강.csv";
      organizationPath ??= "data/A부_조직도_26개과.csv";
    }

    const [rulesText, organizationText] = await Promise.all([
      readText(rulesPath),
      readText(organizationPath),
    ]);
    const ruleRows = parseCsv(rulesText);
    const organizationRows = parseCsv(organizationText);
    configure(ruleRows, organizationRows);

    return api;
  }

  function ensureInitialized() {
    if (rules !== null && departments !== null) {
      return;
    }
    if (!isNode) {
      throw new Error("브라우저에서는 classify를 호출하기 전에 init을 실행해야 합니다.");
    }

    const fs = require("node:fs");
    const paths = defaultNodePaths();
    configure(
      parseCsv(fs.readFileSync(paths.rulesPath, "utf8")),
      parseCsv(fs.readFileSync(paths.organizationPath, "utf8")),
    );
  }

  function classify(요구내용) {
    ensureInitialized();
    if (typeof 요구내용 !== "string") {
      throw new TypeError("요구내용은 문자열이어야 합니다.");
    }
    if (!요구내용.trim()) {
      return [];
    }

    const normalizedRequest = normalize(요구내용);
    const candidates = new Map();

    for (const rule of rules) {
      if (!departments.has(rule.과) || !rule.키워드) {
        continue;
      }
      if (!normalizedRequest.includes(normalize(rule.키워드))) {
        continue;
      }
      if (rule.제외어.some((word) => normalizedRequest.includes(normalize(word)))) {
        continue;
      }

      const contribution = rule.우선순위 + keywordLength(rule.키워드) / 10;
      const score = Math.round((contribution + Number.EPSILON) * 10) / 10;
      const current = candidates.get(rule.과);
      const candidate = {
        과: rule.과,
        점수: score,
        근거키워드: rule.키워드,
      };
      if (
        current &&
        (current.점수 > score ||
          (current.점수 === score &&
            current.근거키워드.localeCompare(rule.키워드, "ko") <= 0))
      ) {
        continue;
      }
      candidates.set(rule.과, candidate);
    }

    return [...candidates.values()]
      .sort(
        (left, right) =>
          right.점수 - left.점수 ||
          left.과.localeCompare(right.과, "ko"),
      )
      .slice(0, 3);
  }

  const api = { init, classify, parseCsv };

  if (isNode) {
    module.exports = api;
  } else {
    globalObject.AssignmentEngine = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
