#!/usr/bin/env bash

# Udemy Boost macOS installer.
# Installs project tooling, Miniconda/LibreTranslate, then runs verification.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$(cd "$ROOT/.." && pwd)/anki-mcp-server"
CONDA_ENV="libretranslate"
CONDA_ENVS_DIR="${CONDA_ENVS_PATH:-$HOME/.conda/envs}"
SKIP_LIBRE=0
SKIP_TESTS=0
DRY_RUN=0
START_INBOX=0
EXTENSION_ORIGIN=''
FAILURES=0

usage() {
  printf '%s\n' \
    'Usage: ./scripts/install.sh [options]' \
    '' \
    'Options:' \
    '  --server-dir PATH   anki-mcp-server directory (default: ../anki-mcp-server)' \
    '  --conda-env NAME    Conda environment name (default: libretranslate)' \
    '  --skip-libre        Skip Miniconda and LibreTranslate installation' \
    '  --skip-tests        Skip Playwright installation and all tests' \
    '  --start-inbox       Start the local Inbox service for this login session' \
    '  --extension-origin chrome-extension://<id>  Required with --start-inbox' \
    '  --dry-run           Print actions without changing anything' \
    '  -h, --help          Show this help'
}

result() {
  local status="$1" name="$2" detail="${3:-}"
  printf '[%s] %s' "$status" "$name"
  if [[ -n "$detail" ]]; then printf ' — %s' "$detail"; fi
  printf '\n'
  if [[ "$status" == 'fail' ]]; then FAILURES=$((FAILURES + 1)); fi
}

run_step() {
  local name="$1" work_dir="$2"
  shift 2
  if ((DRY_RUN)); then
    result skip "$name" "DryRun: (cd $work_dir) $*"
    return 0
  fi
  if (cd "$work_dir" && "$@"); then
    result ok "$name" "(cd $work_dir) $*"
    return 0
  else
    local code=$?
    result fail "$name" "exit $code: (cd $work_dir) $*"
    return "$code"
  fi
}

find_conda() {
  if command -v conda >/dev/null 2>&1; then command -v conda; return 0; fi
  local candidate
  for candidate in \
    /opt/homebrew/Caskroom/miniconda/base/bin/conda \
    /usr/local/Caskroom/miniconda/base/bin/conda \
    "$HOME/miniconda3/bin/conda"; do
    if [[ -x "$candidate" ]]; then printf '%s\n' "$candidate"; return 0; fi
  done
  return 1
}

while (($#)); do
  case "$1" in
    --server-dir) [[ $# -ge 2 ]] || { usage; exit 2; }; SERVER_DIR="$2"; shift 2 ;;
    --conda-env) [[ $# -ge 2 ]] || { usage; exit 2; }; CONDA_ENV="$2"; shift 2 ;;
    --skip-libre) SKIP_LIBRE=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --start-inbox) START_INBOX=1; shift ;;
    --extension-origin) [[ $# -ge 2 ]] || { usage; exit 2; }; EXTENSION_ORIGIN="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

if ((START_INBOX)) && [[ ! "$EXTENSION_ORIGIN" =~ ^chrome-extension://[a-p]{32}$ ]]; then
  printf '%s\n' 'Use --start-inbox with the Extension Origin shown in the Udemy Boost popup.' >&2
  exit 2
fi

printf 'Udemy Boost macOS installer%s\n' "$([[ $DRY_RUN == 1 ]] && printf ' (DryRun)')"
printf '  udemy-boost     : %s\n' "$ROOT"
printf '  anki-mcp-server : %s\n' "$SERVER_DIR"
printf '  conda env       : %s\n\n' "$CONDA_ENV"

# 1. Prerequisites
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version)"
  if node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=11)?0:1)"; then
    result ok 'Node.js' "$NODE_VERSION"
  else
    result fail 'Node.js' "$NODE_VERSION; requires >= 20.11.0"
  fi
else
  result fail 'Node.js' 'not found; install Node LTS first'
fi

if command -v pnpm >/dev/null 2>&1; then result ok pnpm "$(pnpm --version)"; else result fail pnpm 'not found; run corepack enable pnpm'; fi
if command -v brew >/dev/null 2>&1; then result ok Homebrew "$(brew --prefix)"; else result fail Homebrew 'not found; install from https://brew.sh/'; fi
if [[ -d '/Applications/Google Chrome.app' ]]; then result ok Chrome '/Applications/Google Chrome.app'; else result warn Chrome 'not found'; fi
if [[ ! -f "$ROOT/manifest.json" ]]; then result fail 'udemy-boost path' "$ROOT has no manifest.json"; fi

if ((FAILURES)); then
  printf '\nPrerequisites are incomplete; stopping.\n'
  exit 1
fi

# 2. anki-mcp-server
if [[ -d "$SERVER_DIR" ]]; then
  run_step 'anki-mcp-server dependencies' "$SERVER_DIR" pnpm install --frozen-lockfile || \
    run_step 'anki-mcp-server dependencies (fallback)' "$SERVER_DIR" pnpm install
  run_step 'anki-mcp-server build' "$SERVER_DIR" pnpm run build || true
  if ((!DRY_RUN)); then
    [[ -f "$SERVER_DIR/dist/index.js" ]] && result ok 'anki-mcp-server dist/index.js' "$SERVER_DIR/dist/index.js" || result fail 'anki-mcp-server dist/index.js' 'build output not found'
  fi
else
  result warn 'anki-mcp-server' "$SERVER_DIR not found; skipping"
fi

# 3. Extension test dependencies
if ((SKIP_TESTS)); then
  result skip 'test dependencies' '--skip-tests'
else
  run_step 'pnpm install --frozen-lockfile' "$ROOT" pnpm install --frozen-lockfile || true
  run_step 'Playwright Chromium' "$ROOT" pnpm exec playwright install chromium || true
fi

# 4. Miniconda and LibreTranslate
if ((SKIP_LIBRE)); then
  result skip 'Miniconda / LibreTranslate' '--skip-libre'
else
  CONDA_BIN="$(find_conda || true)"
  if [[ -z "$CONDA_BIN" ]]; then
    if ((DRY_RUN)); then
      result skip Miniconda 'DryRun: brew install --cask miniconda'
      CONDA_BIN='conda'
    elif brew install --cask miniconda; then
      CONDA_BIN="$(find_conda || true)"
      [[ -n "$CONDA_BIN" ]] && result ok Miniconda "$CONDA_BIN" || result fail Miniconda 'installed but conda executable was not found'
    else
      result fail Miniconda 'brew install --cask miniconda failed'
    fi
  else
    result skip Miniconda "already installed: $CONDA_BIN"
  fi

  if [[ -n "$CONDA_BIN" ]]; then
    if ((DRY_RUN)); then
      result skip 'Conda env directory' "DryRun: mkdir -p $CONDA_ENVS_DIR"
    elif mkdir -p "$CONDA_ENVS_DIR"; then
      result ok 'Conda env directory' "$CONDA_ENVS_DIR"
    else
      result fail 'Conda env directory' "could not create $CONDA_ENVS_DIR"
    fi

    if ((!DRY_RUN)) && CONDA_ENVS_PATH="$CONDA_ENVS_DIR" "$CONDA_BIN" env list | awk '{print $1}' | grep -Fxq "$CONDA_ENV"; then
      result skip "conda env $CONDA_ENV" 'already exists'
    else
      if ((DRY_RUN)); then
        result skip "create conda env $CONDA_ENV" "DryRun: CONDA_ENVS_PATH=$CONDA_ENVS_DIR $CONDA_BIN create --override-channels --channel conda-forge -n $CONDA_ENV python=3.11 pip -y"
      elif (cd "$ROOT" && CONDA_ENVS_PATH="$CONDA_ENVS_DIR" "$CONDA_BIN" create --override-channels --channel conda-forge -n "$CONDA_ENV" python=3.11 pip -y); then
        result ok "create conda env $CONDA_ENV" "$CONDA_ENVS_DIR/$CONDA_ENV"
      else
        code=$?
        result fail "create conda env $CONDA_ENV" "exit $code"
      fi
    fi
    if ((DRY_RUN)); then
      result skip 'install LibreTranslate' "DryRun: CONDA_ENVS_PATH=$CONDA_ENVS_DIR $CONDA_BIN run -n $CONDA_ENV python -m pip install --upgrade libretranslate 'urllib3<2' 'chardet<6'"
    elif (cd "$ROOT" && CONDA_ENVS_PATH="$CONDA_ENVS_DIR" "$CONDA_BIN" run -n "$CONDA_ENV" python -m pip install --upgrade libretranslate 'urllib3<2' 'chardet<6'); then
      result ok 'install LibreTranslate' "$CONDA_ENV"
    else
      code=$?
      result fail 'install LibreTranslate' "exit $code"
    fi
  fi
fi

# 5. Verification
if ((SKIP_TESTS)); then
  result skip verification '--skip-tests'
else
  run_step 'unit tests' "$ROOT" npm test || true
  run_step 'browser E2E' "$ROOT" npm run test:e2e || true
  run_step 'Anki popup E2E' "$ROOT" npm run test:e2e:anki || true
fi

# 6. Optional Inbox background service. launchctl submit lasts for this login session.
if ((START_INBOX)); then
  if [[ ! -f "$SERVER_DIR/dist/index.js" ]]; then
    result fail 'Inbox service' 'anki-mcp-server build output is missing'
  elif ((DRY_RUN)); then
    result skip 'Inbox service' "DryRun: launchctl submit com.kuonumber.anki-mcp-inbox with $EXTENSION_ORIGIN"
  elif lsof -nP -iTCP:8766 -sTCP:LISTEN >/dev/null 2>&1; then
    result fail 'Inbox service' 'port 8766 is already in use; existing service was not replaced'
  else
    CODEX_BIN="$(command -v codex || true)"
    if [[ -z "$CODEX_BIN" && -x /Applications/ChatGPT.app/Contents/Resources/codex ]]; then
      CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex
    fi
    if [[ -z "$CODEX_BIN" ]]; then
      result fail 'Inbox service' 'Codex CLI not found; install or open the ChatGPT app first'
    else
      PROCESSOR_CMD="$(node -e 'console.log(JSON.stringify([process.argv[1],"exec","--sandbox","read-only","--ephemeral","--skip-git-repo-check","-o","{output}","-"]))' "$CODEX_BIN")"
      NODE_BIN="$(command -v node)"
      if launchctl submit -l com.kuonumber.anki-mcp-inbox -- /usr/bin/env \
          "UDEMY_EXTENSION_ORIGIN=$EXTENSION_ORIGIN" \
          "ANKI_MCP_DATA_DIR=$SERVER_DIR" \
          "UDEMY_PROCESSOR_CODEX_CMD=$PROCESSOR_CMD" \
          "$NODE_BIN" "$SERVER_DIR/dist/index.js" --inbox-only; then
        result ok 'Inbox service' 'started on 127.0.0.1:8766'
        printf '  pairing token file: %s/inbox/pairing-token.txt\n' "$SERVER_DIR"
      else
        result fail 'Inbox service' 'launchctl submit failed'
      fi
    fi
  fi
fi

printf '\nNext steps:\n'
printf '1. Chrome: chrome://extensions -> Developer mode -> Load unpacked -> %s\n' "$ROOT"
printf '2. Install Anki and AnkiConnect separately if you need Anki sync.\n'
printf '3. Start LibreTranslate with: CONDA_ENVS_PATH=%s conda run -n %s libretranslate --load-only en,zh\n' "$CONDA_ENVS_DIR" "$CONDA_ENV"
printf '4. Start Inbox: ./scripts/install.sh --skip-libre --skip-tests --start-inbox --extension-origin chrome-extension://<id>\n'

if ((FAILURES)); then
  printf '\n%d step(s) failed.\n' "$FAILURES"
  exit 1
fi
printf '\nAll installation steps passed.\n'
