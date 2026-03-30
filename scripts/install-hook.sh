#!/usr/bin/env bash
#
# Installs AugmentedMergeTool as the git merge tool for the current repository.
#
# Usage:
#   ./scripts/install-hook.sh          # install for current repo
#   ./scripts/install-hook.sh --global # install globally
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SCOPE=""
if [[ "${1:-}" == "--global" ]]; then
  SCOPE="--global"
fi

git config $SCOPE merge.tool augmented-merge-tool
git config $SCOPE mergetool.augmented-merge-tool.cmd "node ${PROJECT_ROOT}/dist/index.js"
git config $SCOPE mergetool.augmented-merge-tool.trustExitCode true

echo "✅ AugmentedMergeTool installed as git merge tool${SCOPE:+ (global)}."
echo ""
echo "After a merge conflict, run:"
echo "  git mergetool"
echo ""
echo "Or invoke directly:"
echo "  node ${PROJECT_ROOT}/dist/index.js"
