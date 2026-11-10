(function attachCommon(globalObject) {
  "use strict";

  const STORAGE_KEY = "a부-국회요구자료-cases-v1";
  const REDUCE = globalObject.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const source = String(text ?? "").replace(/^\uFEFF/, "");

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
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
    if (inQuotes) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
    if (field || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }

    const values = rows.filter((item) => item.some((cell) => cell.trim()));
    if (!values.length) return [];
    const headers = values[0].map((header) => header.trim());
    return values.slice(1).map((item, rowIndex) => {
      if (item.length !== headers.length) {
        throw new Error(`CSV ${rowIndex + 2}행의 열 수가 다릅니다.`);
      }
      return Object.fromEntries(headers.map((header, index) => [header, item[index].trim()]));
    });
  }

  async function loadCsv(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`자료를 읽지 못했습니다: ${response.status}`);
    return parseCsv(await response.text());
  }

  async function readCsvFile(file) {
    return parseCsv(await file.text());
  }

  function loadCases() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCases(cases) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    globalObject.dispatchEvent(new CustomEvent("cases-changed", { detail: cases }));
  }

  function resetCases() {
    saveCases([]);
  }

  function caseId(row) {
    return `${row.파일명}::${row.문항번호}`;
  }

  function makeCase(row, candidates = []) {
    const now = new Date().toISOString();
    return {
      id: caseId(row),
      파일명: row.파일명,
      위원회: row.위원회,
      의원: row.의원,
      제출기한: row.제출기한,
      문항번호: String(row.문항번호),
      요구내용: row.요구내용,
      세부항목: row.세부항목 || "",
      비고: row.비고 || "",
      상태: "접수",
      주관과: candidates[0]?.과 || "",
      협조과: [],
      확정방법: "",
      후보: candidates,
      등록일시: now,
      수정일시: now,
      log: [{ 일시: now, 작업: "접수", 문항: `${row.의원}-${row.문항번호}` }],
    };
  }

  function registerCases(rows, classifier) {
    const cases = loadCases();
    const ids = new Set(cases.map((item) => item.id));
    let added = 0;
    for (const row of rows) {
      const id = caseId(row);
      if (ids.has(id)) continue;
      cases.push(makeCase(row, classifier ? classifier(row.요구내용) : []));
      ids.add(id);
      added += 1;
    }
    saveCases(cases);
    return { cases, added, skipped: rows.length - added };
  }

  function updateCase(id, updater) {
    const cases = loadCases();
    const index = cases.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("저장된 문항을 찾지 못했습니다.");
    const next = updater({ ...cases[index] });
    next.수정일시 = new Date().toISOString();
    cases[index] = next;
    saveCases(cases);
    return next;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[char]);
  }

  function nav(active) {
    const items = [
      ["index", "시작 화면", "index.html", false],
      ["assign", "배분", "assign.html", false],
      ["dept", "현업 회신", "#", true],
      ["collect", "취합", "#", true],
    ];
    return `<nav class="top-nav" aria-label="주요 화면"><a class="brand" href="index.html"><span>A</span> 국회 요구자료</a><div class="nav-links">${items
      .map(
        ([id, label, href, disabled]) =>
          `<a href="${href}" class="nav-link ${active === id ? "active" : ""} ${
            disabled ? "disabled" : ""
          }" ${disabled ? 'aria-disabled="true" title="후속 단계에서 제공"' : ""}>${label}${
            disabled ? '<small>예정</small>' : ""
          }</a>`,
      )
      .join("")}</div></nav>`;
  }

  function toast(message, type = "success") {
    let region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      region.setAttribute("aria-live", "polite");
      document.body.append(region);
    }
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.2 17 19 7"/></svg><span>${escapeHtml(
      message,
    )}</span>`;
    region.append(item);
    requestAnimationFrame(() => item.classList.add("show"));
    setTimeout(() => {
      item.classList.remove("show");
      setTimeout(() => item.remove(), 250);
    }, 3000);
  }

  function setupEffects() {
    const revealItems = document.querySelectorAll("[data-reveal]");
    if (REDUCE || !("IntersectionObserver" in globalObject)) {
      revealItems.forEach((item) => item.classList.add("show"));
    } else {
      const observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("show");
            observer.unobserve(entry.target);
          }),
        { threshold: 0.12 },
      );
      revealItems.forEach((item, index) => {
        item.style.transitionDelay = `${Math.min(index, 5) * 65}ms`;
        observer.observe(item);
      });
    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-ripple]");
      if (!button || REDUCE) return;
      const rect = button.getBoundingClientRect();
      const ripple = document.createElement("i");
      ripple.className = "ripple";
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      button.append(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  }

  function injectBaseStyles() {
    if (document.querySelector("#common-styles")) return;
    const style = document.createElement("style");
    style.id = "common-styles";
    style.textContent = `
      :root{--ink:#172033;--muted:#64748b;--line:#dbe4ee;--paper:#fff;--wash:#f4f7fb;--navy:#15345a;--blue:#246bce;--blue-2:#eaf2ff;--green:#15805d;--green-2:#e8f7f1;--amber:#a65d08;--amber-2:#fff4dc;--red:#b93b4b;--radius:18px;--shadow:0 16px 45px rgba(28,54,89,.09);font-family:"Pretendard","Noto Sans KR","Malgun Gothic",sans-serif;color:var(--ink);background:var(--wash)}
      *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#edf3fb 0,#f7f9fc 250px);color:var(--ink)}button,input,select{font:inherit}a{color:inherit}.top-nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:14px max(24px,calc((100vw - 1440px)/2));background:rgba(255,255,255,.94);border-bottom:1px solid rgba(205,218,232,.9);backdrop-filter:blur(14px)}
      .brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;letter-spacing:-.02em}.brand span{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--navy);color:#fff}.nav-links{display:flex;gap:6px;flex-wrap:wrap}.nav-link{display:flex;align-items:center;gap:5px;padding:9px 13px;border-radius:10px;text-decoration:none;color:#53657b;font-size:14px;font-weight:700}.nav-link:hover{background:#eef4fb}.nav-link.active{background:var(--navy);color:#fff}.nav-link.disabled{opacity:.48;pointer-events:none}.nav-link small{font-size:10px}
      .page-shell{width:min(1440px,calc(100% - 40px));margin:0 auto;padding:32px 0 64px}.eyebrow{margin:0 0 8px;color:var(--blue);font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.page-title{margin:0;font-size:clamp(28px,4vw,44px);line-height:1.15;letter-spacing:-.045em}.page-description{max-width:760px;margin:12px 0 0;color:var(--muted);line-height:1.7}.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
      .button{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 16px;border:1px solid transparent;border-radius:11px;background:var(--navy);color:#fff;font-weight:800;cursor:pointer;transition:transform .25s cubic-bezier(.34,1.56,.64,1),background .2s}.button:hover{transform:translateY(-2px);background:#1d4778}.button:active{transform:translateY(0) scale(.98)}.button.secondary{background:#fff;color:var(--navy);border-color:#cbd8e7}.button.secondary:hover{background:#f5f8fc}.button.danger{background:#fff7f8;color:var(--red);border-color:#edc4ca}.button.danger:hover{background:#ffecef}.button:disabled{opacity:.45;cursor:not-allowed;transform:none}.ripple{position:absolute;width:14px;height:14px;margin:-7px;border-radius:50%;background:rgba(255,255,255,.45);pointer-events:none;animation:ripple .6s ease-out forwards}@keyframes ripple{to{transform:scale(18);opacity:0}}
      .pill{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;background:var(--blue-2);color:var(--blue);font-size:12px;font-weight:800}.pill.green{background:var(--green-2);color:var(--green)}.pill.amber{background:var(--amber-2);color:var(--amber)}
      [data-reveal]{opacity:0;transform:translateY(18px);transition:opacity .55s cubic-bezier(.2,.7,.2,1),transform .55s cubic-bezier(.2,.7,.2,1)}[data-reveal].show{opacity:1;transform:none}.toast-region{position:fixed;right:22px;bottom:22px;z-index:100;display:grid;gap:10px}.toast{display:flex;align-items:center;gap:10px;min-width:260px;max-width:420px;padding:14px 16px;border:1px solid #bde2d4;border-radius:13px;background:#f3fffa;color:#155d47;box-shadow:0 16px 40px rgba(22,74,58,.18);opacity:0;transform:translateY(10px);transition:.25s}.toast.show{opacity:1;transform:none}.toast.error{border-color:#f0c4ca;background:#fff7f8;color:var(--red)}.toast svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.toast.show svg path{stroke-dasharray:28;stroke-dashoffset:28;animation:check .55s .1s ease forwards}@keyframes check{to{stroke-dashoffset:0}}
      @media(max-width:760px){.top-nav{align-items:flex-start;flex-direction:column;padding:12px 18px}.nav-links{width:100%;overflow-x:auto;flex-wrap:nowrap}.nav-link{white-space:nowrap}.page-shell{width:min(100% - 24px,1440px);padding-top:24px}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}[data-reveal]{opacity:1;transform:none}.button:hover{transform:none}}
    `;
    document.head.append(style);
  }

  const api = {
    STORAGE_KEY,
    parseCsv,
    loadCsv,
    readCsvFile,
    loadCases,
    saveCases,
    resetCases,
    registerCases,
    updateCase,
    escapeHtml,
    nav,
    toast,
    setupEffects,
    injectBaseStyles,
  };
  globalObject.AppCommon = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
