# korean-engineering-mcp

한국 **건설기준(KDS/KCS)**과 **법제처 법령**을 통합 검색하여 엔지니어링 질문에 법적·기술적 근거를 종합 제공하는 MCP 서버입니다.

## 제공 도구 (7개)

| 분류 | 도구명 | 설명 |
|------|--------|------|
| 건설기준 | `search_standards` | KDS/KCS 키워드 검색 |
| 건설기준 | `get_standard_detail` | 특정 기준 본문 조회 |
| 건설기준 | `list_standard_categories` | 분야별 기준 목록 |
| 법령 | `search_laws` | 법률·시행령·시행규칙 검색 |
| 법령 | `search_interpretations` | 법령 해석례 검색 |
| 법령 | `search_admin_rules` | 고시·예규·훈령·지침 검색 |
| **통합** | **`comprehensive_research`** | **법령 + 건설기준 동시 검색** |

---

## 사전 준비: API 키 발급

### 1. KCSC API 키 (국가건설기준센터)

1. [https://www.kcsc.re.kr](https://www.kcsc.re.kr) 접속
2. 회원가입 후 **OpenAPI** 메뉴에서 API 키 신청
3. 발급된 키를 `KCSC_API_KEY`로 사용

### 2. 법제처 API 키 (OC 인증키)

1. [https://open.law.go.kr](https://open.law.go.kr) 접속
2. 회원가입 후 **오픈API** → **인증키 신청**
3. 발급된 OC 값을 `LAW_API_KEY`로 사용

---

## 설치 방법

### Claude Code (CLI)

```bash
claude mcp add korean-engineering-mcp \
  -e KCSC_API_KEY=여기에_KCSC_키_입력 \
  -e LAW_API_KEY=여기에_법제처_키_입력 \
  -- npx -y korean-engineering-mcp
```

재시작 없이 현재 세션에 즉시 추가됩니다.

### Claude Desktop

`claude_desktop_config.json` 파일에 아래 내용 추가:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "korean-engineering-mcp": {
      "command": "npx",
      "args": ["-y", "korean-engineering-mcp"],
      "env": {
        "KCSC_API_KEY": "여기에_KCSC_키_입력",
        "LAW_API_KEY": "여기에_법제처_키_입력"
      }
    }
  }
}
```

### 기타 MCP 호환 클라이언트

동일한 설정 형식을 사용합니다:
- **command**: `npx`
- **args**: `["-y", "korean-engineering-mcp"]`
- **env**: 위 두 API 키 설정

---

## 사용 예시

```
comprehensive_research("배수지 산지 진출입로 경사 기준")
→ KDS 442010, 도로의 구조·시설 기준에 관한 규칙 제25조 등 동시 검색

comprehensive_research("하수도 기술진단 자격")
→ 하수도법 시행령, 관련 해석례, KDS 기준 동시 검색
```

---

## Node.js 요구사항

Node.js 18 이상

---

## 참고 및 감사

법제처 API 연동 방식은 아래 프로젝트를 참고했습니다.

- [korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp) by [@chrisryugj](https://github.com/chrisryugj) — 법제처 Open API 기반 한국 법령 검색 MCP 서버
