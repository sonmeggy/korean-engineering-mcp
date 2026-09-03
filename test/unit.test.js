import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// index.js를 import해도 stdio 서버가 연결되지 않도록 가드
process.env.KOREAN_ENGINEERING_MCP_SKIP_AUTOSTART = '1';

const {
  parseDotEnv,
  parseSections,
  stripHtml,
  keywordsFrom,
  extractList,
  compactText,
  scoreText,
  escapeRegExp,
  normalizeLawArticles,
  normalizeAdminRuleArticles,
  buildDomainSearchPlan,
  classifyEngineeringDomains,
  resolveEngineeringDomains,
  renderEngineeringAnswerHtml,
  sanitizeHtmlFilename,
  writeEngineeringAnswerHtml,
  applyEvidenceBudget,
  rankStandards,
  countFlexible,
  expandSearchTerms,
  readCodeListDiskCache,
  writeCodeListDiskCache,
} = await import('../index.js');

const {
  discoverReferenceDocuments,
  searchReferenceDocuments,
} = await import('../src/references.js');

const {
  normalizeDateDigits,
  formatDateDigits,
  nameSimilarityScore,
  evaluateCitation,
} = await import('../src/citations.js');

const {
  parseLatestStandardEstimationEntry,
  parseAttachmentLinks,
  selectOriginalDocumentAttachment,
  derCertificateToPem,
} = await import('../src/standard-estimation.js');

const {
  hashSkillDirectory,
  syncBundledSkill,
} = await import('../scripts/sync-skill.mjs');

test('parseDotEnv parses key=value lines and ignores comments', () => {
  const parsed = parseDotEnv('# comment\nKCSC_API_KEY=abc123\nLAW_API_KEY="quoted value"\n\nBROKEN_LINE\n');
  assert.equal(parsed.KCSC_API_KEY, 'abc123');
  assert.equal(parsed.LAW_API_KEY, 'quoted value');
  assert.equal(Object.keys(parsed).length, 2);
});

test('parseSections splits markdown by headers without duplicating the title', () => {
  const sections = parseSections('서두 내용\n# 1장 총칙\n본문 A\n## 1.1 목적\n본문 B');
  assert.equal(sections.length, 3);
  assert.deepEqual(sections[0], { title: '(서두)', content: '서두 내용' });
  assert.deepEqual(sections[1], { title: '1장 총칙', content: '본문 A' });
  assert.deepEqual(sections[2], { title: '1.1 목적', content: '본문 B' });
});

test('stripHtml removes tags and decodes common entities', () => {
  assert.equal(stripHtml('<p>배수지&nbsp;용량은 &lt;표 1&gt; 참조</p>'), '배수지 용량은 <표 1> 참조');
  assert.equal(stripHtml(''), '');
});

test('keywordsFrom tokenizes multi-word queries and drops 1-char tokens', () => {
  assert.deepEqual(keywordsFrom('상수도 관로 경사'), ['상수도', '관로', '경사']);
  assert.deepEqual(keywordsFrom('"배수지" (용량)'), ['배수지', '용량']);
  assert.deepEqual(keywordsFrom('a 물'), []);
});

test('scoreText counts matched keywords', () => {
  assert.equal(scoreText('상수도 설계기준 관로', ['상수도', '관로']), 2);
  assert.equal(scoreText('하수도 시설', ['상수도']), 0);
});

test('extractList handles array, single object, and missing keys', () => {
  assert.deepEqual(extractList({ law: [{ a: 1 }] }, 'law'), [{ a: 1 }]);
  assert.deepEqual(extractList({ law: { a: 1 } }, 'law'), [{ a: 1 }]);
  assert.deepEqual(extractList({}, 'law'), []);
  assert.deepEqual(extractList(null, 'law'), []);
});

test('compactText truncates with ellipsis', () => {
  assert.equal(compactText('가나다라마', 3), '가나다…');
  assert.equal(compactText('  가나  다  ', 10), '가나 다');
});

test('escapeRegExp escapes regex metacharacters', () => {
  assert.equal(new RegExp(escapeRegExp('표 1.2(주)')).test('본문 표 1.2(주) 참조'), true);
});

test('normalizeLawArticles extracts scored article quotes from law detail JSON', () => {
  const detail = {
    법령: {
      기본정보: { 시행일자: '20240101' },
      조문: {
        조문단위: [
          { 조문번호: '1', 조문제목: '목적', 조문내용: '이 법은 상수도의 설치에 관한 사항을 규정한다.' },
          { 조문번호: '2', 조문제목: '정의', 조문내용: '하수도 용어 정의', 항: [{ 항내용: '항 내용', 호: [{ 호내용: '호 내용' }] }] },
        ],
      },
    },
  };
  const all = normalizeLawArticles(detail, '', 8);
  assert.equal(all.length, 2);
  assert.equal(all[0].effective_date, '20240101');
  const filtered = normalizeLawArticles(detail, '상수도', 8);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].article_number, '1');
  assert.match(filtered[0].quote, /상수도/);
  assert.equal('score' in filtered[0], false);
});

test('normalizeAdminRuleArticles extracts 조문 and 별표 items', () => {
  const detail = {
    AdmRulService: {
      기본정보: { 시행일자: '20230601' },
      조문: { 조문단위: [{ 조문번호: '3', 조문제목: '기술진단', 조문내용: '기술진단 주기는 5년으로 한다.' }] },
      별표: { 별표단위: [{ 별표번호: '1', 별표제목: '진단 항목', 별표내용: [['수질', '누수']] }] },
    },
  };
  const items = normalizeAdminRuleArticles(detail, '', 8);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.source_part).sort(), ['별표', '조문']);
  const filtered = normalizeAdminRuleArticles(detail, '기술진단', 8);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].source_part, '조문');
});

test('classifyEngineeringDomains covers the requested engineering sectors', () => {
  const cases = [
    ['상수도 배수지 용량 검토', 'water_supply'],
    ['하수도 관거 우수 배제', 'wastewater'],
    ['도로 포장과 배수시설', 'road'],
    ['철도 노반과 승강장', 'railway'],
    ['도시개발 지구단위계획', 'urban_planning'],
    ['하천 제방과 호안', 'river'],
    ['항만 방파제와 안벽', 'port'],
    ['공항 활주로와 유도로', 'airport'],
    ['건축물 구조와 피난', 'architecture'],
  ];
  for (const [question, expected] of cases) {
    assert.equal(classifyEngineeringDomains(question, 1)[0].key, expected, question);
  }
});

test('explicit domain keys and labels are accepted and bad keys are rejected', () => {
  assert.equal(resolveEngineeringDomains('일반 질문', 'urban_planning', 1)[0].key, 'urban_planning');
  assert.equal(resolveEngineeringDomains('일반 질문', '공항·항공', 1)[0].key, 'airport');
  assert.throws(() => resolveEngineeringDomains('일반 질문', 'unknown-domain', 1), /지원하지 않는/);
});

test('domain search plan adds law and admin-rule hints for fields with limited KCSC coverage', () => {
  const plan = buildDomainSearchPlan('공항 활주로 설치기준 검토', 'auto');
  assert.equal(plan.detected_domains[0].key, 'airport');
  assert.ok(plan.law_queries.includes('공항시설법'));
  assert.ok(plan.admin_rule_queries.some((query) => query.includes('공항')));
  assert.match(plan.detected_domains[0].coverage, /KCSC 직접 기준은 제한적/);
});

test('global evidence budget is enforced while preserving source diversity', () => {
  const groups = {
    laws: ['l1', 'l2', 'l3'],
    adminRules: ['a1', 'a2'],
    standards: ['s1', 's2', 's3', 's4'],
    manuals: ['m1', 'm2'],
    interpretations: ['i1', 'i2'],
  };
  const budgeted = applyEvidenceBudget(groups, 5);
  assert.equal(budgeted.selected_count, 5);
  assert.equal(budgeted.max_evidence, 5);
  assert.deepEqual(budgeted.laws, ['l1']);
  assert.deepEqual(budgeted.adminRules, ['a1']);
  assert.deepEqual(budgeted.standards, ['s1']);
  assert.deepEqual(budgeted.manuals, ['m1']);
  assert.deepEqual(budgeted.interpretations, ['i1']);
});

test('generic reference discovery and search work across engineering domains', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-ref-'));
  mkdirSync(join(root, '도로'), { recursive: true });
  mkdirSync(join(root, '공항'), { recursive: true });
  writeFileSync(join(root, '도로', '도로포장.md'), '# 도로포장 지침\n## 배수성 포장\n포장 배수와 미끄럼 저항을 검토한다.', 'utf8');
  writeFileSync(join(root, '공항', '활주로.txt'), '# 활주로 참고자료\n활주로 길이와 안전구역을 검토한다.', 'utf8');

  const docs = await discoverReferenceDocuments(root, { maxFiles: 10, maxBytes: 1024 * 1024, maxDepth: 3 });
  assert.equal(docs.length, 2);
  assert.ok(docs.some((doc) => doc.domain_key === 'road'));
  assert.ok(docs.some((doc) => doc.domain_key === 'airport'));
  assert.ok(docs.every((doc) => Array.isArray(doc.domain_keys) && doc.domain_keys.length >= 1));

  const results = searchReferenceDocuments(docs, '포장 배수', { domain: 'road', maxResults: 5 });
  assert.ok(results.length >= 1);
  assert.equal(results[0].domain_key, 'road');
  assert.equal(results[0].trust_level, 'local_reference_unverified');
});

// pdf-parse는 손상된 xref 테이블도 폴백 파싱으로 복구하므로, 최소 유효 PDF를
// 손으로 만들어도 텍스트 추출이 된다 (실제 pdf-parse@2.4.5로 검증됨).
function buildMinimalPdf(text) {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 300 144]/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${text.length + 20}>>\nstream\nBT /F1 12 Tf 10 100 Td (${text}) Tj ET\nendstream\nendobj\ntrailer<</Size 6/Root 1 0 R>>\n%%EOF`,
    'latin1',
  );
}

test('discoverReferenceDocuments extracts searchable text from PDF reference files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-ref-pdf-'));
  writeFileSync(join(root, '표준품셈-2026.pdf'), buildMinimalPdf('Excavation backhoe 0.4 item exists in this edition'));

  const docs = await discoverReferenceDocuments(root, { maxFiles: 10, maxBytes: 1024 * 1024, maxDepth: 1 });
  assert.equal(docs.length, 1);
  assert.match(docs[0].sections.map((s) => s.content).join('\n'), /backhoe 0\.4/);

  const results = searchReferenceDocuments(docs, 'backhoe 0.4', { maxResults: 5 });
  assert.equal(results.length, 1);
  assert.match(results[0].quote, /backhoe 0\.4/);
});

test('searchReferenceDocuments returns a keyword-centered snippet instead of always the start of a long section', () => {
  const filler = '문단 '.repeat(400); // 700자 기본 한도를 넘기기 위한 채움 텍스트
  const needle = '굴착 백호0.4 항목이 이 위치에 존재한다';
  const longContent = `${filler}${needle}${filler}`;
  const docs = [{
    id: 'doc-1',
    title: '표준품셈',
    relative_path: '표준품셈.pdf',
    domain_key: 'general',
    domain_label: '공통',
    domain_keys: ['general'],
    domain_labels: ['공통'],
    sections: [{ title: '(서두)', content: longContent }],
  }];

  const results = searchReferenceDocuments(docs, '백호0.4', { maxResults: 5 });
  assert.equal(results.length, 1);
  assert.match(results[0].quote, /백호0\.4/);
});

test('HTML renderer preserves report structure while escaping untrusted raw HTML and unsafe links', () => {
  const markdown = '## 결론\n- **조건부 가능**\n\n| 항목 | 내용 |\n|---|---|\n| 기준 | KDS 확인 |\n\n<script>alert(1)</script>\n\n[위험 링크](javascript:alert(1))\n\n[HTTP 링크](http://example.com)\n\n[공식 링크](https://www.kcsc.re.kr)\n\n![외부 추적 이미지](https://tracking.example/pixel.png)';
  const options = {
    title: '<검토서>',
    answer_markdown: markdown,
    domain_label: '도로·교통',
    prepared_at: '2026-07-15 10:00 KST',
  };
  const rendered = renderEngineeringAnswerHtml(options);
  const repeated = renderEngineeringAnswerHtml(options);
  assert.match(rendered.html, /<h2>결론<\/h2>/);
  assert.match(rendered.html, /<table>/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(rendered.html, /href="javascript:/i);
  assert.doesNotMatch(rendered.html, /href="http:/i);
  assert.match(rendered.html, /href="https:\/\/www\.kcsc\.re\.kr"/);
  assert.doesNotMatch(rendered.html, /<img\b/i);
  assert.match(rendered.html, /\[이미지: 외부 추적 이미지\]/);
  assert.match(rendered.html, /engineering-answer-sha256/);
  assert.match(rendered.html, /보고서 복사/);
  assert.match(rendered.html, /@page \{ size: A4/);
  assert.equal(rendered.html, repeated.html);
  assert.equal(rendered.html_sha256, repeated.html_sha256);
  assert.throws(
    () => renderEngineeringAnswerHtml({ title: '제어문자', answer_markdown: '본문\u0000' }),
    /제어문자/,
  );
});

test('HTML renderer omits a trailing conversational HTML opt-in prompt', () => {
  const engineeringMarkdown = '## 결론\n연소방식 검토 본문입니다.';
  const sourceMarkdown = `${engineeringMarkdown}\n\n동일 내용의 HTML 보고서도 생성할까요?`;
  const rendered = renderEngineeringAnswerHtml({
    title: '하수처리시설 악취 탈취 검토',
    answer_markdown: sourceMarkdown,
    prepared_at: '2026-07-21 11:00 KST',
  });

  assert.match(rendered.html, /연소방식 검토 본문입니다/);
  assert.doesNotMatch(rendered.html, /동일 내용의 HTML 보고서도 생성할까요/);
  assert.equal(
    rendered.answer_markdown_sha256,
    createHash('sha256').update(engineeringMarkdown, 'utf8').digest('hex'),
  );
  assert.throws(
    () => renderEngineeringAnswerHtml({ answer_markdown: '동일 내용의 HTML 보고서도 생성할까요?' }),
    /엔지니어링 본문/,
  );

  const promptDiscussedInsideReport = renderEngineeringAnswerHtml({
    title: '보고서 생성 절차 설명',
    answer_markdown: '## 절차\n`동일 내용의 HTML 보고서도 생성할까요?`라는 질문은 별도로 보낸다.\n\n기술 본문 끝.',
    prepared_at: '2026-07-21 11:00 KST',
  });
  assert.match(promptDiscussedInsideReport.html, /동일 내용의 HTML 보고서도 생성할까요/);
});

test('HTML renderer converts inline and display TeX to offline MathML', () => {
  const markdown = [
    '## 수식 검토',
    '인라인 유량식 $Q = A v$를 적용한다.',
    '',
    '$$',
    String.raw`h_f = f \frac{L}{D} \frac{v^2}{2g}`,
    '$$',
    '',
    '코드 표기는 `$Q = A v$` 그대로 유지한다.',
    String.raw`금액 표기는 \$1,000처럼 이스케이프하면 수식으로 해석하지 않는다.`,
    '',
    String.raw`악성 명령은 실행하지 않는다: $\href{javascript:alert(1)}{x}$`,
  ].join('\n');
  const rendered = renderEngineeringAnswerHtml({
    title: '관로 손실수두 검토',
    answer_markdown: markdown,
    prepared_at: '2026-07-16 10:00 KST',
  });

  assert.match(rendered.html, /class="math-inline"/);
  assert.equal((rendered.html.match(/class="math-inline"/g) || []).length, 2);
  assert.match(rendered.html, /class="math-display"/);
  assert.match(rendered.html, /<math\b/);
  assert.match(rendered.html, /<mfrac>/);
  assert.match(rendered.html, /<msup>/);
  assert.match(rendered.html, /data-tex="Q = A v"/);
  assert.match(rendered.html, /<code>\$Q = A v\$<\/code>/);
  assert.match(rendered.html, /금액 표기는 \$1,000처럼/);
  assert.doesNotMatch(rendered.html, /href="javascript:/i);
  assert.doesNotMatch(rendered.html, /<script[^>]+(?:mathjax|katex)|https?:\/\/.*(?:mathjax|katex)/i);
  assert.match(rendered.html, /math-style: normal/);
});

test('managed skill sync updates an existing install with backup and hash verification', () => {
  const home = mkdtempSync(join(tmpdir(), 'kemcp-skill-home-'));
  const hermesHome = join(home, '.hermes');
  const destination = join(hermesHome, 'skills', 'korean-engineering-grounded-answer');
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'SKILL.md'), '---\nname: korean-engineering-grounded-answer\nversion: 1.1.0\n---\n\nOLD POLICY\n', 'utf8');
  writeFileSync(join(destination, 'local-note.md'), 'user customization', 'utf8');

  const env = { HOME: home, HERMES_HOME: hermesHome };
  const first = syncBundledSkill({ client: 'hermes', env, now: new Date('2026-07-16T00:00:00Z') });
  assert.equal(first.status, 'updated');
  assert.equal(first.previous_version, '1.1.0');
  assert.equal(first.installed_version, '1.3.1');
  assert.equal(first.source_sha256, first.installed_sha256);
  assert.equal(hashSkillDirectory(destination), first.source_sha256);
  assert.match(readFileSync(join(destination, 'SKILL.md'), 'utf8'), /동일 내용의 HTML 보고서도 생성할까요/);
  assert.match(readFileSync(join(destination, 'SKILL.md'), 'utf8'), /excluding the conversational HTML opt-in prompt/);
  assert.match(readFileSync(join(destination, 'SKILL.md'), 'utf8'), /offline MathML/);
  assert.ok(first.backup_path);
  assert.equal(readFileSync(join(first.backup_path, 'local-note.md'), 'utf8'), 'user customization');
  assert.match(readFileSync(join(first.backup_path, 'SKILL.md'), 'utf8'), /version: 1\.1\.0/);

  const backupCount = readdirSync(dirname(first.backup_path)).length;
  const second = syncBundledSkill({ client: 'hermes', env, now: new Date('2026-07-16T00:01:00Z') });
  assert.equal(second.status, 'unchanged');
  assert.equal(second.backup_path, null);
  assert.equal(readdirSync(dirname(first.backup_path)).length, backupCount);
});

test('skill sync CLI executes correctly through an npm-bin style symlink', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-skill-bin-'));
  const home = join(root, 'home');
  const bin = join(root, 'korean-engineering-mcp-sync-skill');
  mkdirSync(home, { recursive: true });
  symlinkSync(fileURLToPath(new URL('../scripts/sync-skill.mjs', import.meta.url)), bin);
  const result = spawnSync(bin, ['hermes', '--dry-run', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, HERMES_HOME: join(home, '.hermes') },
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'would_install');
  assert.equal(payload.source_version, '1.3.1');
  assert.equal(payload.source_sha256.length, 64);

  const allResult = spawnSync(bin, ['all', '--dry-run', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, HERMES_HOME: join(home, '.hermes') },
  });
  assert.equal(allResult.status, 0, allResult.stderr);
  const allPayload = JSON.parse(allResult.stdout);
  assert.equal(allPayload.length, 3);
  assert.deepEqual(new Set(allPayload.map((item) => item.client)), new Set(['hermes', 'claude', 'antigravity']));
});

test('HTML output stays inside the configured directory and avoids overwriting', () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-html-'));
  const options = {
    title: '도로 배수 검토',
    answer_markdown: '## 결론\n- 검토 완료',
    output_dir: root,
    filename: '../도로/검토서.html',
    prepared_at: '2026-07-15 10:00 KST',
  };
  const first = writeEngineeringAnswerHtml(options);
  const second = writeEngineeringAnswerHtml(options);
  assert.ok(first.output_path.startsWith(root));
  assert.ok(second.output_path.startsWith(root));
  assert.notEqual(first.output_path, second.output_path);
  assert.equal(sanitizeHtmlFilename('../도로/검토서.html'), '도로-검토서.html');
  assert.match(readFileSync(first.output_path, 'utf8'), /도로 배수 검토/);
  assert.equal(first.answer_markdown_sha256.length, 64);
});

test('normalizeDateDigits parses common Korean date notations to YYYYMMDD', () => {
  assert.equal(normalizeDateDigits('2024.12.23'), '20241223');
  assert.equal(normalizeDateDigits('2024-12-23'), '20241223');
  assert.equal(normalizeDateDigits('20241223'), '20241223');
  assert.equal(normalizeDateDigits('2024.2.3'), '20240203');
  assert.equal(normalizeDateDigits('2024년 2월 3일'), '20240203');
  assert.equal(normalizeDateDigits(''), '');
  assert.equal(normalizeDateDigits('모름'), '');
});

test('formatDateDigits renders YYYYMMDD as dotted date and passes through invalid input', () => {
  assert.equal(formatDateDigits('20241223'), '2024.12.23');
  assert.equal(formatDateDigits('bad'), 'bad');
});

test('nameSimilarityScore ranks exact, substring, and token-overlap matches', () => {
  assert.equal(nameSimilarityScore('예산군 하수도 사용 조례', '예산군 하수도 사용 조례'), 100);
  assert.equal(nameSimilarityScore('하수도 사용 조례', '예산군 하수도 사용 조례'), 70);
  assert.equal(nameSimilarityScore('전혀 다른 이름', '예산군 하수도 사용 조례'), 0);
});

test('evaluateCitation flags a region mismatch when the cited ordinance belongs to a different municipality', () => {
  // 실제로 발견된 사례를 재현: 예산군 사업 문서에 안동시 조례가 잘못 인용된 경우
  const citation = {
    kind: 'ordinance',
    name: '안동시 하수도 사용 조례 시행규칙',
    region: '예산군',
    claimed_date: '2024-12-23',
  };
  const candidates = [
    { title: '안동시 하수도 사용 조례 시행규칙', region: '경상북도 안동시', effective_date: '20200918', url: 'https://example.test/andong' },
  ];
  const result = evaluateCitation(citation, candidates);
  assert.equal(result.status, 'mismatch');
  assert.ok(result.reasons.some((r) => r.includes('지자체 불일치')));
  assert.ok(result.reasons.some((r) => r.includes('시행일자 불일치')));
});

test('evaluateCitation reports current when name, date, and issuer all match', () => {
  const citation = { kind: 'law', name: '하수도법', claimed_date: '2025.10.1', claimed_issuer: '기후에너지환경부' };
  const candidates = [
    { title: '하수도법', ministry: '기후에너지환경부', effective_date: '20251001', url: 'https://example.test/law' },
  ];
  const result = evaluateCitation(citation, candidates);
  assert.equal(result.status, 'current');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.matched.title, '하수도법');
});

test('evaluateCitation flags an issuer mismatch, e.g. after a ministry reorganization', () => {
  const citation = { kind: 'admin_rule', name: '하수도설계기준', claimed_issuer: '환경부' };
  const candidates = [
    { title: '하수도설계기준', agency: '기후에너지환경부', effective_date: '20251001', url: 'https://example.test/admrul' },
  ];
  const result = evaluateCitation(citation, candidates);
  assert.equal(result.status, 'mismatch');
  assert.ok(result.reasons.some((r) => r.includes('소관부처 불일치')));
});

test('evaluateCitation returns not_found for an empty candidate list', () => {
  const result = evaluateCitation({ kind: 'law', name: '존재하지않는법' }, []);
  assert.equal(result.status, 'not_found');
  assert.equal(result.matched, null);
});

test('evaluateCitation returns ambiguous when top candidates tie in score', () => {
  const citation = { kind: 'ordinance', name: '하수도 사용 조례', region: undefined };
  const candidates = [
    { title: '가나시 하수도 사용 조례', region: '가나시', effective_date: '20240101' },
    { title: '다라시 하수도 사용 조례', region: '다라시', effective_date: '20240101' },
  ];
  const result = evaluateCitation(citation, candidates);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.alternatives.length, 2);
});

// codil.or.kr 게시판 실제 응답 구조를 축약 재현한 픽스처 (2026-07 확인).
const CODIL_LIST_FIXTURE = `
<tbody>
  <tr style="cursor:pointer;" onclick="document.location.href='/helpdesk/read.do;jsessionid=abc.codil_servlet_engine1?bbsId=BBSMSTR_900000000202&nttId=13261&searchWrd='">
    <td>25</td>
    <td class="title">
      2026년 건설공사 표준품셈
      <span style="FONT-WEIGHT: bold; COLOR: red"></span>
    </td>
    <td>관리자</td>
    <td >2026-01-02</td>
    <td >115339</td>
  </tr>
  <tr style="cursor:pointer;" onclick="document.location.href='/helpdesk/read.do;jsessionid=abc.codil_servlet_engine1?bbsId=BBSMSTR_900000000202&nttId=13212&searchWrd='">
    <td>24</td>
    <td class="title">
      2025년 하반기 적용 건설공사 표준품셈
      <span style="FONT-WEIGHT: bold; COLOR: red"></span>
    </td>
    <td>관리자</td>
    <td >2025-08-05</td>
    <td >24768</td>
  </tr>
</tbody>`;

const CODIL_DETAIL_FIXTURE = `
<ul class="file_list">
  <li class="file" style="margin-left: 10px;">
    <a href="/filebank/files/202601/helpdesk/BBS_202601021022218410.pdf?atchFileId=FILE_000000000011032&fileSn=0" target="_blank">
    1._(공고문)_2026년_적용_건설공사_표준품셈_개정_공고.pdf&nbsp;[105.8 Kbyte]
    </a>
  </li>
  <li class="file" style="margin-left: 10px;">
    <a href="/filebank/files/202601/helpdesk/BBS_202601021022219232.pdf?atchFileId=FILE_000000000011032&fileSn=2" target="_blank">
    3._(공고자료)_2026년_건설공사_표준품셈_개정사항.pdf&nbsp;[3.3 Mbyte]
    </a>
  </li>
  <li class="file" style="margin-left: 10px;">
    <a href="/filebank/files/202601/helpdesk/FILE_000000000011032_3.PDF?atchFileId=FILE_000000000011032&fileSn=3" target="_blank">
    2026 건설공사표준품셈_원문(정오표1차 반영).pdf&nbsp;[6.7 Mbyte]
    </a>
  </li>
  <li class="file" style="margin-left: 10px;">
    <a href="/filebank/files/202601/helpdesk/FILE_000000000011032_4.PDF?atchFileId=FILE_000000000011032&fileSn=4" target="_blank">
    2026년_건설공사표준품셈_개정사항_정오표1차.pdf&nbsp;[68.5 Kbyte]
    </a>
  </li>
</ul>`;

test('parseLatestStandardEstimationEntry finds the newest board entry whose title contains 품셈', () => {
  const entry = parseLatestStandardEstimationEntry(CODIL_LIST_FIXTURE);
  assert.deepEqual(entry, { nttId: '13261', title: '2026년 건설공사 표준품셈', date: '2026-01-02' });
});

test('parseLatestStandardEstimationEntry returns null when no row matches', () => {
  assert.equal(parseLatestStandardEstimationEntry('<tbody></tbody>'), null);
});

test('parseAttachmentLinks extracts only PDF attachments with filename and parsed size', () => {
  const attachments = parseAttachmentLinks(CODIL_DETAIL_FIXTURE);
  assert.equal(attachments.length, 4);
  assert.equal(attachments[2].filename, '2026 건설공사표준품셈_원문(정오표1차 반영).pdf');
  assert.match(attachments[2].url, /^https:\/\/www\.codil\.or\.kr\/filebank/);
  assert.equal(attachments[2].size_text, '6.7 Mbyte');
  assert.ok(attachments[2].size_bytes > attachments[0].size_bytes);
});

test('selectOriginalDocumentAttachment prefers the file named 원문 over larger unrelated attachments', () => {
  const attachments = parseAttachmentLinks(CODIL_DETAIL_FIXTURE);
  const chosen = selectOriginalDocumentAttachment(attachments);
  assert.equal(chosen.filename, '2026 건설공사표준품셈_원문(정오표1차 반영).pdf');
});

test('selectOriginalDocumentAttachment falls back to the largest PDF when nothing is named 원문', () => {
  const attachments = [
    { filename: 'a.pdf', size_bytes: 100, url: 'https://example.test/a.pdf' },
    { filename: 'b.pdf', size_bytes: 900, url: 'https://example.test/b.pdf' },
  ];
  assert.equal(selectOriginalDocumentAttachment(attachments).filename, 'b.pdf');
  assert.equal(selectOriginalDocumentAttachment([]), null);
});

test('derCertificateToPem wraps base64 DER bytes in a standard PEM certificate block', () => {
  const der = Buffer.from('not-a-real-certificate-but-long-enough-to-wrap-across-multiple-lines-of-output');
  const pem = derCertificateToPem(der);
  assert.match(pem, /^-----BEGIN CERTIFICATE-----\n/);
  assert.match(pem, /\n-----END CERTIFICATE-----\n$/);
  assert.equal(Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64').toString(), der.toString());
});

// ── 표준품셈(PDF→TXT) 검색 결함 회귀 테스트 ──────────────────────
// 실제 2026년 표준품셈 원문에서 드러난 결함들. 캐시된 원문은 2MB/49,217행이며
// 목차(점선 리더)가 본문보다 앞서고, 철도 분기기 표의 '# 8 …' 행이 마크다운
// 헤딩으로 오인되어 문서 전체가 (서두) 한 덩어리로 뭉개졌다.

const 품셈_목차 = [
  '제4장 조경공사 91',
  '4-1 잔디 및 초화류 ······························91',
  '4-1-1 \t잔디붙임 \t································································91',
  '4-1-2 \t판형잔디붙임 \t··························································91',
].join('\n');

const 품셈_본문 = [
  '4-1-1 \t잔디붙임(\'06, \t\'13, \t\'19, \t\'24년 \t보완)',
  '(일당)',
  '구 \t분 \t단 \t위 \t수 \t량 시공량(㎡)',
  '줄떼 \t평떼',
  '조 \t경 \t공 \t인 \t1 170 \t150',
  '보 \t통 \t인 \t부 \t인 \t4',
  '[주] \t① \t본 \t품은 \t재배잔디를 \t붙이는 \t기준이다.',
].join('\n');

// 철도 분기기 번호(#8, #10)가 줄머리에 오는 실제 표 행
const 분기기_표 = '# 8 \t분 기 기 궤 \t도 \t공 \t인 \t37 \t35';

function 품셈문서(root) {
  writeFileSync(
    join(root, '표준품셈-원문.txt'),
    `${품셈_목차}\n${'채움 '.repeat(500)}\n${품셈_본문}\n${분기기_표}\n`,
    'utf8',
  );
}

test('표준품셈 검색은 목차가 아니라 실제 품 표 본문을 인용한다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-est-toc-'));
  품셈문서(root);

  const docs = await discoverReferenceDocuments(root, { maxFiles: 3, maxBytes: 8 * 1024 * 1024, maxDepth: 1 });
  const results = searchReferenceDocuments(docs, '잔디붙임', { maxResults: 5 });

  assert.ok(results.length >= 1, '검색 결과가 있어야 한다');
  const quote = results[0].quote;
  assert.doesNotMatch(quote, /·{5,}/, '목차의 점선 리더가 인용문에 들어가면 안 된다');
  assert.match(quote, /조 ?경 ?공|보 ?통 ?인 ?부|170/, '실제 품 표 내용을 인용해야 한다');
});

test('표준품셈 텍스트는 절 번호 단위로 섹션이 분해된다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-est-sec-'));
  품셈문서(root);

  const docs = await discoverReferenceDocuments(root, { maxFiles: 3, maxBytes: 8 * 1024 * 1024, maxDepth: 1 });
  const results = searchReferenceDocuments(docs, '잔디붙임', { maxResults: 5 });

  assert.notEqual(results[0].section, '(서두)', '문서 전체가 (서두) 한 덩어리면 안 된다');
  assert.match(results[0].section, /4-1-1/, '섹션 제목이 해당 절 번호여야 한다');
});

test('본문의 # 로 시작하는 표 행을 마크다운 헤딩으로 오인하지 않는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-est-hash-'));
  품셈문서(root);

  const docs = await discoverReferenceDocuments(root, { maxFiles: 3, maxBytes: 8 * 1024 * 1024, maxDepth: 1 });
  assert.equal(docs.length, 1);
  assert.doesNotMatch(docs[0].title, /분 ?기 ?기/, '분기기 표 행이 문서 제목이 되면 안 된다');
});


// ── 건설기준 검색: 분야 가산점만으로 통과하는 문제 회귀 테스트 ──────
// '경계석'처럼 어떤 기준 제목에도 없는 낱말로 검색하면 분야 분류가 '공통'으로
// 떨어지고, 공통(10 계열) 가산점만으로 점수가 0을 넘어 무관한 공통기준 23건이
// 검색결과처럼 반환됐다. 가산점은 순위 조정용이지 통과 자격이 아니다.

const 기준목록 = [
  { codeType: 'KDS', code: '100000', name: '공통설계기준', no: 1 },
  { codeType: 'KCS', code: '101005', name: '공사일반', no: 2 },
  { codeType: 'KCS', code: '346025', name: '조경포장경계', no: 3 },
  { codeType: 'KDS', code: '346010', name: '보도포장', no: 4 },
  { codeType: 'SMCS', code: '346030', name: '서울시 조경포장', no: 5 },
];
const 공통분야 = [{ key: 'general', label: '공통·융합', standard_prefixes: ['10'], score: 0 }];

test('제목에 검색어가 없으면 분야 가산점이 있어도 결과로 통과시키지 않는다', () => {
  const r = rankStandards(기준목록, ['경계석'], 공통분야, {});
  assert.equal(r.length, 0, '무관한 공통기준이 결과로 나오면 안 된다');
});

test('제목이 일치하는 기준은 정상 반환된다', () => {
  const r = rankStandards(기준목록, ['포장경계'], 공통분야, {});
  assert.equal(r.length, 1);
  assert.equal(r[0].item.code, '346025');
});

test('분야 가산점은 통과 자격이 아니라 순위 조정에만 쓰인다', () => {
  const 조경분야 = [{ key: 'landscape', label: '조경·생태', standard_prefixes: ['34'], score: 4 }];
  const r = rankStandards(기준목록, ['포장'], 조경분야, {});
  const codes = r.map((x) => x.item.code);
  assert.ok(codes.includes('346025') && codes.includes('346010'), '포장이 제목에 있는 기준은 모두 포함');
  assert.ok(codes.indexOf('346010') < codes.indexOf('100000') || !codes.includes('100000'));
});

test('기관·지자체 기준은 기본적으로 제외된다', () => {
  const r = rankStandards(기준목록, ['조경포장'], 공통분야, {});
  assert.ok(!r.some((x) => x.item.codeType === 'SMCS'), 'SMCS는 기본 제외');
  const withLocal = rankStandards(기준목록, ['조경포장'], 공통분야, { includeLocalStandards: true });
  assert.ok(withLocal.some((x) => x.item.codeType === 'SMCS'), 'opt-in 시 포함');
});

test('분야를 명시하면 다른 분야 기준은 제목이 맞아도 제외된다', () => {
  // '연못 방수'에 landscape를 지정했는데 터널·하천 '방수' 기준이 상위로 나오던 문제.
  const 목록 = [
    { codeType: 'KDS', code: '275005', name: '터널 배수 및 방수', no: 1 },
    { codeType: 'KDS', code: '515050', name: '지하방수로', no: 2 },
    { codeType: 'KDS', code: '345035', name: '수경시설', no: 3 },
  ];
  const 조경 = [{ key: 'landscape', label: '조경·생태', standard_prefixes: ['34'], score: 100 }];
  const r = rankStandards(목록, ['연못', '방수'], 조경, { restrictPrefixes: ['34'] });
  assert.equal(r.length, 0, '조경 계열에 제목 일치가 없으면 타 분야를 끌어오지 않는다');

  const 미지정 = rankStandards(목록, ['연못', '방수'], 조경, {});
  assert.ok(미지정.length >= 2, '분야 한정이 없으면 종전대로 동작');
});

test('검색어의 띄어쓰기 차이를 무시하고 센다', () => {
  // 기준 원문은 '투수성 포장'(10회), 실무 검색어는 '투수성포장'. 띄어쓰기 때문에
  // 정작 맞는 기준(KDS 34 60 10 보도포장)을 놓치던 문제.
  assert.equal(countFlexible('투수성 포장을 적용한다', '투수성포장'), 1);
  assert.equal(countFlexible('투수성포장을 적용한다', '투수성 포장'), 1);
  assert.equal(countFlexible('투수성  포장 및 투수성포장', '투수성포장'), 2);
  assert.equal(countFlexible('아스팔트 포장', '투수성포장'), 0);
});

test('띄어쓰기 무시 매칭이 제목 검색에도 적용된다', () => {
  const 목록 = [{ codeType: 'KDS', code: '445000', name: '도로 포장 설계', no: 1 }];
  const r = rankStandards(목록, ['도로포장'], [], {});
  assert.equal(r.length, 1, "'도로포장'이 '도로 포장 설계'를 찾아야 한다");
});

test('정규식 특수문자가 든 검색어도 안전하게 처리된다', () => {
  assert.equal(countFlexible('백호0.4 굴착', '백호0.4'), 1);
  assert.equal(countFlexible('백호0X4 굴착', '백호0.4'), 0, '.이 임의문자로 해석되면 안 된다');
});

test('실무 용어를 기준 원문 용어로 확장한다', () => {
  // 기준 원문은 '퍼걸러'(50회)를 쓰는데 실무는 '파고라'(11회)로 부른다.
  const r = expandSearchTerms(['파고라']);
  assert.ok(r.includes('파고라') && r.includes('퍼걸러'), '동의어가 함께 검색되어야 한다');
});

test('동의어가 없는 검색어는 그대로 둔다', () => {
  assert.deepEqual(expandSearchTerms(['분수']), ['분수']);
});

test('동의어 확장은 중복 없이 이루어진다', () => {
  const r = expandSearchTerms(['경계석', '연석']);
  assert.equal(new Set(r).size, r.length, '중복 항목이 없어야 한다');
});


// ── 기준 목록(/CodeList) 디스크 캐시 ────────────────────────────
// 본문 1,334건은 디스크에 캐시하면서 목록은 메모리(1시간)뿐이었다. KCSC API가
// 불통이면 본문 캐시가 멀쩡해도 목록을 못 받아 검색 전체가 불능이 됐다.

test('기준 목록 디스크 캐시를 기록하고 다시 읽는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kemcp-codelist-'));
  const path = join(dir, 'code-list.json');
  const 목록 = [{ codeType: 'KDS', code: '346010', name: '보도포장', no: 1 }];
  assert.equal(writeCodeListDiskCache(목록, path), true);
  const cached = readCodeListDiskCache(path);
  assert.ok(cached, '기록한 캐시를 읽을 수 있어야 한다');
  assert.deepEqual(cached.list, 목록);
  assert.ok(cached.fetchedAt > 0, '수집 시각이 함께 저장되어야 한다');
});

test('손상되거나 빈 목록 캐시는 없는 것으로 취급한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kemcp-codelist-bad-'));
  const path = join(dir, 'code-list.json');
  writeFileSync(path, '{깨진 JSON', 'utf8');
  assert.equal(readCodeListDiskCache(path), null, '손상 파일은 null');
  writeFileSync(path, JSON.stringify({ fetched_at: 1, list: [] }), 'utf8');
  assert.equal(readCodeListDiskCache(path), null, '빈 목록은 폴백 가치가 없으므로 null');
  assert.equal(readCodeListDiskCache(join(dir, '없는파일.json')), null);
});
