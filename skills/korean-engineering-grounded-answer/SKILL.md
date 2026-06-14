---
name: korean-engineering-grounded-answer
description: "한국 법령·건설기준·설계기준 근거 기반 엔지니어링 답변 절차. korean-engineering-mcp와 함께 사용해 할루시네이션을 줄이고 정확한 근거와 종합 판단을 강제한다."
version: 1.0.0
author: sonmeggy / Lumi
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [korean-engineering, law, KDS, KCS, MCP, citation, grounded-answer]
---

# Korean Engineering Grounded Answer

Use this skill for Korean civil/environmental/water/wastewater engineering questions that require legal, design-standard, construction-standard, procurement, or technical-grounding judgment.

## Mandatory rule

Do **not** answer from general knowledge alone. Before giving a substantive answer, gather evidence using the companion MCP server whenever available:

1. `grounded_engineering_research` first.
2. If evidence is weak, retry with narrower or broader Korean keywords.
3. Use `get_standard_detail`, `search_laws`, `search_admin_rules`, `search_interpretations`, or `search_design_manual` to fill missing citation details.
4. If MCP is unavailable, use official web search or local reference documents before answering.
5. If direct evidence is still unavailable, say `직접 근거 미확인` or `근거 불충분`; do not make a definitive claim.

## Source hierarchy

Apply this priority order when sources conflict:

1. 법률·시행령·시행규칙
2. 행정규칙·고시·지침·예규
3. KDS 설계기준
4. KCS 표준시방서
5. 상수도/하수도 설계기준 해설편 and official manuals
6. 발주처 지침, 입찰안내서, PQ/SOQ/TP instructions
7. 기관·지자체 기준 such as SMCS/LHCS/KWCS, when applicable
8. 실무 관행 or expert recommendation

## Anti-hallucination policy

- Every legal/technical conclusion must be tied to a cited source.
- Separate direct sources from indirect/supporting sources.
- Do not treat a search-result title as a full legal basis; use it only as a pointer until the article/section text is checked.
- If only a general search result is available, mark the conclusion as provisional.
- Never invent article numbers, KDS/KCS section numbers, dates, or quotes.
- If the evidence pack says `insufficient`, answer with limits and next verification steps rather than a final assertion.

## Token-minimizing workflow

1. Ask the MCP for compact evidence first: `max_evidence` 5–8.
2. Only fetch full standard details for the 1–3 most relevant candidates.
3. Quote only the controlling sentence or paragraph, not whole documents.
4. Put raw source lists at the end or omit irrelevant hits.
5. Prefer a concise conclusion plus cited reasoning over long background explanation.

## Required answer format

Use this structure unless the user requests another format:

```markdown
## 결론
- 가능/불가/조건부/위험/근거불충분 중 하나로 판단한다.
- 판단 강도: 확정 / 잠정 / 추가확인 필요

## 쟁점
- 질문을 법적 요건, 설계기준 요건, 실무 적용 요건으로 분해한다.

## 확인 근거
- [법령] 법령명 제○조 제○항, 시행일, 핵심 문구
- [행정규칙/고시] 문서명, 조항/절, 발령기관·일자, 핵심 문구
- [건설기준] KDS/KCS 코드, 기준명, 장/절/항, 개정일, 핵심 문구
- [설계기준/해설편] 문서명, 장/절, 핵심 문구

## 종합 판단
- 각 근거의 효력과 질문 적용성을 연결해 판단한다.
- 근거자료 나열로 끝내지 말고, 왜 그 결론이 되는지 설명한다.

## 실무 적용
- 설계/검토/입찰/보고서에 어떻게 반영할지 쓴다.

## 한계 및 추가 확인
- 직접 근거 미확인 사항, 현장조건, 발주처 특기시방, 최신 개정 여부를 적는다.
```

## Ready-made wording

When evidence is not enough:

> 현재 확인된 법령·건설기준만으로는 해당 사항을 단정할 직접 근거가 부족합니다. 다만 확인된 ○○ 기준은 △△까지를 요구/권고하므로, 본 사안에는 □□ 조건을 추가 확인한 뒤 적용 여부를 판단하는 것이 안전합니다.

When evidence is sufficient:

> 확인된 상위 근거는 ○○이고, KDS/KCS 및 설계기준 해설편은 이를 기술적으로 구체화합니다. 따라서 본 사안은 단순 관행이 아니라 ○○ 근거에 의해 △△로 판단하는 것이 타당합니다.
