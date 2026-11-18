#!/bin/bash
# Checks that a pull request follows Conventional Commits (see CONTRIBUTING.md): its title, which becomes
# the commit message on main when the pull request is squashed, and every commit in it.
#
#   TITLE="feat(hub): add a thing" BASE=<sha> HEAD=<sha> .github/scripts/check-commits.sh
#   .github/scripts/check-commits.sh "fix(pi): one message"      checks just that message
set -u
PATTERN='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9-]*\))?!?: [^ ].{0,98}$'
failed=0

check() {   # $1 = what it is, $2 = the message (first line)
  if [[ "$2" =~ $PATTERN ]]; then
    printf '  ok    %s: %s\n' "$1" "$2"
  else
    printf '  FAIL  %s: %s\n' "$1" "$2"
    failed=1
  fi
}

if [ $# -gt 0 ]; then
  check "message" "$1"
else
  [ -n "${TITLE:-}" ] && check "pull request title" "$TITLE"
  if [ -n "${BASE:-}" ] && [ -n "${HEAD:-}" ]; then
    while IFS= read -r line; do
      check "commit ${line%% *}" "${line#* }"
    done < <(git log --no-merges --format='%h %s' "$BASE..$HEAD")
  fi
fi

if [ "$failed" -ne 0 ]; then
  cat <<'EOF'

Use Conventional Commits: <type>(<optional scope>): <summary>
  types:  feat fix docs style refactor perf test build ci chore revert
  scopes: hub, pi, i18n, docs, ci, deps (or none)
  e.g.    feat(hub): show the Wi-Fi signal on the board
          fix(pi): keep the maps switched off after an update
A "!" before the colon marks a breaking change. Rename the pull request, or reword the commits
(git rebase -i), then push again. Details in CONTRIBUTING.md.
EOF
  exit 1
fi
