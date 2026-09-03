import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import { classifyEngineeringDomains, getEngineeringDomain, meaningfulKeywords } from "./domains.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf"]);

export async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result?.text || "";
  } finally {
    await parser.destroy();
  }
}

// 목차 줄 표식. PDF에서 추출한 목차는 제목과 쪽번호 사이를 점선 리더로 채운다.
const TOC_LEADER = /[·.．]{5,}|…{3,}/;

// 품셈·시방서류가 공통으로 쓰는 절 번호(4-1-1, 3-11-2 …)로 시작하는 줄.
const CLAUSE_HEADING = /^\s*\d+-\d+(?:-\d+)?\s+\S/;

function buildSections(lines, isHeading, toTitle) {
  const sections = [];
  let title = "(서두)";
  let body = [];
  let started = false;
  for (const line of lines) {
    if (isHeading(line)) {
      if (started || body.some((item) => item.trim())) {
        sections.push({ title, content: body.join("\n").trim() });
      }
      title = toTitle(line);
      body = [];
      started = true;
    } else {
      body.push(line);
    }
  }
  if (started || body.some((item) => item.trim())) {
    sections.push({ title, content: body.join("\n").trim() });
  }
  return sections.filter((section) => section.title || section.content);
}

// 마크다운은 '#' 헤딩으로 자르지만, PDF/TXT에서 추출한 텍스트에 같은 규칙을 쓰면
// 본문 표의 '# 8 분기기…'(철도 분기기 번호) 같은 줄이 헤딩으로 오인되어 문서
// 전체가 (서두) 한 덩어리로 뭉개진다. 형식별로 분해 방식을 나눈다.
export function parseReferenceSections(content, options = {}) {
  const raw = String(content || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  if (options.format === "text") {
    // 목차 줄은 색인에서 제외한다. 남겨두면 본문보다 앞서 있어 검색 스니펫을
    // 매번 선점하고, 정작 품 표 본문은 노출되지 않는다.
    const lines = raw.filter((line) => !TOC_LEADER.test(line));
    // 절 번호가 전혀 없는 평문이면 종전대로 통째로 한 섹션이 된다.
    return buildSections(
      lines,
      (line) => CLAUSE_HEADING.test(line),
      (line) => line.replace(/\s+/g, " ").trim(),
    );
  }
  return buildSections(
    raw,
    (line) => /^#{1,6}\s/.test(line),
    (line) => line.replace(/^#+\s*/, "").trim(),
  );
}

// 섹션이 짧으면(마크다운 등) 그대로 잘라내지만, PDF처럼 제목 구분 없이
// 문서 전체가 섹션 하나로 들어오는 경우 항상 맨 앞부분만 보여주면 실제
// 매칭 위치(예: 수백 페이지 중 한 줄)를 놓치게 된다. 검색어가 등장하는
// 위치를 중심으로 잘라낸다.
function compact(value, keywords = [], max = 700) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;

  // 최초 출현을 그대로 쓰면, 목차가 본문보다 앞서는 문서에서 목차 줄이 매번
  // 스니펫을 선점한다. 모든 출현 위치를 모아 주변 키워드 밀도가 가장 높은
  // 구간을 고르고, 목차로 보이는 구간에는 감점을 준다.
  const positions = [];
  for (const keyword of keywords) {
    if (!keyword) continue;
    let from = 0;
    let found = normalized.indexOf(keyword, from);
    while (found !== -1 && positions.length < 500) {
      positions.push(found);
      from = found + keyword.length;
      found = normalized.indexOf(keyword, from);
    }
  }
  if (!positions.length) {
    return `${normalized.slice(0, max)}…`;
  }

  const half = Math.floor(max / 2);
  const windowStart = (pos) => Math.max(0, Math.min(pos - half, normalized.length - max));
  let matchIndex = positions[0];
  let bestScore = -Infinity;
  for (const pos of positions) {
    const window = normalized.slice(windowStart(pos), windowStart(pos) + max);
    let score = 0;
    for (const keyword of keywords) {
      if (keyword) score += window.split(keyword).length - 1;
    }
    if (TOC_LEADER.test(window)) score -= 1;
    if (score > bestScore) {
      bestScore = score;
      matchIndex = pos;
    }
  }

  const start = windowStart(matchIndex);
  const end = Math.min(normalized.length, start + max);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function walk(root, current, depth, maxDepth, files) {
  if (depth > maxDepth) return;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, fullPath, depth + 1, maxDepth, files);
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
}

export async function discoverReferenceDocuments(referenceDir, options = {}) {
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles) || 50, 500));
  const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes) || 5 * 1024 * 1024, 50 * 1024 * 1024));
  const maxDepth = Math.max(0, Math.min(Number(options.maxDepth) || 3, 8));
  const root = resolve(String(referenceDir || ""));
  if (!referenceDir || !existsSync(root)) return [];
  try {
    if (!statSync(root).isDirectory()) return [];
  } catch {
    return [];
  }

  const files = [];
  walk(root, root, 0, maxDepth, files);
  const documents = [];
  for (const filePath of files.sort().slice(0, maxFiles)) {
    try {
      const stat = statSync(filePath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) continue;
      const ext = extname(filePath).toLowerCase();
      const isPdf = ext === ".pdf";
      const isMarkdown = ext === ".md" || ext === ".markdown";
      const raw = isPdf ? await extractPdfText(readFileSync(filePath)) : readFileSync(filePath, "utf8");
      const rel = relative(root, filePath).replace(/\\/g, "/");
      const sections = parseReferenceSections(raw, { format: isMarkdown ? "markdown" : "text" });
      // 절 번호 섹션 제목은 문서 제목이 아니다. 마크다운의 첫 헤딩만 제목으로 승격한다.
      const firstHeading = isMarkdown
        ? sections.find((section) => section.title !== "(서두)")?.title
        : undefined;
      const domainMatches = classifyEngineeringDomains(`${rel} ${firstHeading || ""} ${raw.slice(0, 1200)}`, 3);
      const primaryDomain = domainMatches[0];
      documents.push({
        id: rel,
        title: firstHeading || basename(filePath, extname(filePath)),
        relative_path: rel,
        domain_key: primaryDomain.key,
        domain_label: primaryDomain.label,
        domain_keys: domainMatches.map((domain) => domain.key),
        domain_labels: domainMatches.map((domain) => domain.label),
        size_bytes: stat.size,
        sections,
      });
    } catch {
      // 개별 참고문서 오류는 전체 MCP 시작을 막지 않는다.
    }
  }
  return documents;
}

function countOccurrences(text, term) {
  if (!term) return 0;
  return String(text).split(term).length - 1;
}

export function searchReferenceDocuments(documents, query, options = {}) {
  const maxResults = Math.max(1, Math.min(Number(options.maxResults) || 5, 20));
  const requestedDomain = String(options.domain || "auto");
  const keywords = meaningfulKeywords(query);
  const explicitDomain = requestedDomain === "auto" ? null : getEngineeringDomain(requestedDomain);
  const inferred = explicitDomain
    ? [{ ...explicitDomain, score: 100, matched_terms: [explicitDomain.label] }]
    : classifyEngineeringDomains(query, 2);
  const domainKeys = new Set(inferred.map((item) => item.key));
  const results = [];

  for (const doc of documents || []) {
    const docDomainKeys = doc.domain_keys || [doc.domain_key];
    if (requestedDomain !== "auto" && !docDomainKeys.some((key) => domainKeys.has(key))) continue;
    for (const section of doc.sections || []) {
      const text = `${section.title}\n${section.content}`;
      const keywordScore = keywords.reduce((score, keyword) => score + countOccurrences(text, keyword), 0);
      const domainBoost = docDomainKeys.some((key) => domainKeys.has(key)) ? 2 : 0;
      const titleBoost = keywords.some((keyword) => String(section.title).includes(keyword)) ? 3 : 0;
      const score = keywordScore + domainBoost + titleBoost;
      if (score <= 0) continue;
      results.push({
        source_type: "local_reference_document",
        trust_level: "local_reference_unverified",
        document_id: doc.id,
        document_title: doc.title,
        relative_path: doc.relative_path,
        domain_key: doc.domain_key,
        domain_label: doc.domain_label,
        domain_keys: docDomainKeys,
        domain_labels: doc.domain_labels || [doc.domain_label],
        section: section.title,
        quote: compact(section.content || section.title, keywords, options.compact === false ? 1400 : 700),
        relevance_score: score,
        citation_note: "로컬 참고자료입니다. 발행기관·판·개정일과 원문을 별도 확인한 뒤 공식 근거로 사용하세요.",
      });
    }
  }
  return results
    .sort((a, b) => b.relevance_score - a.relevance_score || a.document_title.localeCompare(b.document_title, "ko"))
    .slice(0, maxResults);
}
