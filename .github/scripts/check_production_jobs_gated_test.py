#!/usr/bin/env python3
"""Fixture tests for the production approval gate.

Each case asserts the exit code and a stderr substring: a fixture that fails to
land exits 2, which only the `no_production_jobs` tripwire expects.

Fixtures go to a temp dir, never `.github/**`, where GitHub would run them.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

GATE = Path(__file__).with_name("check-production-jobs-gated.py")

OK = 0
VIOLATION = 1
BROKEN_MATCHER = 2

W = ".github/workflows/t.yml"

APPROVE = """
  approve:
    runs-on: ubuntu-latest
    environment: production-gate
    steps:
      - run: echo approved
"""

# name, expected exit, {relative path: content}, expected stderr substring
CASES: list[tuple[str, int, dict[str, str], str]] = [
    ("gated", OK, {W: "jobs:" + APPROVE + """
  deploy:
    needs: [approve]
    environment: production
    steps:
      - run: echo deploy
"""}, ""),

    ("block_needs_and_mapping_environment", OK, {W: "jobs:" + APPROVE + """
  deploy:
    needs:
      - detect
      - approve
    environment:
      name: production
    steps:
      - run: echo deploy
"""}, ""),

    ("missing_approve_in_needs", VIOLATION, {W: "jobs:" + APPROVE + """
  deploy:
    needs: [detect]
    environment: production
    steps:
      - run: echo deploy
"""}, "job `deploy` enters `production` without `approve`"),

    # `needs` on another job doesn't count, nor a word that only contains it.
    ("approve_lookalike", VIOLATION, {W: "jobs:" + APPROVE + """
  deploy:
    needs: [pre-approve]
    environment: production
    steps:
      - run: echo deploy
"""}, "job `deploy` enters `production`"),

    ("no_approve_job", VIOLATION, {W: """
jobs:
  deploy:
    needs: [approve]
    environment: production
    steps:
      - run: echo deploy
"""}, "no `approve` job on `environment: production-gate`"),

    ("approve_without_reviewers", VIOLATION, {W: """
jobs:
  approve:
    environment: production
    steps:
      - run: echo approved
  deploy:
    needs: [approve]
    environment: production
    steps:
      - run: echo deploy
"""}, "no `approve` job on `environment: production-gate`"),

    ("expression_environment", VIOLATION, {W: "jobs:" + APPROVE + """
  deploy:
    needs: [approve]
    environment: production
    steps:
      - run: echo deploy
  sneaky:
    environment: ${{ inputs.target }}
    steps:
      - run: echo deploy
"""}, "job `sneaky` picks its environment with an expression"),

    # A mapping's `url:` may be an expression; only the name decides.
    ("mapping_url_expression", OK, {W: "jobs:" + APPROVE + """
  deploy:
    needs: [approve]
    environment:
      name: production
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - run: echo deploy
"""}, ""),

    ("mapping_name_missing_approve", VIOLATION, {W: "jobs:" + APPROVE + """
  deploy:
    environment:
      url: https://plant.test
      name: production
"""}, "job `deploy` enters `production`"),

    # A step's `environment` text inside a run block is not a job key.
    ("run_block_mentions_production", BROKEN_MATCHER, {W: """
jobs:
  build:
    steps:
      - run: |
          echo "environment: production"
"""}, "the matcher is broken"),

    ("crlf", VIOLATION, {W: (
        "jobs:\r\n  approve:\r\n    environment: production-gate\r\n"
        "  deploy:\r\n    needs: [detect]\r\n    environment: production\r\n"
    )}, "job `deploy` enters `production`"),

    ("yaml_extension", VIOLATION, {".github/workflows/t.yaml": "jobs:" + APPROVE + """
  deploy:
    environment: production
"""}, "t.yaml: job `deploy`"),

    ("no_production_jobs", BROKEN_MATCHER, {W: """
jobs:
  build:
    environment: vercel-preview
    steps:
      - run: echo hi
"""}, "the matcher is broken"),
]


def run_case(name: str, expected: int, files: dict[str, str], expect_err: str) -> str | None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for rel, body in files.items():
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body.lstrip("\n").encode("utf-8"))
        proc = subprocess.run(
            [sys.executable, str(GATE)], cwd=root, capture_output=True, text=True
        )
    detail = f"    stdout: {proc.stdout.strip()}\n    stderr: {proc.stderr.strip()}"
    if proc.returncode != expected:
        return f"{name}: expected exit {expected}, got {proc.returncode}\n{detail}"
    if expect_err and expect_err not in proc.stderr:
        return f"{name}: stderr missing {expect_err!r}\n{detail}"
    return None


def main() -> int:
    if not GATE.is_file():
        print(f"error: gate not found at {GATE}", file=sys.stderr)
        return 2
    failures = [
        msg for name, exp, files, err in CASES if (msg := run_case(name, exp, files, err))
    ]
    for msg in failures:
        print(f"FAIL {msg}", file=sys.stderr)
    if failures:
        print(f"\n{len(failures)} of {len(CASES)} cases failed", file=sys.stderr)
        return 1
    print(f"ok: {len(CASES)} gate cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
