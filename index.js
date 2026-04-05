#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const KCSC_KEY = process.env.KCSC_API_KEY || "";
const LAW_KEY  = process.env.LAW_API_KEY  || "dohwa3547";
const KCSC_BASE = "https://kcsc.re.kr/OpenApi";
const LAW_BASE  = "https://www.law.go.kr/DRF";

// ── KCSC API ──────────────────────────────────────────────────
async function fetchKCSC(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${KCSC_BASE}${path}${sep}key=${KCSC_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KCSC API 오류: ${res.status}`);
  return res.json();
}

// ── 법제처 API ────────────────────────────────────────────────
async function fetchLaw(endpoint, params = {}) {
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


// ── 실행 ──────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
