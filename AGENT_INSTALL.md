# Agent install instructions

When a user gives this GitHub repository URL and says only “설치해줘”, “install this”, or similar, follow this procedure.

Repository URL:

- `https://github.com/sonmeggy/korean-engineering-mcp`

## Goal

Install both layers:

1. MCP server registration for the user's AI tool.
2. The bundled skill/instruction file so answers are evidence-first, citation-first, and synthesis-based.

## Do not ask the user to read the whole README first

Proceed with the safest default for the detected client. Ask only for required local secrets/paths:

- `KCSC_API_KEY` — 국가건설기준센터 OpenAPI key
- `LAW_API_KEY` — 법제처 OpenAPI OC key
- `REFERENCE_DIR` — optional local folder containing design-standard commentary Markdown files

Never print the actual key values back to the user.

## Recommended automated path

Clone the repo to a temporary or tools directory and run:

```bash
./install/setup-interactive.sh
```

The script prompts for:

- client type: `claude`, `hermes`, `openclaw`, `antigravity`, `vscode`, or `generic`
- API keys
- optional reference directory

It then writes a local `.korean-engineering-mcp.env` file with `0600` permissions and prints the MCP configuration snippet or runs the supported registration command when safe.

## Manual fallback

If scripts cannot be executed, register this MCP command in the client:

```bash
npx -y github:sonmeggy/korean-engineering-mcp
```

with environment variables:

```bash
KCSC_API_KEY=<user supplied value>
LAW_API_KEY=<user supplied value>
REFERENCE_DIR=<optional absolute path>
```

Then install or copy the skill:

- Hermes: copy `skills/korean-engineering-grounded-answer/` to `~/.hermes/skills/korean-engineering-grounded-answer/`
- Claude: copy it to `~/.claude/skills/korean-engineering-grounded-answer/` when skills are supported; otherwise copy `SKILL.md` to project/user instructions.
- Antigravity: copy it to `~/.gemini/antigravity/skills/korean-engineering-grounded-answer/` when supported; otherwise copy `SKILL.md` to project instructions.
- VS Code/Copilot/Cline/Cursor: if the tool has no skill mechanism, copy `SKILL.md` content into workspace instruction/rule files such as `.github/copilot-instructions.md`.

## Verification prompt after install

After installation, verify the client can see the MCP tools and tell the user:

- MCP registered: yes/no
- Skill/instruction installed: yes/no or manual-copy needed
- Required keys configured: yes/no, without showing values
- Reference directory configured: path exists or optional/not configured
- Suggested smoke test: ask “하수도 기술진단 주기와 근거를 찾아서 답해줘”

## Answer behavior to remind the user

Tell the user that this package is designed to call `grounded_engineering_research` before final answers and to answer with:

- 결론
- 쟁점
- 확인 근거
- 종합 판단
- 실무 적용
- 한계/추가 확인 필요사항
