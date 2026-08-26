#!/usr/bin/env python3
"""Enforce per-file line-coverage floors for the Android app after `make test`.

The Android twin of the iOS `scripts/check-coverage.py`, reading JaCoCo's XML
report instead of an `.xcresult` bundle. Same policy, same failure modes.

Config (`coverage-baseline.json`, beside this script):
  - `excluded`: files that are pure Compose layout, WebView / Keystore / Intent
    glue, or activity shells — unit-uncoverable without instrumented UI tests.
  - `floors`: the minimum whole-percent line coverage each remaining source file
    must keep. A source file with neither an exclusion nor a floor must be 100%,
    so a newly added logic file cannot land untested. Floors are a RATCHET: raise
    them as coverage improves, never lower them.

Uses only the Python standard library, so CI needs no extra toolchain setup.
"""
import json
import sys
import xml.etree.ElementTree as ElementTree
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name("coverage-baseline.json")


def measured_files(report_path: str) -> dict[str, float]:
    """Line coverage per source basename, as a 0..1 fraction.

    JaCoCo reports one `<sourcefile>` per class file per package. The config is
    basename-keyed, so two DIFFERENT files sharing a basename (e.g. core/Foo.kt
    and app/Foo.kt) cannot both be represented: merging them would silently hide
    the lower-coverage file behind its namesake. Assert a basename maps to a
    single package so such a collision fails the gate loudly.
    """
    tree = ElementTree.parse(report_path)
    best: dict[str, float] = {}
    package_of: dict[str, str] = {}
    for package in tree.getroot().iter("package"):
        package_name = package.get("name", "")
        for sourcefile in package.findall("sourcefile"):
            name = sourcefile.get("name", "")
            if not name.endswith(".kt"):
                continue
            seen = package_of.setdefault(name, package_name)
            assert package_name == seen, (
                f"basename {name!r} measured in two packages ({seen} and "
                f"{package_name}); the basename-keyed coverage config cannot "
                "represent both — rename one file or key this gate by path"
            )
            missed = covered = 0
            for counter in sourcefile.findall("counter"):
                if counter.get("type") == "LINE":
                    missed = int(counter.get("missed", 0))
                    covered = int(counter.get("covered", 0))
            total = missed + covered
            if total == 0:
                continue
            best[name] = max(best.get(name, 0.0), covered / total)
    return best


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-coverage.py <path-to-jacoco.xml>", file=sys.stderr)
        return 2

    config = json.loads(CONFIG_PATH.read_text())
    excluded = config.get("excluded", {})
    floors = config.get("floors", {})

    measured = measured_files(sys.argv[1])

    # A report that measured no source file is never a pass: it means the run was
    # produced without coverage instrumentation, or JaCoCo's schema drifted, so the
    # gate would otherwise collect zero failures and exit 0 — a silently disabled
    # gate reads as green CI. Fail loudly instead.
    if not measured:
        print(
            "Android coverage gate FAILED — the coverage report measured no "
            "source files. The report is empty or JaCoCo's schema changed; the "
            "gate refuses to pass without measuring anything.",
            file=sys.stderr,
        )
        return 1

    failures: list[str] = []
    slack: list[str] = []
    skipped = 0
    for name, cov in sorted(measured.items()):
        if name in excluded:
            skipped += 1
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
        print("Android coverage gate FAILED — files below their floor:")
        print("\n".join(failures))
        print("\nRaise the file's coverage, or (only with approval) its floor in "
              f"{CONFIG_PATH.name}.")
        return 1

    # Counts what was MEASURED, not what the config lists: an exclusion naming a file
    # that no longer exists (or does not exist yet) must not be subtracted from the
    # gated total, or the summary understates how much the gate actually checked.
    print(f"Android coverage gate passed: {len(measured) - skipped} files at "
          f"or above floor, {skipped} excluded (view / OS-boundary).")
    if slack:
        print("Ratchet candidates (coverage now exceeds the floor — raise it):")
        print("\n".join(slack))
    return 0


if __name__ == "__main__":
    sys.exit(main())
