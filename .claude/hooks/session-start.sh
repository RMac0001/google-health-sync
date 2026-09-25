#!/bin/bash
# Installs dependencies so lint, typecheck, tests and build work in
# Claude Code on the web sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
npm install --no-audit --no-fund
