#!/usr/bin/env python3
"""Every job on `environment: production` lists `approve` in its `needs`.

`production` holds the deploy secrets and no reviewers; the reviewer sits on
`production-gate`, which only the `approve` job enters. A job that enters
`production` without needing `approve` deploys with nobody asked.

Stdlib only, like check-checkout-persist-credentials.py: this must fire on a
PR that touches only workflow files, before dependencies are installed.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

WORKFLOWS = Path(".github/workflows")
BLOCK = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")  # a job: 2-space key, no value
KEY = re.compile(r"^    ([A-Za-z0-9_-]+):\s*(.*)$")  # a job-level key
WORD = re.compile(r"[A-Za-z0-9_-]+")
ENV_NAME = re.compile(r"^\s+name:\s*(.*)$", re.MULTILINE)


def environment(keys: dict[str, str]) -> str:
    """The job's environment name: the scalar, or the mapping's `name:`."""
    value = keys.get("environment", "")
    m = ENV_NAME.search(value)
    return m.group(1).strip() if m else value.strip()


def jobs(text: str):
    """Yield (name, {key: value text}) per 2-space block.

    A key's value text keeps every deeper-indented line under it, so a `needs:`
    list or an `environment:` mapping that spans lines comes through whole.
    """
    name, keys, cur = None, {}, None
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.strip() and not line.startswith(" "):  # top-level key: block over
            if name:
                yield name, keys
            name = None
        m = BLOCK.match(line)
        if m:
            if name:
                yield name, keys
            name, keys, cur = m.group(1), {}, None
            continue
        k = KEY.match(line)
        if k and name:
            cur = k.group(1)
            keys[cur] = k.group(2)
        elif cur and name and line.startswith("      "):
            keys[cur] += "\n" + line
    if name:
        yield name, keys


def main() -> int:
    if not WORKFLOWS.is_dir():
        print(f"error: {WORKFLOWS} not found — run from the repo root", file=sys.stderr)
        return 2

    violations: list[str] = []
    gated = 0
    for path in sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml")):
        found = dict(jobs(path.read_text(encoding="utf-8", errors="replace")))
        # An expression can name `production` at run time, which no static
        # read can rule out.
        for n, k in found.items():
            if "${{" in environment(k):
                violations.append(f"{path}: job `{n}` picks its environment with an expression")
        enters = [n for n, k in found.items() if "production" in WORD.findall(environment(k))]
        if not enters:
            continue
        gated += len(enters)
        if environment(found.get("approve", {})) != "production-gate":
            violations.append(f"{path}: no `approve` job on `environment: production-gate`")
        for n in enters:
            if "approve" not in WORD.findall(found[n].get("needs", "")):
                violations.append(f"{path}: job `{n}` enters `production` without `approve` in its needs")

    if gated == 0 and not violations:
        print("error: no job with `environment: production` found — the matcher is broken", file=sys.stderr)
        return 2
    if violations:
        print("jobs entering `production` outside the approval gate:\n", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        print("\nAdd `approve` to the job's `needs` (see promote-to-production.yml).", file=sys.stderr)
        return 1
    print(f"ok: all {gated} production-environment jobs need `approve`")
    return 0


if __name__ == "__main__":
    sys.exit(main())
