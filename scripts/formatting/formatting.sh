#!/usr/bin/env bash

FORMAT_MISMATCHED_FILES=()

formatting_count_files() {
  local files_path="$1"

  wc -l < "$files_path" | tr -d ' '
}

formatting_file_noun() {
  local count="$1"

  if [ "$count" -eq 1 ]; then
    printf 'file'
  else
    printf 'files'
  fi
}

formatting_project_file_noun() {
  local count="$1"

  if [ "$count" -eq 1 ]; then
    printf 'project file'
  else
    printf 'project files'
  fi
}

formatting_print_summary() {
  echo "[formatting] $1"
}

formatting_write_checked_file_list() {
  local checked_files_path="$1"

  : > "$checked_files_path"

  if [ "${#CHANGED_FILES[@]}" -gt 0 ]; then
    printf '%s\n' "${CHANGED_FILES[@]}" > "$checked_files_path"
  fi
}

formatting_print_grouped_files() {
  local label="$1"
  shift

  local project
  local file
  local has_project_files

  for project in "${CHANGED_PROJECTS[@]}"; do
    has_project_files=0

    for file in "$@"; do
      case "$file" in
        "$project"/*)
          has_project_files=1
          break
          ;;
      esac
    done

    if [ "$has_project_files" -eq 0 ]; then
      continue
    fi

    echo "    $project:"

    for file in "$@"; do
      case "$file" in
        "$project"/*)
          echo "      $label: $file"
          ;;
      esac
    done
  done
}

formatting_print_fix_instructions() {
  echo 
  cat <<'EOF'

Tip:
```
git add --all
pnpm format
git add --all
git commit -m "chore: formatting"
git push
```
EOF
 echo 
}

formatting_find_mismatches() {
  local checked_files_path="$1"
  local mismatched_files_path="$2"
  local files=()
  local file

  while IFS= read -r file; do
    files+=("$file")
  done < "$checked_files_path"

  if [ "${#files[@]}" -eq 0 ]; then
    : > "$mismatched_files_path"
    return 0
  fi

  set +e
  pnpm exec prettier --list-different --ignore-unknown "${files[@]}" > "$mismatched_files_path"
  local prettier_status=$?
  set -e

  if [ "$prettier_status" -gt 1 ]; then
    return "$prettier_status"
  fi

  return 0
}

formatting_check_changed_files() {
  local checked_files_path="$1"
  local mismatched_files_path="$2"

  formatting_write_checked_file_list "$checked_files_path"

  local checked_count
  checked_count=$(formatting_count_files "$checked_files_path")
  local checked_noun
  checked_noun=$(formatting_project_file_noun "$checked_count")

  if [ "$checked_count" -eq 0 ]; then
    formatting_print_summary "Checked 0 project files. 0 didn't match required formatting"
    return 0
  fi

  formatting_find_mismatches "$checked_files_path" "$mismatched_files_path"

  local mismatch_count
  mismatch_count=$(formatting_count_files "$mismatched_files_path")

  if [ "$mismatch_count" -eq 0 ]; then
    formatting_print_summary "Checked $checked_count $checked_noun. 0 didn't match required formatting"
    return 0
  fi

  FORMAT_MISMATCHED_FILES=()
  while IFS= read -r file; do
    FORMAT_MISMATCHED_FILES+=("$file")
  done < "$mismatched_files_path"

  formatting_print_summary "Checked $checked_count $checked_noun. $mismatch_count didn't match required formatting"
  formatting_print_grouped_files diff "${FORMAT_MISMATCHED_FILES[@]}"
  formatting_print_fix_instructions

  return 1
}

formatting_write_changed_files() {
  local checked_files_path="$1"
  local mismatched_files_path="$2"

  formatting_write_checked_file_list "$checked_files_path"

  local checked_count
  checked_count=$(formatting_count_files "$checked_files_path")
  local checked_noun
  checked_noun=$(formatting_project_file_noun "$checked_count")

  if [ "$checked_count" -eq 0 ]; then
    formatting_print_summary "Checked 0 project files. 0 changes needed"
    return 0
  fi

  formatting_find_mismatches "$checked_files_path" "$mismatched_files_path"

  local mismatch_count
  mismatch_count=$(formatting_count_files "$mismatched_files_path")

  if [ "$mismatch_count" -eq 0 ]; then
    formatting_print_summary "Checked $checked_count $checked_noun. 0 changes needed"
    return 0
  fi

  FORMAT_MISMATCHED_FILES=()
  while IFS= read -r file; do
    FORMAT_MISMATCHED_FILES+=("$file")
  done < "$mismatched_files_path"

  pnpm exec prettier --write --ignore-unknown "${FORMAT_MISMATCHED_FILES[@]}" > /dev/null
  git add --pathspec-from-file="$mismatched_files_path"

  local mismatch_noun
  mismatch_noun=$(formatting_file_noun "$mismatch_count")

  formatting_print_summary "Checked $checked_count $checked_noun. Auto-formatted $mismatch_count $mismatch_noun:"

  formatting_print_grouped_files formatted "${FORMAT_MISMATCHED_FILES[@]}"
}
