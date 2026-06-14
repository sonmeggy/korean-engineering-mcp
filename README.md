# korean-engineering-mcp

한국 **건설기준(KDS/KCS)**, **법제처 법령**, **행정규칙·해석례**, 선택적 **상·하수도 설계기준 해설편**을 검색해 엔지니어링 답변용 근거 패키지를 생성하는 MCP 서버입니다.

이 레포는 Claude, OpenClaw, Hermes, Antigravity, VS Code 계열 AI 도구 등 다양한 클라이언트에서 함께 쓰는 것을 고려합니다..


## AI 도구에 URL만 주고 설치하기

Claude/OpenClaw/Hermes/Antigravity/VS Code 계열 AI 도구에 아래처럼 말하면 됩니다.

```text
https://github.com/sonmeggy/korean-engineering-mcp 설치해줘
```

이 레포에는 AI 에이전트용 설치 지침 `AGENT_INSTALL.md`와 대화형 설치 스크립트 `install/setup-interactive.sh`가 포함되어 있습니다. 설치 과정에서 도구가 다음 값을 입력하도록 안내합니다.

- `KCSC_API_KEY` — 국가건설기준센터 OpenAPI key
- `LAW_API_KEY` — 법제처 OpenAPI OC key
- `REFERENCE_DIR` — 선택사항, 상수도/하수도 설계기준 해설편 Markdown 파일 경로

로컬 clone 후 직접 실행할 때는 다음을 사용합니다.

```bash
./install/setup-interactive.sh
```

## 핵심 설계

- **MCP server**: 법령/기준/해설편을 검색하고 근거를 구조화합니다.
- **Skill package**: `skills/korean-engineering-grounded-answer`가 답변 정책을 강제합니다.
- **Token-minimizing default**: `grounded_engineering_research`는 짧은 인용문과 제한된 근거 수를 기본으로 반환합니다.
- **Anti-hallucination**: 근거가 부족하면 단정하지 않고 `근거 불충분` 또는 `직접 근거 미확인`으로 답변하도록 유도합니다.

## 제공 도구

- `grounded_engineering_research` — 답변 전 우선 사용할 근거 패키지 생성 도구
- `search_standards` — KDS/KCS 등 건설기준 키워드 검색
- `get_standard_detail` — 특정 KDS/KCS 기준 본문 조회
- `list_standard_categories` — 분야별 기준 목록
- `search_laws` — 법률·시행령·시행규칙 검색
- `search_interpretations` — 법령 해석례 검색
- `search_admin_rules` — 고시·예규·훈령·지침 검색
- `comprehensive_research` — 법령 + 건설기준 동시 검색
- `search_design_manual` — 로컬 설계기준 해설편 키워드 검색. `REFERENCE_DIR`에 파일이 있을 때만 등록됩니다.

## 사전 준비

API 키는 환경변수로만 주입하세요. 공개 레포나 공유 채팅에 실제 키를 넣지 마세요.

- KCSC API 키: https://www.kcsc.re.kr
- 법제처 OC 인증키: https://open.law.go.kr

```bash
cp .env.example .env
# .env에 KCSC_API_KEY, LAW_API_KEY를 입력
```

## 설치 개요

자세한 도구별 설치법은 [docs/INSTALLATION.md](docs/INSTALLATION.md)를 보세요.

### Generic MCP JSON

```json
{
  "mcpServers": {
    "korean-engineering-mcp": {
      "command": "npx",
      "args": ["-y", "github:sonmeggy/korean-engineering-mcp"],
      "env": {
        "KCSC_API_KEY": "${KCSC_API_KEY}",
        "LAW_API_KEY": "${LAW_API_KEY}",
        "REFERENCE_DIR": "${REFERENCE_DIR}"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add korean-engineering-mcp \
  -e KCSC_API_KEY=*** \
  -e LAW_API_KEY=*** \
  -e REFERENCE_DIR="$REFERENCE_DIR" \
  -- npx -y github:sonmeggy/korean-engineering-mcp
```

### Hermes skill + MCP

```bash
./install/install-hermes.sh
```

그 뒤 MCP 서버를 Hermes MCP 설정에 추가하세요. Hermes 외 도구는 `skills/korean-engineering-grounded-answer/SKILL.md` 내용을 해당 도구의 skill/rule/instruction 위치에 복사하면 됩니다.

## 답변 정책

직원들이 사용하는 모델의 토큰 사용량과 할루시네이션을 줄이기 위해 다음 원칙을 권장합니다.

1. 최종 답변 전 `grounded_engineering_research`를 먼저 호출합니다.
2. 기본 `max_evidence`는 5~8로 유지합니다.
3. 상세 본문은 상위 1~3개 후보만 추가 조회합니다.
4. 최종 답변은 근거 나열이 아니라 `결론 → 근거 → 종합 판단 → 실무 적용 → 한계` 순서로 작성합니다.
5. 근거가 부족하면 단정하지 않고 `근거 불충분`으로 표시합니다.

## 개발

```bash
npm install
npm run check
npm test
```

## 보안

- 실제 API 키를 커밋하지 마세요.
- `.env.example`만 공유하세요.
- 법령/기준 검색 결과는 답변 근거 후보이며, 중요한 실무 판단 전에는 원문 조문/절을 확인하세요.

## License

MIT
