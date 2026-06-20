#!/bin/bash
# Ship one single-file audit fix end-to-end: branch -> apply -> commit (hook=full check) -> push -> PR -> main.
# Usage: .audit-ship.sh <repo-relative-file>
set -e
cd /Users/fagnerbrack/Git/mike-hutch-app
FILE="$1"

git switch main --quiet
git switch -c "audit/staging-tmp" "27e1e900" --quiet

OUT=$(node .audit-apply.cjs "$FILE")
echo "$OUT"
BRANCH=$(echo "$OUT" | grep '^BRANCH=' | cut -d= -f2-)
LABEL=$(echo "$OUT" | grep '^LABEL=' | cut -d= -f2-)
PRTITLE=$(echo "$OUT" | grep '^PRTITLE=' | cut -d= -f2-)
git branch -m "$BRANCH"

git add "$FILE"
eval "$(grep '^export ' .envrc)" 2>/dev/null || true
echo "=== commit (pre-commit hook runs full pnpm check) ==="
git commit -F /tmp/audit-commit.txt
echo "=== push ==="
git push -u origin "$BRANCH"
echo "=== PR ==="
gh pr create --base main --head "$BRANCH" --title "$PRTITLE" --label "$LABEL" --body-file /tmp/audit-pr.txt
git switch main --quiet
echo "=== DONE: $BRANCH ==="
