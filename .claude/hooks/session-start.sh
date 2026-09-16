#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

pnpm install --frozen-lockfile --reporter=append-only --loglevel=warn

eval "$(grep '^export EDITORCONFIG_CHECKER_VERSION=' .envrc)"
version="$EDITORCONFIG_CHECKER_VERSION"

pkg=$(echo node_modules/.pnpm/editorconfig-checker@*/node_modules/editorconfig-checker)
test -d "$pkg" || { echo "editorconfig-checker not installed at $pkg" >&2; exit 1; }

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "unsupported OS for editorconfig-checker: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "unsupported architecture for editorconfig-checker: $(uname -m)" >&2; exit 1 ;;
esac

binary="$pkg/bin/$version/bin/ec-$os-$arch"

# The editorconfig-checker package resolves its Go binary through api.github.com, which a
# Claude Code web session answers with 403 — its GitHub access is scoped to this repo alone —
# aborting `pnpm check` at its first gate. The release asset is reachable over plain HTTPS,
# so fetch it straight into the cache the wrapper reads.
if [ ! -x "$binary" ]; then
  staging="$pkg/bin/.incomplete"
  trap 'rm -rf "$staging"' EXIT
  rm -rf "$staging"
  mkdir -p "$staging"

  curl --fail --silent --show-error --location \
    "https://github.com/editorconfig-checker/editorconfig-checker/releases/download/$version/ec-$os-$arch.tar.gz" \
    | tar -xz -C "$staging"

  chmod +x "$staging/bin/ec-$os-$arch"
  rm -rf "$pkg/bin/$version"
  mkdir -p "$pkg/bin"
  mv "$staging" "$pkg/bin/$version"
fi

test -x "$binary" || { echo "editorconfig-checker binary missing at $binary" >&2; exit 1; }
"$binary" --version
