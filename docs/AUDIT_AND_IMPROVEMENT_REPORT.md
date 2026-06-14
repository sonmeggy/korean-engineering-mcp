# korean-engineering-mcp 점검 및 개선 보고서

## 점검 요약

- 레포: `sonmeggy/korean-engineering-mcp`
- 기존 상태: 단일 `index.js` 기반 MCP 서버, README/package 구성, 테스트/CI 없음
- 기존 장점: KCSC, 법제처, 로컬 설계기준 해설편 검색 기능 보유
- 주요 한계: 근거 나열 중심, citation 구조 부족, 직원별 다양한 클라이언트 설치 안내 부족, 하드코딩된 법제처 기본값, 테스트 부재

## 이번 개선 방향

1. 회사 직원들이 Claude, OpenClaw, Hermes, Antigravity, VS Code 계열 도구에서 공통으로 쓸 수 있도록 MCP 표준 JSON과 도구별 설치 안내를 추가한다.
2. 모델 토큰 사용량을 줄이기 위해 compact evidence pack 도구를 추가한다.
3. MCP와 Skill을 함께 배포해 검색 계층과 답변정책 계층을 분리한다.
4. 법령/건설기준/설계기준 근거 우선, 정확한 근거 명기, 종합 판단 원칙을 Skill과 MCP tool description에 반영한다.

## 적용한 개선

- `grounded_engineering_research` 도구 추가
  - 법령, 행정규칙, 해석례, KDS/KCS, 설계기준 해설편을 한 번에 compact evidence pack으로 반환
  - `max_evidence`, `compact`, `include_local_standards` 옵션 제공
  - source hierarchy와 final answer format 포함
- `LAW_API_KEY` 하드코딩 기본값 제거
- API 키 누락 시 명확한 오류 반환
- 설계기준 해설편 검색의 정규식 특수문자 처리 보강
- `skills/korean-engineering-grounded-answer/SKILL.md` 추가
- `docs/INSTALLATION.md` 추가
- `install/install-hermes.sh` 추가
- `.env.example`, `LICENSE`, package metadata, check/test scripts 추가

## 2차 개선 추가 적용

- `get_law_detail` 추가: `search_laws` 결과의 MST로 법령 상세를 조회하고 조문 단위 인용문을 compact JSON으로 반환
- `get_admin_rule_detail` 추가: 행정규칙 일련번호로 조문/별표 단위 근거를 compact JSON으로 반환
- `grounded_engineering_research`가 상위 법령/행정규칙 후보의 상세 조문·별표 근거를 함께 담도록 개선
- `AGENT_INSTALL.md` 추가: 직원이 AI 도구에 GitHub URL과 “설치해줘”만 전달해도 에이전트가 따라갈 설치 절차 제공
- `install/setup-interactive.sh` 추가: client type, API key, optional reference path를 대화형으로 입력받아 설치 안내/등록 수행
- `.github/workflows/ci.yml` 추가: Node 20/22에서 check/test/audit 실행

## 남은 권장 작업

- KCSC 상세 본문 인용 정확도 개선: 절 번호, 항 번호, 원문 링크의 안정성 강화 필요
- 법제처 조문 상세 조회의 다양한 법령 구조 fixture 추가
- mock 기반 테스트 추가: 외부 API 없이 CI에서 파싱/스키마 검증 확대
- npm 배포 여부 결정: npm 배포 전까지는 `github:sonmeggy/korean-engineering-mcp` 설치 방식을 공식 경로로 유지
