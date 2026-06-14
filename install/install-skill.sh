#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_SRC="$ROOT_DIR/skills/korean-engineering-grounded-answer"
TARGET="${1:-hermes}"

copy_skill_dir() {
  local dst="$1"
  mkdir -p "$(dirname "$dst")"
  rm -rf "$dst"
  cp -R "$SKILL_SRC" "$dst"
  echo "installed: $dst"
}

install_project_instruction() {
  local dst="$1"
  mkdir -p "$(dirname "$dst")"
  if [ -f "$dst" ]; then
    echo "skip existing: $dst"
    echo "  Copy skills/korean-engineering-grounded-answer/SKILL.md into it manually if desired."
  else
    cp "$SKILL_SRC/SKILL.md" "$dst"
    echo "installed: $dst"
  fi
}

case "$TARGET" in
  hermes)
    copy_skill_dir "${HERMES_HOME:-$HOME/.hermes}/skills/korean-engineering-grounded-answer"
    ;;
  claude)
    copy_skill_dir "$HOME/.claude/skills/korean-engineering-grounded-answer"
    ;;
  antigravity)
    copy_skill_dir "$HOME/.gemini/antigravity/skills/korean-engineering-grounded-answer"
    ;;
  vscode)
    install_project_instruction "$PWD/.github/copilot-instructions.md"
    ;;
  all)
    copy_skill_dir "${HERMES_HOME:-$HOME/.hermes}/skills/korean-engineering-grounded-answer"
    copy_skill_dir "$HOME/.claude/skills/korean-engineering-grounded-answer"
    copy_skill_dir "$HOME/.gemini/antigravity/skills/korean-engineering-grounded-answer"
    ;;
  *)
    echo "Usage: $0 [hermes|claude|antigravity|vscode|all]" >&2
    exit 2
    ;;
esac

cat <<'MSG'

Skill installed. Also configure the MCP server in your client:
  command: npx
  args: -y github:sonmeggy/korean-engineering-mcp
  env: KCSC_API_KEY, LAW_API_KEY, optional REFERENCE_DIR
MSG
