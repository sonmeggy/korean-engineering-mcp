#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const KCSC_KEY = process.env.KCSC_API_KEY || "";
const LAW_KEY  = process.env.LAW_API_KEY  || "";
const KCSC_BASE = "https://kcsc.re.kr/OpenApi";
const LAW_BASE  = "https://www.law.go.kr/DRF";

// ── 로컬 설계기준 해설편 ──────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = process.env.REFERENCE_DIR || __dirname;

const REFERENCE_FILES = {
  상수도: join(REFERENCE_DIR, "상수도설계기준_해설편(2023).md"),
  하수도: join(REFERENCE_DIR, "하수도설계기준_해설편(2020).md"),
};

// 파일을 마크다운 헤더(#) 단위 섹션으로 분할
function parseSections(content) {
  const lines = content.split("\n");
  const sections = [];
  let title = "(서두)";
  let body = [];

  for (const line of lines) {
    if (/^#{1,4}\s/.test(line)) {
      if (body.length) sections.push({ title, content: body.join("\n").trim() });
      title = line.replace(/^#+\s*/, "").trim();
      body = [line];
    } else {
      body.push(line);
    }
  }
  if (body.length) sections.push({ title, content: body.join("\n").trim() });
  return sections;
}

// 시작 시 파일 로딩 (없으면 빈 배열)
const referenceDocs = {};
for (const [name, filePath] of Object.entries(REFERENCE_FILES)) {
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf-8");
    referenceDocs[name] = parseSections(raw);
  }
}

// ── KCSC API ──────────────────────────────────────────────────
async function fetchKCSC(path) {
  requireApiKey("KCSC_API_KEY", KCSC_KEY);
  const sep = path.includes("?") ? "&" : "?";
  const url = `${KCSC_BASE}${path}${sep}key=${KCSC_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KCSC API 오류: ${res.status}`);
  return res.json();
}

// ── 법제처 API ────────────────────────────────────────────────
async function fetchLaw(endpoint, params = {}) {
  requireApiKey("LAW_API_KEY", LAW_KEY);
  const url = new URL(`${LAW_BASE}/${endpoint}`);
  url.searchParams.set("OC", LAW_KEY);
  url.searchParams.set("type", "JSON");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`법제처 API 오류: ${res.status}`);
  return res.json();
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// 법제처 JSON 응답에서 배열 추출 (키 이름이 버전마다 다를 수 있음)
function extractList(obj, ...keys) {
  for (const key of keys) {
    if (!obj) continue;
    const val = obj[key];
    if (Array.isArray(val)) return val;
    if (val && typeof val === "object") return [val];
  }
  return [];
}

function requireApiKey(name, value) {
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다. .env 또는 MCP 설정 env에 값을 넣어주세요.`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordsFrom(text) {
  return String(text || "")
    .replace(/["'“”‘’()[\]{}]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function compactText(text, max = 350) {
  const normalized = stripHtml(text).replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function scoreText(text, keywords) {
  const haystack = String(text || "");
  return keywords.reduce((score, kw) => score + (haystack.includes(kw) ? 1 : 0), 0);
}

function standardAuthorityRank(codeType) {
  const rank = { KDS: 1, KCS: 2, KWCS: 3, LHCS: 4, SMCS: 5, EXCS: 6, NHCS: 7, KRCCS: 8, KRACS: 9 };
  return rank[codeType] || 99;
}

function sourceUrlForStandard(item) {
  return item?.no ? `https://www.kcsc.re.kr/StandardCode/Viewer/${item.no}` : "https://www.kcsc.re.kr";
}

async function findStandardEvidence(query, { includeLocalStandards = false, maxStandards = 3, maxSectionsPerStandard = 2 } = {}) {
  requireApiKey("KCSC_API_KEY", KCSC_KEY);
  const codeList = await fetchKCSC("/CodeList");
  const list = Array.isArray(codeList) ? codeList : [];
  const keywords = keywordsFrom(query);
  const allowedTypes = includeLocalStandards ? null : new Set(["KDS", "KCS"]);
  const candidates = list
    .map((item) => ({
      item,
      score: scoreText(`${item.code || ""} ${item.fullCode || ""} ${item.name || ""}`, keywords),
    }))
    .filter(({ item, score }) => score > 0 && (!allowedTypes || allowedTypes.has(item.codeType)))
    .sort((a, b) => b.score - a.score || standardAuthorityRank(a.item.codeType) - standardAuthorityRank(b.item.codeType))
    .slice(0, maxStandards);

  const evidence = [];
  for (const { item, score } of candidates) {
    const entry = {
      source_type: item.codeType,
      title: item.name || "",
      code: item.code || "",
      full_code: item.fullCode || "",
      revision: item.version || "",
      updated_at: item.updateDate?.split("T")[0] || "",
      url: sourceUrlForStandard(item),
      relevance_score: score,
      sections: [],
    };
    if (["KDS", "KCS"].includes(item.codeType) && item.code) {
      try {
        const detail = await fetchKCSC(`/CodeViewer/${item.codeType}/${item.code}`);
        const detailItem = Array.isArray(detail) ? detail[0] : detail;
        const sections = detailItem?.list || [];
        entry.sections = sections
          .map((sec) => ({
            title: sec.title || "",
            level: sec.level || 1,
            quote: compactText(sec.contents || "", 420),
            score: scoreText(`${sec.title || ""} ${stripHtml(sec.contents || "")}`, keywords),
          }))
          .filter((sec) => sec.score > 0 && sec.quote)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxSectionsPerStandard)
          .map(({ score, ...sec }) => sec);
      } catch (error) {
        entry.detail_error = error.message;
      }
    }
    evidence.push(entry);
  }
  return evidence;
}

function searchManualEvidence(query, { document = "전체", maxResults = 3 } = {}) {
  const keywords = keywordsFrom(query);
  const targets = document === "전체" ? Object.keys(referenceDocs) : [document].filter((d) => referenceDocs[d]);
  const results = [];
  for (const docName of targets) {
    for (const sec of referenceDocs[docName] || []) {
      const score = scoreText(`${sec.title}\n${sec.content}`, keywords);
      if (score > 0) {
        results.push({
          source_type: "design_manual_commentary",
          document: `${docName}설계기준 해설편`,
          section: sec.title,
          quote: compactText(sec.content, 420),
          relevance_score: score,
        });
      }
    }
  }
  return results.sort((a, b) => b.relevance_score - a.relevance_score).slice(0, maxResults);
}

function lawEvidenceFromSearch(data) {
  const search = data?.LawSearch;
  return extractList(search, "law").map((law) => ({
    source_type: "law_search_result",
    title: law["법령명한글"] || "",
    law_type: law["법령구분명"] || "",
    effective_date: law["시행일자"] || "",
    ministry: law["소관부처명"] || "",
    note: "조문 단위 판단 전 법령 본문/조문 상세 확인 필요",
  }));
}

function adminEvidenceFromSearch(data) {
  const search = data?.AdminRulSearch || data?.LawSearch;
  return extractList(search, "admrul").map((item) => ({
    source_type: "admin_rule_search_result",
    title: item["행정규칙명"] || "",
    rule_type: item["행정규칙구분"] || "",
    issued_date: item["발령일자"] || "",
    agency: item["발령기관명"] || item["발령기관"] || "",
    note: "고시·예규·훈령·지침 본문 확인 후 보조/직접 근거 여부 판단 필요",
  }));
}

function interpretationEvidenceFromSearch(data) {
  const search = data?.InterpSearch || data?.LawSearch;
  return extractList(search, "interp", "expc").map((item) => ({
    source_type: "interpretation_search_result",
    title: item["해석례명"] || item["사건명"] || item.title || "",
    reply_date: item["회신일자"] || "",
    agency: item["회신기관명"] || item["회신기관"] || "",
    summary: compactText(item["질의요지"] || item["요지"] || "", 260),
    note: "사안 유사성 검토 후 적용 가능",
  }));
}

const server = new McpServer({ name: "korean-engineering-mcp", version: "1.0.0" });


// ══════════════════════════════════════════════════════════════
// 건설기준 도구 (KCSC)
// ══════════════════════════════════════════════════════════════

server.tool(
  "search_standards",
  "한국 건설기준(KDS 설계기준, KCS 표준시방서) 키워드 검색",
  {
    query: z.string().describe("검색 키워드 (예: 콘크리트, 하수도, 상수도, 강구조, 내진)"),
    type:  z.enum(["ALL", "KDS", "KCS"]).default("ALL").describe("기준 종류 필터: ALL(전체), KDS(설계기준), KCS(표준시방서)"),
    limit: z.number().default(20).describe("최대 결과 수 (기본 20)"),
  },
  async ({ query, type, limit }) => {
    const data = await fetchKCSC("/CodeList");
    const list = Array.isArray(data) ? data : [];
    const results = list
      .filter((item) => {
        const matchType = type === "ALL" || item.codeType === type;
        const matchKeyword = item.name?.includes(query) || item.code?.includes(query) || item.fullCode?.includes(query);
        return matchType && matchKeyword;
      })
      .slice(0, limit);

    if (!results.length) return { content: [{ type: "text", text: `'${query}' 검색 결과 없음` }] };

    const lines = [`검색결과: '${query}' (${results.length}건)\n`];
    for (const item of results) {
      lines.push(`[${item.codeType}] ${item.code} - ${item.name}`);
      lines.push(`  버전: ${item.version || "-"} | 수정일: ${item.updateDate?.split("T")[0] || "-"}`);
      lines.push(`  원문: https://www.kcsc.re.kr/StandardCode/Viewer/${item.no}`);
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "get_standard_detail",
  "특정 건설기준 코드의 상세 내용(목차 및 본문) 조회",
  {
    type:    z.enum(["KDS", "KCS"]).describe("기준 종류: KDS(설계기준) 또는 KCS(표준시방서)"),
    code:    z.string().describe("기준 코드 번호 (예: 142001, 570010)"),
    section: z.string().optional().describe("특정 절 키워드로 필터링 (선택사항, 예: 재료, 설계, 시공)"),
  },
  async ({ type, code, section }) => {
    const data = await fetchKCSC(`/CodeViewer/${type}/${code}`);
    const item = Array.isArray(data) ? data[0] : data;
    if (!item?.name) return { content: [{ type: "text", text: `${type} ${code} 조회 실패` }] };

    const lines = [
      `=== ${item.name} (${item.codeType} ${item.code}) ===`,
      `버전: ${item.version || "-"} | 수정일: ${item.updateDate?.split("T")[0] || "-"}`,
      `원문: https://www.kcsc.re.kr/StandardCode/Viewer/${item.no}`,
      "",
    ];

    const sections = item.list || [];
    const filtered = section
      ? sections.filter((s) => s.title?.includes(section) || stripHtml(s.contents)?.includes(section))
      : sections;

    for (const sec of filtered) {
      const indent = "  ".repeat(Math.max(0, (sec.level || 1) - 1));
      lines.push(`${indent}[${sec.title}]`);
      const body = stripHtml(sec.contents);
      if (body && body !== sec.title) {
        lines.push(`${indent}  ${body.length > 500 ? body.slice(0, 500) + "..." : body}`);
      }
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "list_standard_categories",
  "건설기준 전체 카테고리 목록 조회 (분야별 기준 현황 파악용)",
  {
    type: z.enum(["ALL", "KDS", "KCS"]).default("ALL").describe("기준 종류 필터"),
  },
  async ({ type }) => {
    const data = await fetchKCSC("/CodeList");
    const list = Array.isArray(data) ? data : [];
    const filtered = type === "ALL" ? list : list.filter((i) => i.codeType === type);

    const groups = {};
    for (const item of filtered) {
      const prefix = (item.code || "").slice(0, 2);
      if (!groups[prefix]) groups[prefix] = { count: 0, type: item.codeType, samples: [] };
      groups[prefix].count++;
      if (groups[prefix].samples.length < 2) groups[prefix].samples.push(item.name);
    }

    const lines = [`건설기준 카테고리 현황 (총 ${filtered.length}건)\n`];
    for (const [prefix, info] of Object.entries(groups).sort()) {
      lines.push(`[${info.type}] ${prefix}xx계열 (${info.count}건): ${info.samples.join(", ")}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);


// ══════════════════════════════════════════════════════════════
// 법령 도구 (법제처)
// ══════════════════════════════════════════════════════════════

server.tool(
  "search_laws",
  "법제처 법령 검색 (법률·시행령·시행규칙 등)",
  {
    query:   z.string().describe("검색 키워드 (예: 상수도법, 하수도법, 건설기술진흥법)"),
    display: z.number().default(10).describe("결과 수 (기본 10)"),
  },
  async ({ query, display }) => {
    const data = await fetchLaw("lawSearch.do", { target: "law", query, display });
    const search = data?.LawSearch;
    const laws = extractList(search, "law");

    if (!laws.length) return { content: [{ type: "text", text: `'${query}' 법령 검색 결과 없음` }] };

    const total = search?.["@total_count"] || search?.totalCnt || laws.length;
    const lines = [`법령 검색결과: '${query}' (총 ${total}건)\n`];
    for (const law of laws) {
      const name = law["법령명한글"] || "";
      lines.push(`■ ${name}`);
      lines.push(`  종류: ${law["법령구분명"] || ""} | 시행: ${law["시행일자"] || ""} | 소관: ${law["소관부처명"] || ""}`);
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "search_interpretations",
  "법제처 법령 해석례 검색 (법령 적용 해석 사례)",
  {
    query:   z.string().describe("검색 키워드 (예: 기술진단, 하수도 대행, 상수도 허가)"),
    display: z.number().default(10).describe("결과 수 (기본 10)"),
  },
  async ({ query, display }) => {
    const data = await fetchLaw("lawSearch.do", { target: "expc", query, display });
    const search = data?.InterpSearch || data?.LawSearch;
    const items = extractList(search, "interp", "expc");

    if (!items.length) return { content: [{ type: "text", text: `'${query}' 해석례 검색 결과 없음` }] };

    const lines = [`해석례 검색결과: '${query}' (${items.length}건)\n`];
    for (const item of items) {
      const name = item["해석례명"] || item["사건명"] || item["title"] || "";
      lines.push(`■ ${name}`);
      lines.push(`  회신일: ${item["회신일자"] || ""} | 회신기관: ${item["회신기관명"] || item["회신기관"] || ""}`);
      const summary = item["질의요지"] || item["요지"] || "";
      if (summary) lines.push(`  요지: ${summary.slice(0, 200)}`);
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "search_admin_rules",
  "법제처 행정규칙 검색 (고시·예규·훈령·지침 등)",
  {
    query:   z.string().describe("검색 키워드 (예: 상수도 설계기준 고시, 하수도 기술진단 지침)"),
    display: z.number().default(10).describe("결과 수 (기본 10)"),
  },
  async ({ query, display }) => {
    const data = await fetchLaw("lawSearch.do", { target: "admrul", query, display });
    const search = data?.AdminRulSearch || data?.LawSearch;
    const items = extractList(search, "admrul");

    if (!items.length) return { content: [{ type: "text", text: `'${query}' 행정규칙 검색 결과 없음` }] };

    const lines = [`행정규칙 검색결과: '${query}' (${items.length}건)\n`];
    for (const item of items) {
      lines.push(`■ ${item["행정규칙명"] || ""}`);
      lines.push(`  종류: ${item["행정규칙구분"] || ""} | 발령: ${item["발령일자"] || ""} | 기관: ${item["발령기관명"] || item["발령기관"] || ""}`);
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);


// ══════════════════════════════════════════════════════════════
// 통합 분석 도구
// ══════════════════════════════════════════════════════════════

server.tool(
  "comprehensive_research",
  "법령과 건설기준을 동시에 검색하여 엔지니어링 질문에 법적·기술적 근거를 종합 제공",
  {
    query:          z.string().describe("엔지니어링 질문 키워드 (예: 배수지 진출입로 경사, 하수도 기술진단 자격)"),
    standard_query: z.string().optional().describe("건설기준 검색에 별도 키워드가 필요한 경우 (기본: query와 동일)"),
    law_query:      z.string().optional().describe("법령 검색에 별도 키워드가 필요한 경우 (기본: query와 동일)"),
  },
  async ({ query, standard_query, law_query }) => {
    const sq = standard_query || query;
    const lq = law_query || query;

    // 4개 API 병렬 호출
    const [kcscRes, lawRes, interpRes, adminRes] = await Promise.allSettled([
      fetchKCSC("/CodeList"),
      fetchLaw("lawSearch.do", { target: "law",    query: lq, display: 5 }),
      fetchLaw("lawSearch.do", { target: "expc",   query: lq, display: 5 }),
      fetchLaw("lawSearch.do", { target: "admrul", query: lq, display: 5 }),
    ]);

    const lines = [
      "═".repeat(60),
      `  종합 엔지니어링 조사: "${query}"`,
      "═".repeat(60),
      "",
    ];

    // ── 1. 건설기준 (KDS/KCS) ──
    lines.push("▶ [건설기준 (KDS/KCS)]");
    if (kcscRes.status === "fulfilled") {
      const list = Array.isArray(kcscRes.value) ? kcscRes.value : [];
      const keywords = sq.replace(/\s+/g, " ").split(" ").filter(Boolean);
      const matched = list
        .filter((item) => keywords.some((kw) => item.name?.includes(kw) || item.code?.includes(kw)))
        .slice(0, 6);

      if (matched.length) {
        for (const item of matched) {
          lines.push(`  [${item.codeType}] ${item.code} ${item.name}`);
          lines.push(`    → get_standard_detail 로 상세 조회 가능`);
        }
      } else {
        lines.push(`  "${sq}" 관련 건설기준 없음 (검색어 변경 후 search_standards 재시도 권장)`);
      }
    } else {
      lines.push(`  KCSC 조회 실패: ${kcscRes.reason?.message || kcscRes.reason}`);
    }
    lines.push("");

    // ── 2. 관련 법령 ──
    lines.push("▶ [관련 법령]");
    if (lawRes.status === "fulfilled") {
      const laws = extractList(lawRes.value?.LawSearch, "law");
      if (laws.length) {
        for (const law of laws) {
          lines.push(`  ■ ${law["법령명한글"]} (${law["법령구분명"]}, 시행 ${law["시행일자"]})`);
        }
      } else {
        lines.push(`  "${lq}" 관련 법령 없음`);
      }
    } else {
      lines.push(`  법제처 조회 실패: ${lawRes.reason?.message || lawRes.reason}`);
    }
    lines.push("");

    // ── 3. 법령 해석례 ──
    lines.push("▶ [법령 해석례]");
    if (interpRes.status === "fulfilled") {
      const search = interpRes.value?.InterpSearch || interpRes.value?.LawSearch;
      const items = extractList(search, "interp", "expc");
      if (items.length) {
        for (const item of items) {
          const name = item["해석례명"] || item["사건명"] || "";
          const date = item["회신일자"] || "";
          lines.push(`  ■ ${name} (${date})`);
          const summary = item["질의요지"] || "";
          if (summary) lines.push(`    요지: ${summary.slice(0, 120)}...`);
        }
      } else {
        lines.push(`  "${lq}" 관련 해석례 없음`);
      }
    } else {
      lines.push(`  해석례 조회 실패: ${interpRes.reason?.message || interpRes.reason}`);
    }
    lines.push("");

    // ── 4. 행정규칙 (고시·예규·지침) ──
    lines.push("▶ [행정규칙 (고시·예규·지침)]");
    if (adminRes.status === "fulfilled") {
      const search = adminRes.value?.AdminRulSearch || adminRes.value?.LawSearch;
      const items = extractList(search, "admrul");
      if (items.length) {
        for (const item of items) {
          lines.push(`  ■ ${item["행정규칙명"] || ""} (${item["행정규칙구분"] || ""}, ${item["발령기관명"] || item["발령기관"] || ""})`);
        }
      } else {
        lines.push(`  "${lq}" 관련 행정규칙 없음`);
      }
    } else {
      lines.push(`  행정규칙 조회 실패: ${adminRes.reason?.message || adminRes.reason}`);
    }
    lines.push("");

    lines.push("─".repeat(60));
    lines.push("※ 세부 내용 조회: get_standard_detail / search_laws / search_interpretations / search_admin_rules");

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);


server.tool(
  "grounded_engineering_research",
  "한국 엔지니어링 답변 전 반드시 사용할 근거 패키지 생성 도구. 법령·행정규칙·해석례·KDS/KCS·설계기준 해설편을 우선 검색하고, 최종 답변은 반환된 근거와 한계 안에서만 작성해야 합니다. 근거가 부족하면 단정하지 말고 '근거 불충분'으로 표시하세요.",
  {
    question: z.string().describe("검토할 엔지니어링 질문"),
    standard_query: z.string().optional().describe("건설기준 검색어. 생략 시 question 사용"),
    law_query: z.string().optional().describe("법령/행정규칙 검색어. 생략 시 question 사용"),
    include_local_standards: z.boolean().default(false).describe("SMCS/LHCS 등 기관·지자체 기준까지 포함할지 여부. 기본은 KDS/KCS 우선"),
    max_evidence: z.number().default(8).describe("토큰 절감을 위한 최대 근거 항목 수"),
    compact: z.boolean().default(true).describe("짧은 인용문 중심으로 반환하여 모델 토큰 사용량 최소화"),
  },
  async ({ question, standard_query, law_query, include_local_standards, max_evidence, compact }) => {
    const sq = standard_query || question;
    const lq = law_query || question;
    const maxItems = Math.max(3, Math.min(Number(max_evidence) || 8, 20));

    const [standardsRes, lawsRes, interpRes, adminRes] = await Promise.allSettled([
      findStandardEvidence(sq, { includeLocalStandards: include_local_standards, maxStandards: Math.min(4, maxItems), maxSectionsPerStandard: compact ? 2 : 4 }),
      fetchLaw("lawSearch.do", { target: "law", query: lq, display: Math.min(5, maxItems) }),
      fetchLaw("lawSearch.do", { target: "expc", query: lq, display: Math.min(3, maxItems) }),
      fetchLaw("lawSearch.do", { target: "admrul", query: lq, display: Math.min(3, maxItems) }),
    ]);

    const standards = standardsRes.status === "fulfilled" ? standardsRes.value : [];
    const laws = lawsRes.status === "fulfilled" ? lawEvidenceFromSearch(lawsRes.value).slice(0, 3) : [];
    const interpretations = interpRes.status === "fulfilled" ? interpretationEvidenceFromSearch(interpRes.value).slice(0, 2) : [];
    const adminRules = adminRes.status === "fulfilled" ? adminEvidenceFromSearch(adminRes.value).slice(0, 2) : [];
    const manuals = searchManualEvidence(sq, { document: "전체", maxResults: 3 });

    const directStandardSections = standards.reduce((n, item) => n + (item.sections?.length || 0), 0);
    const evidenceCount = standards.length + laws.length + interpretations.length + adminRules.length + manuals.length;
    const evidenceStatus = evidenceCount === 0
      ? "insufficient"
      : directStandardSections || laws.length || adminRules.length
        ? "partial"
        : "weak";

    const payload = {
      question,
      evidence_status: evidenceStatus,
      answer_policy: [
        "법령·시행령·시행규칙 > 행정규칙/고시 > KDS/KCS > 설계기준 해설편 > 기관/지자체 기준 > 실무 관행 순으로 판단하세요.",
        "아래 근거에 없는 사항은 단정하지 말고 '직접 근거 미확인' 또는 '추가 확인 필요'로 표시하세요.",
        "근거자료를 나열하는 데 그치지 말고, 각 근거의 법적/기술적 효력과 질문 적용성을 종합해 결론을 내리세요.",
        "최종 답변에는 출처 유형, 법령명 또는 KDS/KCS 코드, 조문/절 제목, 시행일/개정일, 핵심 인용문을 명기하세요."
      ],
      source_hierarchy: ["법률·시행령·시행규칙", "행정규칙·고시·지침", "KDS 설계기준", "KCS 표준시방서", "상·하수도 설계기준 해설편", "기관·지자체 기준", "실무 관행"],
      evidence: {
        laws,
        admin_rules: adminRules,
        interpretations,
        standards,
        design_manual_commentary: manuals,
      },
      gaps: [],
      required_final_answer_format: ["결론", "쟁점", "확인 근거", "종합 판단", "실무 적용", "한계/추가 확인 필요사항"],
    };

    if (!standards.length) payload.gaps.push(`'${sq}'에 대한 KDS/KCS 직접 후보가 부족합니다. 동의어·상위개념으로 재검색하세요.`);
    if (!laws.length && !adminRules.length) payload.gaps.push(`'${lq}'에 대한 법령/행정규칙 후보가 부족합니다. 법령명 또는 제도명으로 재검색하세요.`);
    if (standards.some((s) => !s.sections?.length)) payload.gaps.push("일부 기준은 상세 절 인용이 없어 원문 상세조회로 조문/절을 보강해야 합니다.");

    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
);


// ══════════════════════════════════════════════════════════════
// 로컬 설계기준 해설편 검색 (파일이 있을 때만 등록)
// ══════════════════════════════════════════════════════════════

const availableDocs = Object.keys(referenceDocs);

if (availableDocs.length > 0) {
  server.tool(
    "search_design_manual",
    `로컬 설계기준 해설편에서 키워드 검색 (보유 문서: ${availableDocs.join(", ")}설계기준 해설편)`,
    {
      query:    z.string().describe("검색 키워드 (예: 배수지 용량, 관거 경사, 슬러지 처리)"),
      document: z.enum(["상수도", "하수도", "전체"]).default("전체")
                 .describe("검색 대상 문서 선택"),
      max_results: z.number().default(3).describe("반환할 최대 섹션 수 (기본 3)"),
    },
    async ({ query, document, max_results }) => {
      const keywords = query.trim().split(/\s+/).filter(Boolean);
      const targets = document === "전체" ? availableDocs : [document].filter(d => referenceDocs[d]);

      if (!targets.length) {
        return { content: [{ type: "text", text: `'${document}' 해설편 파일이 없습니다.` }] };
      }

      const results = [];

      for (const docName of targets) {
        const sections = referenceDocs[docName];

        const scored = sections
          .map((sec) => {
            const text = `${sec.title}\n${sec.content}`;
            const score = keywords.reduce((s, kw) => {
              const matches = (text.match(new RegExp(escapeRegExp(kw), "g")) || []).length;
              return s + matches;
            }, 0);
            return { docName, ...sec, score };
          })
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, max_results);

        results.push(...scored);
      }

      if (!results.length) {
        return { content: [{ type: "text", text: `'${query}' 관련 내용을 해설편에서 찾을 수 없습니다.` }] };
      }

      // 점수 높은 순 재정렬
      results.sort((a, b) => b.score - a.score);

      const lines = [`설계기준 해설편 검색결과: '${query}' (${results.length}건)\n`];
      for (const r of results) {
        lines.push(`${"─".repeat(50)}`);
        lines.push(`📘 [${r.docName}설계기준 해설편] ${r.title}`);
        lines.push("");
        // 내용은 최대 1000자로 제한
        const preview = r.content.length > 1000
          ? r.content.slice(0, 1000) + "\n...(이하 생략)"
          : r.content;
        lines.push(preview);
        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}


// ── 실행 ──────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
