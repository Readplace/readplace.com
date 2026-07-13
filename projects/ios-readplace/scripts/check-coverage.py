#!/usr/bin/env python3
"""Enforce per-file line-coverage floors for the iOS app after `make test`.

The rest of the repo enforces a 100% coverage gate; iOS had none. This reads the
`.xcresult` bundle `xcodebuild test -enableCodeCoverage YES` produced and fails
the build if any measured source file dropped below its recorded floor.

Config (`coverage-baseline.json`, beside this script):
  - `excluded`: files that are pure SwiftUI layout, UIKit shells, or WebKit /
    OS-boundary glue — unit-uncoverable without UI tests. This is the Swift
    analog of the repo's whole-file OS-boundary coverage exclusion.
  - `floors`: the minimum whole-percent line coverage each remaining source file
    must keep. A source file with neither an exclusion nor a floor must be 100%,
    so a newly added logic file cannot land untested. Floors are a RATCHET: raise
    them as coverage improves, never lower them.

Uses only the system `python3` + `xcrun`, so the CI `ios-tests` job needs no
extra toolchain setup.
"""
import json
import subprocess
import sys
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name("coverage-baseline.json")


def load_report(xcresult: str) -> dict:
    out = subprocess.run(
        ["xcrun", "xccov", "view", "--report", "--json", xcresult],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def measured_files(report: dict) -> dict[str, float]:
    """Best line coverage per source basename across all non-test targets.

    A Shared file compiles into both the app and the extension target, so it
    appears twice at the SAME path with identical coverage; keep the higher of
    the two. Two DIFFERENT files that share a basename (e.g. App/Foo.swift and
    Shared/Foo.swift) cannot coexist under one basename key: the config
    (floors/excluded) is basename-keyed, so max()-merging them would silently
    hide the lower-coverage file behind its higher-coverage namesake. Assert the
    basename maps to a single path so such a collision fails the gate loudly
    instead of passing on the wrong number.
    """
    best: dict[str, float] = {}
    path_of: dict[str, str] = {}
    for target in report.get("targets", []):
        if "Tests" in target.get("name", ""):
            continue
        for f in target.get("files", []):
            name = f.get("name", "")
            if not name.endswith(".swift"):
                continue
            path = f.get("path", name)
            seen = path_of.setdefault(name, path)
            assert path == seen, (
                f"basename {name!r} measured at two paths ({seen} and {path}); "
                "the basename-keyed coverage config cannot represent both — "
                "rename one file or key this gate by path"
            )
            cov = float(f.get("lineCoverage", 0.0))
            best[name] = max(best.get(name, 0.0), cov)
    return best


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-coverage.py <path-to.xcresult>", file=sys.stderr)
        return 2

    config = json.loads(CONFIG_PATH.read_text())
    excluded = config.get("excluded", {})
    floors = config.get("floors", {})

    report = load_report(sys.argv[1])
    measured = measured_files(report)

    # A report that measured no source file is never a pass: it means the xcresult
    # was produced without coverage instrumentation, or xccov's JSON schema drifted
    # (a renamed `targets`/`files`/`name` key) so nothing parsed. Either way the gate
    # would otherwise collect zero failures and exit 0 — a silently disabled gate
    # reads as green CI. Fail loudly instead, so "measured nothing" can never mean
    # "everything passed".
    if not measured:
        print(
            "iOS coverage gate FAILED — the coverage report measured no source "
            "files. The xcresult is empty or xccov's schema changed; the gate "
            "refuses to pass without measuring anything.",
            file=sys.stderr,
        )
        return 1

    failures: list[str] = []
    slack: list[str] = []
    for name, cov in sorted(measured.items()):
        if name in excluded:
            continue
        percent = round(cov * 100)
        floor = floors.get(name, 100)
        if percent < floor:
            failures.append(f"  {name}: {percent}% < floor {floor}%")
        elif percent >= floor + 2:
            # A 1% headroom is a deliberate buffer against minor coverage drift;
            # only nudge a ratchet once a file is comfortably above its floor.
            slack.append(f"  {name}: {percent}% (floor {floor}%)")

    stale = sorted({n for n in list(excluded) + list(floors) if n not in measured})
    if stale:
        print("warning: coverage config references files no longer measured — prune them:")
        for n in stale:
            print(f"  {n}")
        print()

    if failures:
        print("iOS coverage gate FAILED — files below their floor:")
        print("\n".join(failures))
        print("\nRaise the file's coverage, or (only with approval) its floor in "
              f"{CONFIG_PATH.name}.")
        return 1

    print(f"iOS coverage gate passed: {len(measured) - len(excluded)} files at "
          f"or above floor, {len(excluded)} excluded (view / OS-boundary).")
    if slack:
        print("Ratchet candidates (coverage now exceeds the floor — raise it):")
        print("\n".join(slack))
    return 0


if __name__ == "__main__":
    sys.exit(main())
