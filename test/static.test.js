import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const skill = readFileSync(new URL('../skills/korean-engineering-grounded-answer/SKILL.md', import.meta.url), 'utf8');

test('does not ship a hard-coded LAW API key fallback', () => {
  assert.doesNotMatch(index, /dohwa3547/);
  assert.match(index, /const LAW_KEY\s*=\s*process\.env\.LAW_API_KEY\s*\|\|\s*""/);
});

test('provides grounded research tool and answer policy', () => {
  assert.match(index, /grounded_engineering_research/);
  assert.match(index, /evidence_status/);
  assert.match(index, /source_hierarchy/);
  assert.match(index, /근거 불충분|직접 근거 미확인/);
});

test('skill enforces evidence-first and citation-first answers', () => {
  assert.match(skill, /Do \*\*not\*\* answer from general knowledge alone/);
  assert.match(skill, /Source hierarchy/);
  assert.match(skill, /Required answer format/);
  assert.match(skill, /근거 불충분/);
});

test('README documents MCP plus skill installation', () => {
  assert.match(readme, /MCP server/);
  assert.match(readme, /Skill package/);
  assert.match(readme, /docs\/INSTALLATION\.md/);
});
