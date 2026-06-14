#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
SKILL_SRC="$ROOT_DIR/skills/korean-engineering-grounded-answer"
SKILL_DST="$HERMES_HOME/skills/korean-engineering-grounded-answer"

mkdir -p "$(dirname "$SKILL_DST")"
rm -rf "$SKILL_DST"
cp -R "$SKILL_SRC" "$SKILL_DST"

cat <<'MSG'
✅ korean-engineering-grounded-answer skill installed for Hermes.

Next, add the MCP server to your MCP-capable client.
Do not paste real API keys into shared chat. Set them as environment variables or client-side secrets.

Generic MCP command:
  npx -y github:sonmeggy/korean-engineering-mcp

Required env:
  KCSC_API_KEY
  LAW_API_KEY

Optional env:
  REFERENCE_DIR=/absolute/path/to/reference/manuals

Claude Code example:
  claude mcp add korean-engineering-mcp \
    -e KCSC_API_KEY="$KCSC_API_KEY" \
    -e LAW_API_KEY="$LAW_API_KEY" \
    -e REFERENCE_DIR="$REFERENCE_DIR" \
    -- npx -y github:sonmeggy/korean-engineering-mcp
MSG
