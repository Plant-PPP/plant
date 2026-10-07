#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
export TURBO_TELEMETRY_DISABLED=1

if git show-ref --verify --quiet refs/remotes/origin/staging; then
  # Empty when there is no shared history (an orphan branch).
  merge_base="$(git merge-base HEAD origin/staging || true)"
else
  merge_base=""
fi

# Every ref in this push (git lists them on stdin, which may not be HEAD)
# goes public with its commits, their messages and authors, and its name.
zero=0000000000000000000000000000000000000000
while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "$zero" ] && continue # deleting a remote branch
  if [ "$(git cat-file -t "$local_sha")" = "tag" ]; then
    # An annotated tag carries its own message; git log would only see the
    # commit it points to.
    tag_message=$(mktemp)
    git cat-file tag "$local_sha" > "$tag_message"
    status=0
    FORBIDDEN_WORDS_MESSAGE_FILE="$tag_message" \
      bash "$ROOT/scripts/check-forbidden-words.sh" || status=$?
    rm -f "$tag_message"
    [ "$status" -eq 0 ] || exit "$status"
  fi
  if [ "$remote_sha" != "$zero" ] && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
    range="$remote_sha..$local_sha"
  elif ref_base="$(git merge-base "$local_sha" origin/staging 2>/dev/null)"; then
    range="$ref_base..$local_sha"
  else
    range="$local_sha"
  fi
  FORBIDDEN_WORDS_BRANCH="${remote_ref#refs/heads/}" FORBIDDEN_WORDS_RANGE="$range" \
    bash "$ROOT/scripts/check-forbidden-words.sh"
done

# Regenerate the Supabase types only when the branch adds migrations.
if [ -n "$merge_base" ] && git diff --diff-filter=A --name-only "$merge_base"...HEAD -- "supabase/migrations/*.sql" | grep -q .; then
  pnpm run db:generate:supabase-types
  # --porcelain also sees a first-time (untracked) types file and staged-only
  # changes, which `git diff --quiet` misses.
  if [ -n "$(git status --porcelain -- packages/shared/src/db/generated/)" ]; then
    echo "Error: the Supabase types were out of date and are now regenerated in packages/shared/src/db/generated/. Commit them and push again."
    exit 1
  fi
fi

# From here on the checks run on the checked-out branch (HEAD), even when
# the push names another ref; CI covers that ref.
# Typecheck, lint and test the packages this branch affects, per the
# dependency graph. Without an origin/staging ref (a single-branch clone, a
# remote not named origin) there is no base, so fall back to the whole repo.
if [ -n "$merge_base" ]; then
  pnpm turbo:affected
else
  pnpm check && pnpm test
fi
