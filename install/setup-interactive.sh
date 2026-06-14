#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_OUT="${KOREAN_ENGINEERING_MCP_ENV:-$HOME/.korean-engineering-mcp.env}"
REPO_SPEC="github:sonmeggy/korean-engineering-mcp"

printf 'Korean Engineering MCP + Skill installer\n'
printf '=========================================\n\n'

printf 'Client type [claude/hermes/openclaw/antigravity/vscode/generic] (default: generic): '
read -r CLIENT
CLIENT="${CLIENT:-generic}"

if [ -z "${KCSC_API_KEY:-}" ]; then
  printf 'KCSC_API_KEY 입력: '
  read -rs KCSC_API_KEY
  printf '\n'
fi
if [ -z "${LAW_API_KEY:-}" ]; then
  printf 'LAW_API_KEY 입력: '
  read -rs LAW_API_KEY
  printf '\n'
fi
if [ -z "${REFERENCE_DIR:-}" ]; then
  printf 'REFERENCE_DIR 입력(선택, 없으면 Enter): '
  read -r REFERENCE_DIR || true
fi

if [ -z "${KCSC_API_KEY:-}" ] || [ -z "${LAW_API_KEY:-}" ]; then
  echo 'ERROR: KCSC_API_KEY와 LAW_API_KEY는 필수입니다.' >&2
  exit 1
fi

umask 077
{
  printf 'KCSC_API_KEY=%q\n' "$KCSC_API_KEY"
  printf 'LAW_API_KEY=%q\n' "$LAW_API_KEY"
  if [ -n "${REFERENCE_DIR:-}" ]; then
    printf 'REFERENCE_DIR=%q\n' "$REFERENCE_DIR"
  fi
} > "$ENV_OUT"
chmod 600 "$ENV_OUT"

install_skill() {
  local target="$1"
  "$ROOT_DIR/install/install-skill.sh" "$target"
}

case "$CLIENT" in
  claude)
    install_skill claude || true
    if command -v claude >/dev/null 2>&1; then
      echo 'Claude Code MCP 등록을 시도합니다.'
      if [ -n "${REFERENCE_DIR:-}" ]; then
        claude mcp add korean-engineering-mcp \
          -e KCSC_API_KEY="$KCSC_API_KEY" \
          -e LAW_API_KEY="$LAW_API_KEY" \
          -e REFERENCE_DIR="$REFERENCE_DIR" \
          -- npx -y "$REPO_SPEC"
      else
        claude mcp add korean-engineering-mcp \
          -e KCSC_API_KEY="$KCSC_API_KEY" \
          -e LAW_API_KEY="$LAW_API_KEY" \
          -- npx -y "$REPO_SPEC"
      fi
    else
      echo 'claude 명령을 찾지 못했습니다. 아래 Generic MCP JSON을 사용하세요.'
    fi
    ;;
  hermes)
    install_skill hermes || true
    echo 'Hermes MCP 설정은 사용 중인 Hermes 버전에 맞춰 아래 Generic MCP JSON 또는 hermes mcp add 명령으로 등록하세요.'
    ;;
  openclaw)
    echo 'OpenClaw는 사용 중인 MCP 설정 파일/명령이 배포판별로 다를 수 있습니다. 아래 Generic MCP JSON을 등록하세요.'
    ;;
  antigravity)
    install_skill antigravity || true
    echo 'Antigravity MCP 설정에 아래 Generic MCP JSON을 등록하세요.'
    ;;
  vscode)
    install_skill vscode || true
    echo 'VS Code 계열 확장(Copilot/Cline/Cursor 등)의 MCP 설정에 아래 Generic MCP JSON을 등록하세요.'
    ;;
  generic)
    echo 'Generic client mode: 아래 MCP JSON을 사용하세요.'
    ;;
  *)
    echo "알 수 없는 client type: $CLIENT" >&2
    exit 2
    ;;
esac

cat <<EOF

설정 파일이 생성되었습니다: $ENV_OUT
- API 키 값은 화면에 다시 표시하지 않습니다.
- REFERENCE_DIR은 선택사항입니다. 상수도/하수도 설계기준 해설편 Markdown 파일이 있으면 지정하세요.

Generic MCP JSON:
{
  "mcpServers": {
    "korean-engineering-mcp": {
      "command": "npx",
      "args": ["-y", "$REPO_SPEC"],
      "env": {
        "KCSC_API_KEY": "<입력한 KCSC_API_KEY>",
        "LAW_API_KEY": "<입력한 LAW_API_KEY>",
        "REFERENCE_DIR": "${REFERENCE_DIR:-}"
      }
    }
  }
}

설치 후 확인 질문 예시:
  하수도 기술진단 주기와 근거를 찾아서 답해줘
EOF
