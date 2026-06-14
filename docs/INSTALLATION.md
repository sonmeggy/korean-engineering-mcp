# Cross-client installation guide

This project is designed as a two-layer package:

- **MCP server**: retrieves Korean laws, KDS/KCS, administrative rules, interpretations, and optional local design-standard commentaries.
- **Skill / instruction package**: forces evidence-first, citation-first, synthesis-based answers.

Use both layers when your client supports them. If a client supports MCP but not skills, install the MCP and copy the skill text into that client's custom instructions/project instructions.

## Compatibility target

- Claude Code / Claude Desktop: MCP supported. Skills/instructions can be copied to the user's skill or project-instruction location depending on the product version.
- OpenClaw / Hermes: MCP supported through each agent's MCP configuration. Hermes can install the included skill folder under `~/.hermes/skills/`.
- Antigravity: MCP-compatible configuration is expected; skills may be installed under the Antigravity/Gemini skill directory when available, or copied as project instructions.
- VS Code / GitHub Copilot / Cline / Cursor-style tools: use MCP if the extension supports MCP. If no formal skill mechanism exists, copy `skills/korean-engineering-grounded-answer/SKILL.md` into workspace instructions such as `.github/copilot-instructions.md` or the extension's rule/instruction file.


## URL-only install request for employees

Employees can give the repository URL to their AI tool and say only:

```text
https://github.com/sonmeggy/korean-engineering-mcp 설치해줘
```

The installing agent should read `AGENT_INSTALL.md`, clone the repository, run `./install/setup-interactive.sh` when shell access is available, and ask the employee for:

- `KCSC_API_KEY`
- `LAW_API_KEY`
- optional `REFERENCE_DIR`

The installer must not echo the key values back to chat.

## Minimal MCP command

```bash
npx -y github:sonmeggy/korean-engineering-mcp
```

Required environment variables:

```bash
KCSC_API_KEY=...
LAW_API_KEY=...
# optional
REFERENCE_DIR=/absolute/path/to/reference/manuals
```

## Claude Code example

```bash
claude mcp add korean-engineering-mcp \
  -e KCSC_API_KEY="$KCSC_API_KEY" \
  -e LAW_API_KEY="$LAW_API_KEY" \
  -e REFERENCE_DIR="$REFERENCE_DIR" \
  -- npx -y github:sonmeggy/korean-engineering-mcp
```

## Generic MCP JSON

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

## Skill installers

From a local clone, install the skill/instruction package for common clients:

```bash
./install/install-skill.sh hermes
./install/install-skill.sh claude
./install/install-skill.sh antigravity
./install/install-skill.sh vscode
```

`vscode` mode is conservative: it only creates `.github/copilot-instructions.md` when that file does not already exist.

## Hermes combined install

From a local clone:

```bash
./install/install-hermes.sh
```

The script copies the skill to `~/.hermes/skills/korean-engineering-grounded-answer/` and prints the MCP command/config snippet. It does not copy real API keys.

## Token minimization guidance for employees

- Use `grounded_engineering_research` first with `max_evidence` 5–8.
- Fetch full details only for the top 1–3 standards or laws.
- Prefer compact citations and final synthesis over raw source dumps.
- If the first query is weak, retry with better Korean keywords rather than asking the model to infer.
- Keep local design-manual Markdown files in `REFERENCE_DIR` so the MCP can search them directly instead of sending large PDFs to a model.

## Required answer behavior

The client should be instructed to:

1. Search first.
2. Cite exact source metadata.
3. Distinguish direct from indirect evidence.
4. Synthesize a conclusion from the evidence.
5. Say `근거 불충분` when evidence is missing.
