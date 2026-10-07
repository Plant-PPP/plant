#!/usr/bin/env bash

# Source this file to collect changed files by top-level project directory.
#
# Usage:
#   source "$ROOT/scripts/formatting/changed-files.sh"
#   changed_since_last_commit --pattern '\.(ts|tsx)$' frontend api
#   printf '%s\n' "${CHANGED_PROJECTS[@]}"
#   printf '%s\n' "${CHANGED_FILES[@]}"
#
# Both public functions populate:
#   CHANGED_PROJECTS - top-level projects with at least one changed file
#   CHANGED_FILES    - changed files under the requested projects

CHANGED_PROJECTS=()
CHANGED_FILES=()

linting_git_root() {
  git rev-parse --show-toplevel
}

linting_staging_ref() {
  local ref="${LINTING_STAGING_REF:-origin/staging}"

  if git rev-parse --verify --quiet "$ref" >/dev/null; then
    printf '%s\n' "$ref"
    return 0
  fi

  if git rev-parse --verify --quiet staging >/dev/null; then
    printf '%s\n' staging
    return 0
  fi

  printf 'Could not find staging ref. Set LINTING_STAGING_REF to override.\n' >&2
  return 1
}

linting_project_pathspecs() {
  local project

  for project in "$@"; do
    if [ -z "$project" ]; then
      printf 'Project names must not be empty.\n' >&2
      return 2
    fi

    printf '%s/\n' "$project"
  done
}

linting_filter_files() {
  local files="$1"
  local pattern="$2"

  if [ -z "$files" ] || [ -z "$pattern" ]; then
    printf '%s\n' "$files"
    return 0
  fi

  printf '%s\n' "$files" | grep -E "$pattern" || true
}

linting_filter_existing_files() {
  local files="$1"

  if [ -z "$files" ]; then
    return 0
  fi

  local file

  while IFS= read -r file; do
    if [ -f "$file" ]; then
      printf '%s\n' "$file"
    fi
  done <<<"$files"
}

linting_set_changed_results() {
  local files="$1"
  shift

  local project
  local file

  CHANGED_FILES=()
  CHANGED_PROJECTS=()

  if [ -n "$files" ]; then
    while IFS= read -r file; do
      CHANGED_FILES+=("$file")
    done <<<"$files"
  fi

  if [ "${#CHANGED_FILES[@]}" -eq 0 ]; then
    return 0
  fi

  for project in "$@"; do
    for file in "${CHANGED_FILES[@]}"; do
      case "$file" in
        "$project"/*)
          CHANGED_PROJECTS+=("$project")
          break
          ;;
      esac
    done
  done
}

linting_parse_changed_args() {
  CHANGED_FILE_PATTERN=""

  if [ "${1:-}" = "--pattern" ]; then
    if [ -z "${2:-}" ]; then
      return 2
    fi

    CHANGED_FILE_PATTERN="$2"
    shift 2
  fi

  if [ "$#" -eq 0 ]; then
    return 2
  fi

  CHANGED_ARG_PROJECTS=("$@")
}

changed_since_last_commit() {
  if ! linting_parse_changed_args "$@"; then
    printf 'Usage: changed_since_last_commit [--pattern <regex>] <project> [project...]\n' >&2
    return 2
  fi

  local root
  root=$(linting_git_root)

  local pathspecs
  pathspecs=$(linting_project_pathspecs "${CHANGED_ARG_PROJECTS[@]}")

  local files
  files=$(
    cd "$root" && {
      git diff --name-only --diff-filter=ACMR HEAD -- $pathspecs
      git ls-files --others --exclude-standard -- $pathspecs
    } | sort -u
  )

  files=$(linting_filter_existing_files "$files")
  files=$(linting_filter_files "$files" "$CHANGED_FILE_PATTERN")

  linting_set_changed_results "$files" "${CHANGED_ARG_PROJECTS[@]}"
}

changed_staged() {
  if ! linting_parse_changed_args "$@"; then
    printf 'Usage: changed_staged [--pattern <regex>] <project> [project...]\n' >&2
    return 2
  fi

  local root
  root=$(linting_git_root)

  local pathspecs
  pathspecs=$(linting_project_pathspecs "${CHANGED_ARG_PROJECTS[@]}")

  local files
  files=$(
    cd "$root" && git diff --cached --name-only --diff-filter=ACMR -- $pathspecs | sort -u
  )

  files=$(linting_filter_existing_files "$files")
  files=$(linting_filter_files "$files" "$CHANGED_FILE_PATTERN")

  linting_set_changed_results "$files" "${CHANGED_ARG_PROJECTS[@]}"
}

changed_against_staging() {
  if ! linting_parse_changed_args "$@"; then
    printf 'Usage: changed_against_staging [--pattern <regex>] <project> [project...]\n' >&2
    return 2
  fi

  local root
  root=$(linting_git_root)

  local pathspecs
  pathspecs=$(linting_project_pathspecs "${CHANGED_ARG_PROJECTS[@]}")

  local staging_ref
  staging_ref=$(linting_staging_ref)

  # The branch diff runs alone first: inside the group below, a git failure
  # (e.g. an unfetched staging ref) would be masked by the later commands and
  # the check would pass having seen none of the PR's committed files.
  local committed
  committed=$(cd "$root" && git diff --name-only --diff-filter=ACMR "$staging_ref"...HEAD -- $pathspecs) || return 1

  local files
  files=$(
    cd "$root" && {
      printf '%s\n' "$committed"
      git diff --name-only --diff-filter=ACMR HEAD -- $pathspecs
      git ls-files --others --exclude-standard -- $pathspecs
    } | sort -u
  )

  files=$(linting_filter_existing_files "$files")
  files=$(linting_filter_files "$files" "$CHANGED_FILE_PATTERN")

  linting_set_changed_results "$files" "${CHANGED_ARG_PROJECTS[@]}"
}
