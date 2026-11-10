(function attachCommon(globalObject) {
  "use strict";

  const STORAGE_KEY = "a부-국회요구자료-cases-v1";
  const REDUCE = globalObject.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const SERVER_MODE = globalObject.location?.hostname?.endsWith(".vercel.app") ?? false;
  let caseCache = [];
  let storageReady = false;
  let historyCache = null;
  let revealObserver = null;
  let rippleReady = false;

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseCsv(text) {
    if (!globalObject.Papa) throw new Error("Papa Parse를 불러오지 못했습니다.");
    const result = globalObject.Papa.parse(String(text ?? "").replace(/^\uFEFF/, ""), {
      delimiter: ",",
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),
      transform: (value) => String(value ?? "").trim(),
    });
    if (result.errors.length) {
      const error = result.errors[0];
      const row = Number.isInteger(error.row) ? ` ${error.row + 2}행` : "";
      throw new Error(`CSV${row}을 읽지 못했습니다: ${error.message}`);
    }
    return result.data;
  }

  async function loadCsv(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`자료를 읽지 못했습니다: ${response.status}`);
    return parseCsv(await response.text());
  }

  async function readCsvFile(file) {
    return parseCsv(await file.text());
  }

  function readLocalCases() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function notifyCases() {
    globalObject.dispatchEvent(new CustomEvent("cases-changed", { detail: copy(caseCache) }));
  }

  async function initStorage(force = false) {
    if (storageReady && !force) return copy(caseCache);
    if (SERVER_MODE) {
      const response = await fetch("/api/app", { headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload)) {
        throw new Error(payload?.error || `공동 저장 기록을 읽지 못했습니다: ${response.status}`);
      }
      caseCache = payload;
    } else {
      caseCache = readLocalCases();
    }
    storageReady = true;
    notifyCases();
    return copy(caseCache);
  }

  function loadCases() {
    if (!storageReady && !SERVER_MODE) {
      caseCache = readLocalCases();
      storageReady = true;
    }
    return copy(caseCache);
  }

  function saveCases(cases) {
    if (SERVER_MODE) throw new Error("공동 저장은 작업 단위로만 변경할 수 있습니다.");
    caseCache = copy(cases);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    storageReady = true;
    notifyCases();
  }

  function resetCases() {
    if (SERVER_MODE) throw new Error("공동 저장 기록은 화면에서 일괄 초기화할 수 없습니다.");
    saveCases([]);
  }

  function caseId(row) {
    return `${row.파일명}::${row.문항번호}`;
  }

  async function registerCases(rows, classifier, organization) {
    if (!globalObject.AppFlow) throw new Error("공통 상태 규칙을 불러오지 못했습니다.");
    if (!storageReady) await initStorage();
    const ids = new Set(caseCache.map((item) => item.id));
    let added = 0;
    for (const row of rows) {
      const id = caseId(row);
      if (ids.has(id)) continue;
      await applyRequest({
        작업: "접수",
        문항: { ...row, id, 후보: classifier ? classifier(row.요구내용) : [] },
      }, organization);
      ids.add(id);
      added += 1;
    }
    return { cases: loadCases(), added, skipped: rows.length - added };
  }

  async function applyRequest(request, organization) {
    if (!globalObject.AppFlow) throw new Error("공통 상태 규칙을 불러오지 못했습니다.");
    if (!storageReady) await initStorage();
    if (SERVER_MODE) {
      const response = await fetch("/api/app", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || `공동 저장에 실패했습니다: ${response.status}`);
      const index = caseCache.findIndex((item) => item.id === payload.사건?.id);
      if (index < 0) caseCache.push(payload.사건);
      else caseCache[index] = payload.사건;
      notifyCases();
      return copy(payload.사건);
    }
    const result = globalObject.AppFlow.apply(caseCache, request, organization);
    saveCases(result.db);
    return result.item;
  }

  function storageInfo() {
    return SERVER_MODE
      ? { mode: "server", label: "서버 공동 저장", detail: "Vercel의 cases.json을 함께 사용합니다." }
      : { mode: "browser", label: "이 브라우저 저장", detail: "이 기기의 브라우저에만 저장합니다." };
  }

  async function loadPastCases(force = false) {
    if (!historyCache || force) historyCache = await loadCsv("data/접수대장.csv");
    return copy(historyCache);
  }

  function pastHistoryFor(item) {
    const keyword = String(item?.후보?.[0]?.근거키워드 || "").trim();
    if (!keyword || !historyCache) return { keyword, count: 0, mainDepartment: "", recent: [] };
    const normalizedKeyword = keyword.toLocaleLowerCase("ko-KR");
    const matches = historyCache.filter((row) =>
      String(row.요구내용 || "").toLocaleLowerCase("ko-KR").includes(normalizedKeyword),
    );
    const counts = new Map();
    matches.forEach((row) => {
      const department = String(row.배분과 || "").trim();
      if (department) counts.set(department, (counts.get(department) || 0) + 1);
    });
    const mainDepartment = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko"))[0]?.[0] || "";
    const recent = [...matches]
      .sort((left, right) =>
        String(right.접수일 || "").localeCompare(String(left.접수일 || "")) ||
        String(right.접수번호 || "").localeCompare(String(left.접수번호 || "")),
      )
      .slice(0, 5);
    return { keyword, count: matches.length, mainDepartment, recent };
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
      ["dept", "현업 회신", "dept.html", false],
      ["collect", "취합", "#", true],
    ];
    const info = storageInfo();
    return `<nav class="top-nav" aria-label="주요 화면"><a class="brand" href="index.html"><span>A</span> 국회 요구자료</a><div class="nav-side"><span class="storage-mode ${info.mode}" title="${escapeHtml(info.detail)}"><i></i>${escapeHtml(info.label)}</span><div class="nav-links">${items
      .map(
        ([id, label, href, disabled]) =>
          `<a href="${href}" class="nav-link ${active === id ? "active" : ""} ${
            disabled ? "disabled" : ""
          }" ${disabled ? 'aria-disabled="true" title="후속 단계에서 제공"' : ""}>${label}${
            disabled ? '<small>예정</small>' : ""
          }</a>`,
      )
      .join("")}</div></div></nav>`;
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

  function animateNumber(element, target, duration = 700) {
    const end = Number(target) || 0;
    if (REDUCE) {
      element.textContent = end.toLocaleString("ko-KR");
      return;
    }
    const start = Number(String(element.textContent).replaceAll(",", "")) || 0;
    const startedAt = performance.now();
    function frame(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      element.textContent = Math.round(start + (end - start) * eased).toLocaleString("ko-KR");
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function setupEffects() {
    const revealItems = document.querySelectorAll("[data-reveal]:not([data-effect-ready])");
    revealItems.forEach((item) => item.setAttribute("data-effect-ready", "true"));
    if (REDUCE || !("IntersectionObserver" in globalObject)) {
      revealItems.forEach((item) => item.classList.add("show"));
    } else {
      revealObserver ||= new IntersectionObserver(
        (entries) => entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("show");
          revealObserver.unobserve(entry.target);
        }),
        { threshold: 0.12 },
      );
      revealItems.forEach((item, index) => {
        item.style.transitionDelay = `${Math.min(index, 5) * 65}ms`;
        revealObserver.observe(item);
      });
    }

    if (rippleReady) return;
    rippleReady = true;
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
      .brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;letter-spacing:-.02em}.brand span{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--navy);color:#fff}.nav-side{display:flex;align-items:center;justify-content:flex-end;gap:12px}.storage-mode{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #cad8e7;border-radius:999px;background:#f7faff;color:#52657b;font-size:11px;font-weight:800;white-space:nowrap}.storage-mode i{width:8px;height:8px;border-radius:50%;background:#d09432;box-shadow:0 0 0 4px #fff1d2}.storage-mode.server{color:#14684d;border-color:#bde0d3;background:#effbf6}.storage-mode.server i{background:#22a67b;box-shadow:0 0 0 4px #d9f3e9}.nav-links{display:flex;gap:6px;flex-wrap:wrap}.nav-link{display:flex;align-items:center;gap:5px;padding:9px 13px;border-radius:10px;text-decoration:none;color:#53657b;font-size:14px;font-weight:700}.nav-link:hover{background:#eef4fb}.nav-link.active{background:var(--navy);color:#fff}.nav-link.disabled{opacity:.48;pointer-events:none}.nav-link small{font-size:10px}
      .page-shell{width:min(1440px,calc(100% - 40px));margin:0 auto;padding:32px 0 64px}.eyebrow{margin:0 0 8px;color:var(--blue);font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.page-title{margin:0;font-size:clamp(28px,4vw,44px);line-height:1.15;letter-spacing:-.045em}.page-description{max-width:760px;margin:12px 0 0;color:var(--muted);line-height:1.7}.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
      .button{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 16px;border:1px solid transparent;border-radius:11px;background:var(--navy);color:#fff;font-weight:800;cursor:pointer;transition:transform .25s cubic-bezier(.34,1.56,.64,1),background .2s}.button:hover{transform:translateY(-2px);background:#1d4778}.button:active{transform:translateY(0) scale(.98)}.button.secondary{background:#fff;color:var(--navy);border-color:#cbd8e7}.button.secondary:hover{background:#f5f8fc}.button.danger{background:#fff7f8;color:var(--red);border-color:#edc4ca}.button.danger:hover{background:#ffecef}.button:disabled{opacity:.45;cursor:not-allowed;transform:none}.ripple{position:absolute;width:14px;height:14px;margin:-7px;border-radius:50%;background:rgba(255,255,255,.45);pointer-events:none;animation:ripple .6s ease-out forwards}@keyframes ripple{to{transform:scale(18);opacity:0}}
      .pill{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;background:var(--blue-2);color:var(--blue);font-size:12px;font-weight:800}.pill.green{background:var(--green-2);color:var(--green)}.pill.amber{background:var(--amber-2);color:var(--amber)}
      [data-reveal]{opacity:0;transform:translateY(18px);transition:opacity .55s cubic-bezier(.2,.7,.2,1),transform .55s cubic-bezier(.2,.7,.2,1)}[data-reveal].show{opacity:1;transform:none}.toast-region{position:fixed;right:22px;bottom:22px;z-index:100;display:grid;gap:10px}.toast{display:flex;align-items:center;gap:10px;min-width:260px;max-width:420px;padding:14px 16px;border:1px solid #bde2d4;border-radius:13px;background:#f3fffa;color:#155d47;box-shadow:0 16px 40px rgba(22,74,58,.18);opacity:0;transform:translateY(10px);transition:.25s}.toast.show{opacity:1;transform:none}.toast.error{border-color:#f0c4ca;background:#fff7f8;color:var(--red)}.toast svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.toast.show svg path{stroke-dasharray:28;stroke-dashoffset:28;animation:check .55s .1s ease forwards}@keyframes check{to{stroke-dashoffset:0}}
      @media(max-width:900px){.top-nav{align-items:flex-start;flex-direction:column;padding:12px 18px}.nav-side{width:100%;align-items:flex-start;flex-direction:column}.nav-links{width:100%;overflow-x:auto;flex-wrap:nowrap}.nav-link{white-space:nowrap}.page-shell{width:min(100% - 24px,1440px);padding-top:24px}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}[data-reveal]{opacity:1;transform:none}.button:hover{transform:none}}
    `;
    document.head.append(style);
  }

  const api = {
    STORAGE_KEY,
    parseCsv,
    loadCsv,
    readCsvFile,
    initStorage,
    loadCases,
    saveCases,
    resetCases,
    registerCases,
    applyRequest,
    storageInfo,
    loadPastCases,
    pastHistoryFor,
    escapeHtml,
    nav,
    toast,
    animateNumber,
    setupEffects,
    injectBaseStyles,
  };
  globalObject.AppCommon = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
