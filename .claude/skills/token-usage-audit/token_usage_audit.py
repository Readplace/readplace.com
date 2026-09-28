#!/usr/bin/env python3
"""
token_usage_audit.py - where do Claude Code tokens (and dollars) go in this repository?

WHAT
  Audits Claude Code's local data for every local clone of the git repository it is run
  from (any language, any layout) and writes a compact, privacy-safe digest that Claude
  turns into concrete fixes (CLAUDE.md rules, skills, hooks, settings):
    - transcripts  <config>/projects/<enc>/<session>.jsonl and <session>/subagents/**/agent-*.jsonl
    - history      <config>/history.jsonl (prompts only; survives transcript cleanup)
    - memory       <config>/projects/<enc>/memory/*.md (names and sizes)
    - config       CLAUDE.md / CLAUDE.local.md / .claude/rules, skills, agents, hooks,
                   .claude/settings*.json and ~/.claude/settings.json
  Deterministic heuristics H00-H19 (retention, long-context loops, oversized injections,
  repeated procedures, ignored skills, corrections, memory divergence, model switches,
  cache rebuilds, effort, subagents, error loops, re-exploration, fixed overhead, acks and
  interrupts, images, web/MCP bloat, permissions, command boilerplate, verbosity) each
  produce at most one finding with an estimated $/month, a confidence label
  (measured | extrapolated | heuristic) and <= 3 redacted evidence items.

HOW
  1. Clone discovery: normalized remote URLs, root-commit fingerprint with a repo-name
     check, worktrees, submodules, subdirectory sessions, deleted clones recorded in
     .claude.json githubRepoPaths or history, per-file cwd attribution ($CLAUDE_CONFIG_DIR
     and ~/.claude are both scanned).
  2. Transcripts are streamed line by line in binary (a partial last line of a live file
     and malformed lines are skipped). Split assistant records are deduped per API response:
     group by message.id -> requestId -> uuid and keep the usage with the largest
     output_tokens; <synthetic> and API-error records are ignored.
  3. Cost = embedded $/MTok table (longest model-id prefix; [1m] and date suffixes are
     stripped; unknown models use the claude-opus-5 row and are flagged). cost-state
     totals are reported next to the transcript-derived totals and preferred when present.
  4. Monthly estimates: window cost x month_factor, where month_factor =
     sessions_per_month / transcript_sessions and sessions_per_month comes from history
     (last 90 days, or --since-days) or the transcript window. History-based findings use
     the history period as their "window".
  5. history.jsonl prompts are clustered (normalization, shingles, rare-shingle blocking,
     Jaccard, union-find); corrections are clustered separately at a lower threshold.
  6. The digest is shed in a fixed order until it fits --max-digest-chars; every cap and
     shed step is listed in digest["limits"] (nothing is truncated silently).

USAGE
  python3 token_usage_audit.py                   # audit the repo containing the CWD
  python3 token_usage_audit.py --repo DIR --out DIR --since-days 90
  python3 token_usage_audit.py --clones-only     # clone table only (+ clones.json)
  python3 token_usage_audit.py --explain H02     # <= 2000 chars of redacted context (or c3)
  Exit codes: 0 ok, 1 fatal error, 2 usage error.

OUTPUT (--out, default <repo>/.claude/token-usage-audit/<YYYYMMDD-HHMMSS>/, git-ignored
through <repo>/.claude/token-usage-audit/.gitignore)
  digest.json   schema token-usage-audit/digest@1 - the only file Claude needs to read
  clones.json   full clone-finder result
  summary.txt   same text as stdout

PRIVACY
  Excerpts come only from human prompts, tool_use inputs (commands, paths, URLs) and first
  error lines - never from tool output, pasted content, thinking or file contents. Secrets
  and emails are redacted, $HOME -> "~", clone roots -> ".", excerpts are <= 200 chars.
  All inputs are opened read-only; the only subprocess is git (read-only commands, with
  timeouts, no prompts, GIT_* environment scrubbed). No network access.

Standard library only; Python 3.8+ on macOS and Linux.
"""
import argparse
import calendar
import collections
import concurrent.futures
import glob
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
from functools import lru_cache
from urllib.parse import unquote, urlsplit

# =============================================================================
# Constants (tune here)
# =============================================================================
VERSION = "1.0.0"
SCHEMA = "token-usage-audit/digest@1"

# $ per million tokens. Longest matching prefix wins (after stripping "[1m]" and dates).
PRICE_TABLE_ID = "2026-09"
_OPUS_5 = {"in": 5.0, "out": 25.0, "read": 0.50, "w5m": 6.25, "w1h": 10.0}
PRICES = {
    "claude-opus-5-5": {"in": 4.0, "out": 20.0, "read": 0.20, "w5m": 5.0, "w1h": 8.0},
    "claude-opus-5": dict(_OPUS_5),
    "claude-opus-4-8": dict(_OPUS_5),
    "claude-opus-4-7": dict(_OPUS_5),
    "claude-opus-4-6": dict(_OPUS_5),
    "claude-opus-4-5": dict(_OPUS_5),
    "claude-sonnet-5": {"in": 2.0, "out": 10.0, "read": 0.20, "w5m": 2.5, "w1h": 4.0},
    "claude-sonnet-4-6": {"in": 3.0, "out": 15.0, "read": 0.30, "w5m": 3.75, "w1h": 6.0},
    "claude-haiku-4-5": {"in": 1.0, "out": 5.0, "read": 0.10, "w5m": 1.25, "w1h": 2.0},
    "claude-fable-5-1": {"in": 10.0, "out": 50.0, "read": 0.25, "w5m": 12.5, "w1h": 20.0},
    "claude-fable-5": {"in": 10.0, "out": 50.0, "read": 1.00, "w5m": 12.5, "w1h": 20.0},
}
FALLBACK_PRICE_MODEL = "claude-opus-5"
CHEAP_MODEL = "claude-haiku-4-5"
FAST_MODE_MULTIPLIER = 2.0          # usage.speed == "fast": Opus 5 / 5.5 fast mode is 2x standard

# Parsing and calibration
LIVE_WINDOW_S = 120                 # transcript modified this recently -> probably live
DEFAULT_CHARS_PER_TOKEN = 2.0       # measured median 1.97 from single-tool context deltas
CPT_BOUNDS = (1.5, 4.5)
CPT_MIN_SAMPLES = 5
CPT_MIN_RESULT_CHARS = 1000
RESET_RATIO = 0.7                   # next call's context < 70% of previous -> compaction/clear
HISTORY_MATCH_S = 60                # transcript prompt <-> history row timestamp tolerance
HIST_RATE_DAYS = 90                 # history window for per-month rates
HIST_MIN_RECENT_ROWS = 20           # fewer recent rows -> use the full history span
DEFAULT_CTX = 60000                 # context median when nothing was measured
DEFAULT_CALLS_PER_PROMPT = 6
DEFAULT_CALLS_PER_SESSION = 20
DEFAULT_CW_SHARE = 0.3
IMAGE_TOKENS = 1600
PASTE_TOKENS_PER_LINE = 12
PROMPT_HEAD_CHARS = 2000            # prompt text kept in memory (classification, excerpts)
PROMPT_RAW_EXCERPT_MAX = 1000       # longer transcript prompts may hold pastes: shape only
SHAPE_MIN_CHARS = 3000
ARG_KEEP_CHARS = 600
TEXT_READ_LIMIT = 1 << 20
WALK_MAX_DIRS = 20000
SKIP_LINE_PREFIXES = (b'{"type":"file-history-snapshot"', b'{"type":"file-history-delta"')

# Heuristic thresholds
H00_MIN_COVERAGE = 0.2
C_LONG, C_TARGET = 100000, 50000
H01_MAX_CTX, H01_LONG_CALLS, H01_CALLS_PER_PROMPT = 150000, 20, 25
H01_TOPIC_CTX, H01_TOPIC_JACCARD, H01_AVOIDABLE = 80000, 0.1, 0.5
T_BIG_TOOL, T_HUGE_TOOL, T_KEEP_TOOL = 2500, 10000, 500
T_BIG_PASTE, PASTE_BIG_LINES, T_KEEP_PASTE = 1500, 150, 300
T_WHOLE_READ = 2000
HOOK_MIN_SESSIONS = 3
CLUSTER_JACCARD, CORRECTION_JACCARD = 0.5, 0.4
LONG_PROMPT_TOKENS = 60
BLOCK_KEYS, BLOCK_MAX_POSTINGS = 4, 400
CLUSTER_DIGEST_MIN_N = 3
MEDOID_SAMPLE = 50
H03_MIN_N, H03_MIN_SESSIONS, H03_MIN_CLONES = 5, 3, 2
CHAIN_MIN_SESSIONS = 5
CALLS_WITH_SKILL, REDO_CALLS = 2, 3
H04_MIN_N, H04_MIN_SESSIONS = 3, 2
H05_MIN_N, H05_MIN_SESSIONS = 3, 2
H05_DEFAULT_WASTED, H05_DEFAULT_REDO = 3, 2
COVERAGE_MIN_SCORE, COVERAGE_MIN_OVERLAP = 0.3, 2
MEMORY_DUP_JACCARD, MEMORY_COVERED = 0.5, 0.5
H07_MIN_SESSION_SHARE = 0.10
MISS_MIN_PREV_CTX, MISS_READ_RATIO = 10000, 0.5
TTL_1H_S, TTL_5M_S = 3600, 300
MISS_AVOIDABLE = {"idle>ttl": 0.7, "tools_changed": 0.5, "effort_change": 0.5,
                  "model_switch": 0.0, "compaction": 0.0, "unknown": 0.0}
H08_SESSION_SHARE = 0.10
H09_HIGH_EFFORTS = ("xhigh", "max")
H09_SMALL_CALLS, H09_THINK_SHARE, H09_USD_SHARE, H09_MIN_TASKS = 3, 0.5, 0.3, 3
H10_EXPLORE_TOKENS = 30000
H11_LOOP_MIN, H11_LOOP_WINDOW, H11_LOOP_JACCARD, H11_MIN_SESSIONS = 3, 10, 0.6, 3
H12_START_CALLS, H12_HOT_SESSIONS, H12_HOT_SHARE, H12_REREADS, H12_AVOIDABLE = 8, 3, 0.25, 3, 0.7
H13_SKILL_USED_SHARE, H13_SKILL_SESSIONS, H13_MCP_SESSIONS = 0.25, 20, 10
H13_CLAUDE_MD_TOKENS, H13_GIT_STATUS_TOKENS = 2500, 1000
H14_ACK_RATE, H14_INTERRUPTS_PER_SESSION = 0.05, 0.1
H15_MIN_IMAGES, H16_MIN_TOKENS = 5, 5000
H17_MIN_REJECTIONS, H17_MIN_SESSIONS = 3, 2
H18_MIN_PREFIXES = 200
H19_P50_TOKENS, H19_TARGET_TOKENS = 600, 300
MIN_FINDING_USD_MONTH = 0.05

# Digest size and caps
MAX_DIGEST_CHARS = 60000
EXCERPT_CHARS, SHORT_CHARS = 200, 120
MAX_LIMITS_LINES = 40
EXPLAIN_MAX_CHARS = 2000
CAPS = {"clones": 20, "findings": 20, "evidence": 3, "sessions_top": 15, "prompt_clusters": 30,
        "prompt_chains": 10, "slash": 15, "cache_events": 20, "tools": 12, "heads": 8,
        "error_loops": 10, "hot_paths": 20, "rereads": 10, "subagents": 10, "promotable": 15,
        "sections": 15, "names": 20, "unknown": 10, "by_model": 6, "metric": 6}

# =============================================================================
# Small utilities
# =============================================================================
CASE_INSENSITIVE_FS = sys.platform in ("darwin", "win32")
_TS_RE = re.compile(r"^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(\.\d+)?(Z|[+-]\d\d:?\d\d)?$")


def parse_ts(v):
    """ISO-8601 string or epoch (seconds or milliseconds) -> epoch seconds, else None."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v / 1000.0 if v > 1e11 else float(v)
    m = _TS_RE.match(v.strip()) if isinstance(v, str) else None
    if not m:
        return None
    try:
        epoch = calendar.timegm(tuple(int(m.group(i)) for i in range(1, 7)) + (0, 0, 0))
    except (ValueError, OverflowError):
        return None
    tz = m.group(8)
    if tz and tz != "Z":
        digits = tz[1:].replace(":", "")
        epoch -= (1 if tz[0] == "+" else -1) * (int(digits[:2]) * 3600 + int(digits[2:]) * 60)
    return epoch + (float(m.group(7)) if m.group(7) else 0.0)


def iso_day(t):
    return time.strftime("%Y-%m-%d", time.gmtime(t)) if t else None


def iso_min(t):
    return time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(t)) if t else None


def percentile(values, q):
    v = sorted(values)
    if not v:
        return None
    return v[min(len(v) - 1, max(0, int(round(q * (len(v) - 1)))))]


def median(values, default=None):
    p = percentile(values, 0.5)
    return default if p is None else p


def rnd(x, n=2):
    return None if x is None else round(float(x), n)


def load_json(path):
    try:
        with open(path, "rb") as fh:
            return json.loads(fh.read().decode("utf-8", "replace"))
    except (OSError, ValueError):
        return None


def read_text(path, limit=TEXT_READ_LIMIT):
    try:
        with open(path, "rb") as fh:
            return fh.read(limit).decode("utf-8", "replace")
    except OSError:
        return None


def iter_jsonl(path, stats=None):
    """Yield dict records line by line, in binary (never the whole file). A last line
    without a newline is still being written (live session) and is skipped; malformed
    lines are counted in stats["bad"] and skipped."""
    try:
        fh = open(path, "rb")
    except OSError:
        if stats is not None:
            stats["unreadable"] += 1
        return
    with fh:
        for line in fh:
            if not line.endswith(b"\n"):
                if line.strip() and stats is not None:
                    stats["partial"] += 1
                break
            if len(line) < 3 or line.startswith(SKIP_LINE_PREFIXES):
                continue
            try:
                r = json.loads(line)
            except ValueError:
                if stats is not None:
                    stats["bad"] += 1
                continue
            if isinstance(r, dict):
                yield r


def _norm(p):
    """Absolute, normalized path; never touches the filesystem."""
    return os.path.normpath(os.path.abspath(os.path.expanduser(p)))


def _real(p):
    """realpath() for existing paths (resolves /tmp -> /private/tmp and symlinks)."""
    p = _norm(p)
    try:
        return os.path.realpath(p) if os.path.exists(p) else p
    except OSError:
        return p


def _k(p):
    """Path comparison key: default macOS/Windows volumes are case-insensitive."""
    return p.casefold() if CASE_INSENSITIVE_FS else p


def _within(child, root):
    """True when child == root or child lives under root (component-wise)."""
    c, r = _k(child), _k(root).rstrip(os.sep)
    return c == r or c.startswith(r + os.sep) or r == ""


def in_clone(path, root, roots):
    """path belongs to clone `root` and not to a deeper clone nested inside it."""
    if not _within(path, root):
        return False
    return not any(len(o) > len(root) and _within(o, root) and _within(path, o) for o in roots)


# Text normalization shared by clustering, coverage matching and error-loop detection.
_WORD_RE = re.compile(r"[a-z_][a-z0-9_'\-]*")
STOPWORDS = frozenset(
    "the a an to of and or in on for is it this that be with as at by from are was i you me my "
    "we can could should would please just now also then so do does make sure".split())
_NORM_SUBS = (
    (re.compile(r"\[pasted text #\d+[^\]]*\]"), " zpaste "),
    (re.compile(r"\[image #\d+\]"), " zimg "),
    (re.compile(r"https?://\S+"), " zurl "),
    (re.compile(r"(?:~|\.{1,2})?(?:/[\w.\-@]+){2,}/?"), " zpath "),
    (re.compile(r"\b[0-9a-f]{7,40}\b"), " zsha "),
    (re.compile(r"#\d+|\b\d+(?:\.\d+)?\b"), " znum "),
)


def norm_tokens(text, limit=4000):
    s = (text or "")[:limit].lower()
    for rx, rep in _NORM_SUBS:
        s = rx.sub(rep, s)
    return [t for t in _WORD_RE.findall(s) if t not in STOPWORDS]


def shingles(toks):
    """Unigrams + bigrams; long prompts use word trigrams to catch edited templates."""
    if len(toks) > LONG_PROMPT_TOKENS:
        return frozenset(" ".join(toks[i:i + 3]) for i in range(len(toks) - 2))
    return frozenset(toks) | frozenset(a + " " + b for a, b in zip(toks, toks[1:]))


def jaccard(a, b):
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / float(len(a) + len(b) - inter)


_NEGATIONS = frozenset(("not", "never", "don't", "dont", "no", "avoid", "stop"))


def _canon_negations(toks):
    """"do not X", "never X" and "don't X" state the same rule: fold them into one token."""
    return {"zneg" if t in _NEGATIONS else t for t in toks}


def overlap(a, b):
    """Overlap coefficient |A & B| / min(|A|, |B|)."""
    return len(a & b) / float(min(len(a), len(b))) if a and b else 0.0


# =============================================================================
# Privacy: redaction of every excerpt that reaches the digest or stdout
# =============================================================================
_SECRET_SUBS = (
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)", re.S),
     "[REDACTED-KEY]"),
    (re.compile(r"\b(?:sk|rk|pk)-[A-Za-z0-9_\-]{10,}"), "[REDACTED]"),
    (re.compile(r"\bgh[pousr]_\w{20,}"), "[REDACTED]"),
    (re.compile(r"\bgithub_pat_\w{20,}"), "[REDACTED]"),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "[REDACTED]"),
    (re.compile(r"\bxox[abposr]-[\w-]+"), "[REDACTED]"),
    (re.compile(r"\beyJ[\w-]{10,}\.[\w-]*(?:\.[\w-]*)?"), "[REDACTED-JWT]"),
    (re.compile(r"(?i)\b(bearer|basic)\s+[\w\-.=+/]{10,}"), r"\1 [REDACTED]"),
    (re.compile(r"(?i)(--?(?:password|passwd|token|api-key|apikey|secret)[= ])\S+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)\b([\w-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|credential)s?)"
                r"(\s*[=:]\s*)(['\"]?)[^\s'\"&,;]+\3"), r"\1\2[REDACTED]"),
    (re.compile(r"(://)[^/\s:@]+:[^/\s@]+@"), r"\1[REDACTED]@"),
    (re.compile(r"\b(?=[A-Za-z0-9+]*\d)(?=[A-Za-z0-9+]*[A-Z])(?=[A-Za-z0-9+]*[a-z])[A-Za-z0-9+]{32,}={0,2}"),
     "[BLOB]"),
    (re.compile(r"\b[0-9a-fA-F]{48,}\b"), "[BLOB]"),
    (re.compile(r"(?<![\w.+-])(?!git@)[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[EMAIL]"),
)


class Redactor(object):
    """Replaces clone roots with ".", $HOME with "~", secrets and emails with markers,
    collapses whitespace and truncates."""

    def __init__(self, home, roots):
        pairs = sorted([(r, ".") for r in roots if r and r != os.sep] + [(home, "~")],
                       key=lambda p: -len(p[0]))
        flags = re.I if CASE_INSENSITIVE_FS else 0
        self._paths = [(re.compile(re.escape(p.rstrip(os.sep)) + r"(?=[/\s'\"`:;,)\]}]|$)", flags), rep)
                       for p, rep in pairs]

    def __call__(self, text, limit=EXCERPT_CHARS):
        if text is None:
            return ""
        s = re.sub(r"\s+", " ", str(text)[:limit * 40]).strip()
        if len(s) > limit * 8:                      # drop a word cut in half by the pre-cut
            s = s[:limit * 8].rsplit(" ", 1)[0]
        for rx, rep in self._paths:
            s = rx.sub(rep, s)
        for rx, rep in _SECRET_SUBS:
            s = rx.sub(rep, s)
        return s if len(s) <= limit else s[:limit - 1].rstrip() + "\u2026"


# =============================================================================
# Pricing
# =============================================================================
_PRICE_KEYS = {"in": "in", "input": "in", "out": "out", "output": "out", "read": "read",
               "cache_read": "read", "w5m": "w5m", "write_5m": "w5m", "w1h": "w1h", "write_1h": "w1h"}


def load_prices(path):
    """Embedded table, optionally merged with a JSON override {model_prefix: {in,out,read,w5m,w1h}}."""
    table = {k: dict(v) for k, v in PRICES.items()}
    if not path:
        return table
    data = load_json(path)
    if not isinstance(data, dict):
        raise UsageError("--prices %s: not a JSON object" % path)
    for model, row in data.items():
        if not isinstance(row, dict):
            raise UsageError("--prices %s: %s must map to an object" % (path, model))
        base = dict(table.get(model, table[FALLBACK_PRICE_MODEL]))
        for k, v in row.items():
            if _PRICE_KEYS.get(k) is None or not isinstance(v, (int, float)):
                raise UsageError("--prices %s: bad key/value %s=%r" % (path, k, v))
            base[_PRICE_KEYS[k]] = float(v)
        table[model.lower()] = base
    return table


class Pricer(object):
    def __init__(self, table):
        self.table = table
        self._order = sorted(table, key=len, reverse=True)
        self.guessed = set()

    @staticmethod
    def normalize(model):
        m = re.sub(r"\[.*?\]", "", (model or "").lower()).strip()
        i = m.find("claude-")
        m = m[i:] if i >= 0 else m
        m = re.sub(r"(?:@|-)\d{8}.*$", "", m)          # dated snapshots / Vertex "@date"
        return re.sub(r"-v\d+(?::\d+)?$", "", m)        # Bedrock "-v1:0"

    @lru_cache(maxsize=None)
    def rates(self, model):
        n = self.normalize(model)
        for p in self._order:
            if n == p or n.startswith(p + "-"):
                if n != p:
                    self.guessed.add(model)
                return self.table[p]
        self.guessed.add(model or "unknown")
        return self.table[FALLBACK_PRICE_MODEL]


# =============================================================================
# Git (the only subprocess) and clone discovery
# =============================================================================
MAX_ENCODED_LEN = 200               # project dir names longer than this get "-<hash>"
HEAD_SCAN_LIMIT = 4 << 20
TEXT_SCAN_LIMIT, TEXT_SCAN_TOTAL = 64 << 20, 512 << 20
GIT_TIMEOUT_S = 15.0
HOST_ALIASES = {
    "www.github.com": "github.com", "ssh.github.com": "github.com",
    "altssh.gitlab.com": "gitlab.com", "altssh.bitbucket.org": "bitbucket.org",
    "ssh.dev.azure.com": "dev.azure.com", "vs-ssh.visualstudio.com": "dev.azure.com",
}
_CWD_RE = re.compile(rb'"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"')
_SCP_RE = re.compile(r"^(?:[^@/\s]+@)?(?P<host>[^:/\s]+):(?P<path>.+)$")
CONFIDENCE_ORDER = ("verified", "recorded", "probable", "unverified")


class UsageError(Exception):
    """Bad invocation (exit code 2)."""


def encode_project_dir(path):
    """Claude Code's project-dir name: every non-alphanumeric char -> "-" (JS UTF-16:
    astral characters such as emoji become two dashes)."""
    return "".join(ch if (ch.isascii() and ch.isalnum()) else "-" * (2 if ord(ch) > 0xFFFF else 1)
                   for ch in path)


def dir_name_matches(name, path):
    enc = encode_project_dir(path)
    if len(enc) <= MAX_ENCODED_LEN:
        return _k(name) == _k(enc)
    return _k(name).startswith(_k(enc[:MAX_ENCODED_LEN]) + "-")


def _enc_key(enc):
    return _k(enc[:MAX_ENCODED_LEN]) if len(enc) > MAX_ENCODED_LEN else _k(enc)


def _enc_related(dir_name, root):
    """Necessary condition for a project dir to hold sessions at, below or above root."""
    e, d = _k(encode_project_dir(root)), _k(dir_name)
    if len(d) > MAX_ENCODED_LEN:
        d = d[:MAX_ENCODED_LEN]
        return e.startswith(d) or d.startswith(e + "-")
    return d == e or d.startswith(e + "-") or e.startswith(d + "-")


def decode_project_dir(name, max_nodes=5000):
    """Last resort: walk the filesystem for paths whose encoding equals `name`.
    Returns (exact_matches, best_guess_or_None)."""
    if not name.startswith("-"):
        return [], None
    exact, best, stack, nodes = [], ("/", name[1:]), [("/", name[1:])], 0
    while stack and nodes < max_nodes:
        cur, rest = stack.pop()
        nodes += 1
        if len(rest) < len(best[1]):
            best = (cur, rest)
        if not rest:
            exact.append(cur)
            continue
        try:
            entries = os.listdir(cur)
        except OSError:
            continue
        for e in entries:
            ee = _k(encode_project_dir(e))
            full = os.path.join(cur, e)
            if _k(rest) == ee:
                exact.append(full)
            elif _k(rest).startswith(ee + "-") and os.path.isdir(full):
                stack.append((full, rest[len(ee) + 1:]))
    guess = None
    if not exact and best[1] and len(name) <= MAX_ENCODED_LEN:
        guess = os.path.join(best[0], best[1])
    return exact, guess


def find_git_toplevel(path):
    """Walk up to the nearest ".git" (dir = clone, file = worktree/submodule).
    Returns (toplevel or None, path_exists)."""
    p = _norm(path)
    exists = os.path.exists(p)
    while not os.path.exists(p):
        parent = os.path.dirname(p)
        if parent == p:
            return None, False
        p = parent
    p = _real(p)
    while True:
        if os.path.exists(os.path.join(p, ".git")):
            return p, exists
        parent = os.path.dirname(p)
        if parent == p:
            return None, exists
        p = parent


def normalize_remote(url, base_dir=""):
    """Remote URL -> comparable tuple without credentials, port, ".git" and case:
    ("net", host, "org/repo") or ("file", "", realpath). None if unusable."""
    u = (url or "").strip()
    if not u:
        return None
    if "://" in u:
        s = urlsplit(u)
        if s.scheme.lower() == "file":
            return ("file", "", _real(unquote(s.path)))
        host, path = (s.hostname or "").lower(), unquote(s.path)
    elif u.startswith(("/", "./", "../", "~")) or u in (".", ".."):
        return ("file", "", _real(os.path.join(base_dir, os.path.expanduser(u))))
    else:
        m = _SCP_RE.match(u)
        if not m or os.sep in m.group("host"):
            return ("file", "", _real(os.path.join(base_dir, u)))
        host, path = m.group("host").lower(), m.group("path")
    host = HOST_ALIASES.get(host, host)
    path = path.strip("/")
    if path.lower().endswith(".git"):
        path = path[:-4].rstrip("/")
    path = path.lower()
    if host.endswith(".visualstudio.com"):
        path, host = host.split(".")[0] + "/" + path, "dev.azure.com"
    if host == "dev.azure.com":
        path = re.sub(r"^v3/", "", path).replace("/_git/", "/")
    if not host.endswith("bitbucket.org") and path.startswith("scm/"):
        path = path[4:]
    return ("net", host, path) if path else None


def _is_ssh_alias(host):
    """~/.ssh/config aliases such as "github-work" have no dot; match them by path."""
    return "." not in host and host != "localhost"


def remotes_match(a, b):
    if a[0] != b[0]:
        return False
    if a[0] == "file":
        return _k(a[2]) == _k(b[2])
    return a[2] == b[2] and (a[1] == b[1] or _is_ssh_alias(a[1]) or _is_ssh_alias(b[1]))


def _remote_label(r):
    return r[2] if r[0] == "file" else "%s/%s" % (r[1], r[2])


def _repo_name(r):
    name = os.path.basename(r[2].rstrip("/"))
    return (name[:-4] if name.lower().endswith(".git") else name).lower()


class Git(object):
    """Runs read-only git commands with a timeout, no prompts, no fsmonitor, and an
    environment scrubbed of every GIT_* variable (hooks export GIT_DIR & co)."""

    def __init__(self, timeout=GIT_TIMEOUT_S):
        self.timeout, self.calls, self.warnings = timeout, 0, []
        self._lock = threading.Lock()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.env.update(GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0", LC_ALL="C")

    def __call__(self, cwd, *args):
        with self._lock:
            self.calls += 1
        try:
            r = subprocess.run(["git", "-C", cwd, "-c", "core.fsmonitor=false"] + list(args),
                               stdin=subprocess.DEVNULL, capture_output=True, text=True,
                               timeout=self.timeout, env=self.env)
        except FileNotFoundError:
            raise RuntimeError("git executable not found on PATH")
        except subprocess.TimeoutExpired:
            self.warnings.append("git %s timed out in %s" % (args[0], cwd))
            return None
        if r.returncode != 0:
            if "dubious ownership" in r.stderr:
                self.warnings.append("git refused %s (safe.directory)" % cwd)
            return "" if (r.returncode == 1 and args[0] == "config") else None
        return r.stdout


def _identity(git, top):
    """One rev-parse and one config call per toplevel; root commits are filled lazily."""
    out = git(top, "rev-parse", "--git-common-dir", "--is-shallow-repository",
              "--show-superproject-working-tree")
    if out is None:
        return None
    lines = out.splitlines()
    common = _real(os.path.join(top, lines[0])) if lines else os.path.join(top, ".git")
    remotes = []
    for line in (git(top, "config", "--get-regexp", r"^remote\..*\.(url|pushurl)$") or "").splitlines():
        parts = line.split(None, 1)
        r = normalize_remote(parts[1], top) if len(parts) == 2 else None
        if r and r not in remotes:
            remotes.append(r)
    return {"top": top, "common_dir": common,
            "shallow": len(lines) > 1 and lines[1].strip() == "true",
            "superproject": _real(lines[2]) if len(lines) > 2 and lines[2].strip() else None,
            "remotes": remotes, "roots": None}


def _roots(git, ident):
    """Root commit(s) of HEAD; shallow clones (graft boundary) and empty repos give none."""
    if ident["roots"] is None:
        out = None if ident["shallow"] else git(ident["top"], "rev-list", "--max-parents=0", "HEAD")
        ident["roots"] = frozenset((out or "").split())
    return ident["roots"]


def _local_targets(ident):
    c = ident["common_dir"]
    return {_k(ident["top"]), _k(c), _k(os.path.dirname(c))}


def claude_config_dirs(extra=None):
    """Explicit --config-dir values, else $CLAUDE_CONFIG_DIR and ~/.claude (both, when
    they differ)."""
    raw = list(extra) if extra else [os.environ.get("CLAUDE_CONFIG_DIR"), "~/.claude"]
    out, seen = [], set()
    for d in raw:
        if d and os.path.isdir(_norm(d)) and _k(_real(d)) not in seen:
            seen.add(_k(_real(d)))
            out.append(_real(d))
    return out


def _global_config_files(cfg_dir):
    """.claude.json lives inside $CLAUDE_CONFIG_DIR, but next to (not in) ~/.claude."""
    files = [os.path.join(cfg_dir, ".claude.json")]
    if _k(cfg_dir) == _k(_real("~/.claude")):
        files.append(_norm("~/.claude.json"))
    return [f for f in files if os.path.isfile(f)]


def scan_cwds(path, first_only=True, limit=HEAD_SCAN_LIMIT):
    """Distinct "cwd" values of a transcript in file order via a byte regex (cheap)."""
    found, seen, tail, read = [], set(), b"", 0
    try:
        with open(path, "rb") as fh:
            while limit is None or read < limit:
                chunk = fh.read(1 << 16)
                if not chunk:
                    break
                read += len(chunk)
                buf = tail + chunk
                for m in _CWD_RE.finditer(buf):
                    raw = m.group(1)
                    if raw in seen:
                        continue
                    seen.add(raw)
                    try:
                        found.append(_norm(json.loads(b'"' + raw + b'"')))
                    except ValueError:
                        continue
                    if first_only:
                        return found
                tail = buf[-4096:]
    except OSError:
        pass
    return found


def _file_contains(path, needles, budget):
    """Case-insensitive search for any needle (lowercase bytes) within a byte budget."""
    tail = b""
    try:
        with open(path, "rb") as fh:
            while budget[0] > 0:
                chunk = fh.read(1 << 20)
                if not chunk:
                    return False
                budget[0] -= len(chunk)
                buf = (tail + chunk).lower()
                if any(n in buf for n in needles):
                    return True
                tail = buf[-256:]
    except OSError:
        pass
    return False


def list_transcripts(pdir):
    """(path, kind, session_id): main transcripts first, then subagent transcripts."""
    main, sub = [], []
    try:
        entries = sorted(os.listdir(pdir))
    except OSError:
        return []
    for e in entries:
        full = os.path.join(pdir, e)
        if e.endswith(".jsonl") and os.path.isfile(full):
            main.append((full, "main", e[:-6]))
        elif os.path.isdir(os.path.join(full, "subagents")):
            for root, _dirs, files in os.walk(os.path.join(full, "subagents")):
                for f in sorted(files):
                    if f.endswith(".jsonl") and f.startswith("agent-"):   # never journal.jsonl
                        sub.append((os.path.join(root, f), "subagent", e))
    return main + sub


def find_repo_clones(start_dir, cfgs, history, is_excluded, min_confidence="unverified",
                     git_timeout=GIT_TIMEOUT_S, max_workers=8):
    """Find every local clone of the repository containing start_dir and attribute Claude
    Code data (project dirs, transcripts, history counts) to each clone.
    history: rows from load_history(). is_excluded(session_id) -> bool.
    Returns {self, clones, related, excluded, config_dirs, warnings, stats}; confidence:
    verified (git) > recorded (githubRepoPaths) > probable > unverified."""
    t0 = time.time()
    git = Git(git_timeout)
    start = _real(start_dir or os.getcwd())
    self_top, _ = find_git_toplevel(start)
    if not self_top:
        raise UsageError("%s is not inside a git repository" % start)

    # --- A. candidate paths ------------------------------------------------------------
    cands = {}

    def add(path, source, sid=None, ts=None):
        if not path or not os.path.isabs(os.path.expanduser(path)):
            return None
        p = _norm(path)
        c = cands.setdefault(_k(p), {"path": p, "sources": set(), "sessions": set(), "prompts": 0,
                                      "first": None, "last": None})
        c["sources"].add(source)
        if sid:
            c["sessions"].add(sid)
        if ts:
            c["first"] = min(c["first"] or ts, ts)
            c["last"] = max(c["last"] or ts, ts)
        return c

    for r in history:
        c = add(r["p"], "history", r["s"], r["ts"])
        if c:
            c["prompts"] += 1
    gh_map, pdirs = {}, []
    for cfg in cfgs:
        for gf in _global_config_files(cfg):
            g = load_json(gf)
            if not isinstance(g, dict):
                continue
            for p in (g.get("projects") or {}):
                add(p, "config.projects")
            for slug, paths in (g.get("githubRepoPaths") or {}).items():
                for p in paths or []:
                    if isinstance(p, str):
                        gh_map.setdefault(slug.lower(), []).append(_norm(p))
                        add(p, "config.githubRepoPaths")
        sdir = os.path.join(cfg, "sessions")
        for f in (sorted(os.listdir(sdir)) if os.path.isdir(sdir) else []):
            if f.endswith(".json"):                      # never read the *.key files
                s = load_json(os.path.join(sdir, f))
                if isinstance(s, dict) and isinstance(s.get("cwd"), str):
                    add(s["cwd"], "live-session", s.get("sessionId"))
        proot = os.path.join(cfg, "projects")
        for name in (sorted(os.listdir(proot)) if os.path.isdir(proot) else []):
            full = os.path.join(proot, name)
            if not os.path.isdir(full):
                continue
            pd = {"name": name, "dir": full, "launch": set(), "index": {}, "guess": None}
            ix = load_json(os.path.join(full, "sessions-index.json"))
            if isinstance(ix, dict):
                if isinstance(ix.get("originalPath"), str):
                    add(ix["originalPath"], "sessions-index")
                    pd["launch"].add(_norm(ix["originalPath"]))
                for e in ix.get("entries") or []:
                    if isinstance(e, dict) and isinstance(e.get("projectPath"), str):
                        add(e["projectPath"], "sessions-index", e.get("sessionId"))
                        if e.get("sessionId"):
                            pd["index"][e["sessionId"]] = _norm(e["projectPath"])
            pdirs.append(pd)

    # Map project dirs to launch paths: exact encoding of a known candidate, else the
    # first cwd of one transcript, else a filesystem-guided decode of the name.
    enc_index = {}
    for c in cands.values():
        enc_index.setdefault(_enc_key(encode_project_dir(c["path"])), []).append(c["path"])
    for pd in pdirs:
        pd["launch"].update(p for p in enc_index.get(_enc_key(pd["name"]), [])
                            if dir_name_matches(pd["name"], p))
        if not pd["launch"]:
            for tpath, _kind, _sid in list_transcripts(pd["dir"])[:1]:
                for cwd in scan_cwds(tpath):
                    if dir_name_matches(pd["name"], cwd):
                        pd["launch"].add(cwd)
                        add(cwd, "transcript-cwd")
        if not pd["launch"]:
            exact, guess = decode_project_dir(pd["name"])
            for p in exact:
                pd["launch"].add(_norm(p))
                add(p, "decoded-dir-name")
            if guess:
                pd["guess"] = _norm(guess)
                add(guess, "decoded-dir-name-guess")

    # --- B. fingerprint each distinct existing toplevel once -------------------------
    top_of = {kp: find_git_toplevel(c["path"]) for kp, c in cands.items()}
    tops = {self_top} | {t for t, _e in top_of.values() if t}
    with concurrent.futures.ThreadPoolExecutor(max_workers) as pool:
        idents = dict(zip(tops, pool.map(lambda t: _identity(git, t), tops)))
    idents = {t: i for t, i in idents.items() if i}
    if self_top not in idents:
        raise RuntimeError("git could not read %s" % self_top)
    me = idents[self_top]
    for line in (git(self_top, "worktree", "list", "--porcelain") or "").splitlines():
        if line.startswith("worktree "):
            wt = _norm(line[9:])
            add(wt, "git-worktree")
            top_of[_k(wt)] = find_git_toplevel(wt)
            t = top_of[_k(wt)][0]
            if t and t not in idents and top_of[_k(wt)][1]:
                i = _identity(git, t)
                if i:
                    idents[t] = i

    # --- C. grow the "same repo" group to a fixpoint ----------------------------------
    group, related = {self_top: ("self", [])}, []

    def strong_relation(i):
        for t in group:
            m = idents[t]
            if _k(i["common_dir"]) == _k(m["common_dir"]):
                return "worktree", ["shares git dir with " + t]
            for a in i["remotes"]:
                for b in m["remotes"]:
                    if remotes_match(a, b):
                        return "remote", ["remote " + _remote_label(a)]
            if any(r[0] == "file" and _k(r[2]) in _local_targets(m) for r in i["remotes"]) or \
               any(r[0] == "file" and _k(r[2]) in _local_targets(i) for r in m["remotes"]):
                return "local-clone", ["local-path remote to/from " + t]
        return None

    def names(i):
        return {_repo_name(r) for r in i["remotes"]} | {os.path.basename(i["top"]).lower()}

    others = sorted(t for t in idents if t != self_top)
    pending_roots = True
    while True:
        changed = False
        for t in others:
            if t not in group:
                rel = strong_relation(idents[t])
                if rel:
                    group[t] = rel
                    changed = True
        if changed:
            continue
        if not pending_roots:
            break
        with concurrent.futures.ThreadPoolExecutor(max_workers) as pool:
            list(pool.map(lambda t: _roots(git, idents[t]), list(idents)))
        pending_roots = False
        g_roots = frozenset().union(*(_roots(git, idents[t]) for t in group))
        g_names = set().union(*(names(idents[t]) for t, (rel, _e) in group.items() if rel != "worktree"))
        g_has_remote = any(idents[t]["remotes"] for t in group)
        for t in others:
            i = idents[t]
            if t in group or not (i["roots"] & g_roots):
                continue
            if (names(i) & g_names) or not i["remotes"] or not g_has_remote:
                group[t] = ("root-commit", ["same root commit %s" % sorted(i["roots"] & g_roots)[0][:12]])
                changed = pending_roots = True
            elif all(t != r["root"] for r in related):
                related.append({"root": t, "remotes": [_remote_label(r) for r in i["remotes"]],
                                "reason": "same root commit, different repo name (rename, fork "
                                          "under another name, or reused boilerplate?)"})
        if not changed:
            break
    related = [r for r in related if r["root"] not in group]

    excluded = []
    for t in others:                              # submodules count, nested repos do not
        if t in group:
            continue
        host = next((g for g in group if t != g and _within(t, g)), None)
        if host:
            sp = idents[t]["superproject"]
            if sp and _within(sp, host):
                group[t] = ("submodule", ["submodule of " + host])
            else:
                excluded.append({"path": t, "reason": "independent repo nested inside clone " + host})

    # --- D. candidates whose path is gone ---------------------------------------------
    clones = {t: {"root": t, "exists": True, "relation": rel, "confidence": "verified",
                  "evidence": ev, "remotes": [_remote_label(r) for r in idents[t]["remotes"]]}
              for t, (rel, ev) in group.items()}
    path_owner, missing = {}, []
    for kp, c in cands.items():
        top, exists = top_of.get(kp, (None, False))
        if top in group:
            path_owner[kp] = top
            if not exists:
                clones[top]["evidence"].append("missing subdir " + c["path"])
        elif not exists:
            c["inside_other"] = top if top and not any(_within(g, top) for g in group) else None
            missing.append(c)

    core = [t for t, (rel, _ev) in group.items() if rel not in ("submodule", "worktree")]
    slugs = set()
    for t in core:
        for r in idents[t]["remotes"]:
            if r[0] == "net" and (r[1] == "github.com" or _is_ssh_alias(r[1])):
                slugs.add(r[2])
    ours = {_k(p) for s2 in slugs for p in gh_map.get(s2, [])}
    alias_slugs = {s for s, ps in gh_map.items() if s not in slugs and
                   any(_k(p) in ours or any(_within(p, t) for t in core) for p in ps)}
    g_names = set().union(*(names(idents[t]) for t in core))
    g_names |= {s.rsplit("/", 1)[-1] for s in slugs}
    needles = [s.encode() for s in slugs if "/" in s]

    def name_root(path):
        """Shallowest component that looks like a clone by name (faye-app, app-old);
        ancestors of a real clone (/Users/<me>, ~/Git) never count."""
        parts = path.split(os.sep)
        for n_i in range(1, len(parts)):
            prefix = os.sep.join(parts[:n_i + 1]) or os.sep
            if any(_within(t, prefix) for t in core):
                continue
            comp = parts[n_i].lower()
            for n in g_names:
                if len(n) >= 3 and (comp == n or re.search(r"(^|[-_.\s])%s($|[-_.\s])" % re.escape(n), comp)):
                    return prefix
        return None

    recorded_other = {}
    for s, ps in gh_map.items():
        for p in ps:
            recorded_other.setdefault(_k(p), set()).add(s)
    pdir_by_launch = {}
    for pd in pdirs:
        for p in pd["launch"] | ({pd["guess"]} if pd["guess"] else set()):
            pdir_by_launch.setdefault(_k(p), []).append(pd)

    hist_hits = set()
    if missing and needles:
        want = {_k(c["path"]) for c in missing}
        sneedles = [n.decode() for n in needles]
        for r in history:
            if _k(r["p"]) in want and any(n in r["d"].lower() for n in sneedles):
                hist_hits.add(_k(r["p"]))

    ghost, total_budget = {}, [TEXT_SCAN_TOTAL]
    for c in sorted(missing, key=lambda c: len(c["path"])):
        kp, p = _k(c["path"]), c["path"]
        parent = next((g for g in ghost if _within(p, g)), None)
        if parent:
            path_owner[kp] = parent
            continue
        recs = recorded_other.get(kp, set())
        ev, conf = [], None
        if recs & slugs:
            conf, ev = "recorded", ["githubRepoPaths: " + ", ".join(sorted(recs & slugs))]
        elif recs & alias_slugs:
            conf, ev = "recorded", ["githubRepoPaths alias: " + ", ".join(sorted(recs & alias_slugs))]
        nroot = name_root(p)
        if c["inside_other"]:
            if nroot:
                excluded.append({"path": p, "reason": "gone path inside other repo " + c["inside_other"]})
            continue
        text = kp in hist_hits
        if not text and needles and conf is None and not recs:
            budget = [min(TEXT_SCAN_LIMIT, total_budget[0])]
            for pd in pdir_by_launch.get(kp, []):
                files = [t for t, _k2, _s in list_transcripts(pd["dir"])]
                mem = os.path.join(pd["dir"], "memory")
                if os.path.isdir(mem):
                    files += [os.path.join(mem, f) for f in sorted(os.listdir(mem))]
                if any(_file_contains(f, needles, budget) for f in files):
                    text = True
                    break
            total_budget[0] -= min(TEXT_SCAN_LIMIT, total_budget[0]) - budget[0]
        if text:
            ev.append("history/transcripts mention " + " or ".join(sorted(slugs))[:120])
        if nroot:
            ev.append("name matches " + os.path.basename(nroot))
        if conf is None:
            if recs:
                if nroot or text:
                    excluded.append({"path": p, "reason": "recorded as other repo " + ", ".join(sorted(recs))})
                continue
            if text and nroot:
                conf = "probable"
            elif text or nroot:
                conf = "unverified"
            else:
                continue
        root = nroot if (nroot and conf != "recorded") else p
        rec = ghost.get(root)
        if rec is None:
            rec = ghost[root] = {"root": root, "exists": os.path.exists(root), "relation": "path-gone",
                                 "confidence": conf, "evidence": [], "remotes": []}
        if CONFIDENCE_ORDER.index(conf) < CONFIDENCE_ORDER.index(rec["confidence"]):
            rec["confidence"] = conf
        rec["evidence"] = sorted(set(rec["evidence"]) | set(ev))
        path_owner[kp] = root
    max_level = CONFIDENCE_ORDER.index(min_confidence)
    dropped = [g for g, rec in ghost.items() if CONFIDENCE_ORDER.index(rec["confidence"]) > max_level]
    for g in dropped:
        excluded.append({"path": g, "reason": "confidence %s below %s" % (ghost.pop(g)["confidence"],
                                                                          min_confidence)})
    path_owner = {kp: o for kp, o in path_owner.items() if o in clones or o in ghost}
    clones.update(ghost)

    # --- E. attribute Claude data per transcript file ---------------------------------
    for cl in clones.values():
        cl.update(paths=set(), project_dirs=[], transcripts=[],
                  history={"prompts": 0, "sessions": set(), "first": None, "last": None})
    roots = sorted(clones, key=len, reverse=True)

    @lru_cache(maxsize=None)
    def owner(path):
        kp = _k(_norm(path))
        if kp in path_owner:
            return path_owner[kp]
        top, exists = top_of.get(kp) or find_git_toplevel(path)
        if top in clones:
            return top
        r = next((r for r in roots if _within(path, r) or _within(_real(path), r)), None)
        if r and top and exists and _within(top, r) and _k(top) != _k(r):
            return None                      # inside an independent repo nested in a clone
        return r

    for kp, c in cands.items():
        o = owner(c["path"])
        if o:
            cl = clones[o]
            cl["paths"].add(c["path"])
            h = cl["history"]
            h["prompts"] += c["prompts"]
            h["sessions"] |= c["sessions"]
            for key, fn in (("first", min), ("last", max)):
                if c[key]:
                    h[key] = fn(h[key] or c[key], c[key])

    now = time.time()
    for pd in pdirs:
        if not any(_enc_related(pd["name"], r) for r in roots):
            continue
        launch = sorted(pd["launch"]) or ([pd["guess"]] if pd["guess"] else [])
        dir_owner = {owner(p) for p in launch} - {None}
        ancestor = [p for p in launch if any(_within(r, p) and _k(r) != _k(p) for r in roots)]
        by_session, hits = {}, set()
        for tpath, kind, sid in list_transcripts(pd["dir"]):
            if kind == "main" or sid not in by_session:
                if ancestor:
                    cwds = scan_cwds(tpath, first_only=False, limit=None)
                else:
                    cwds = scan_cwds(tpath) or ([pd["index"][sid]] if sid in pd["index"] else [])
                owners = {owner(c) for c in cwds} - {None}
                if not cwds and len(dir_owner) == 1:
                    owners = set(dir_owner)
                if kind == "main":
                    by_session[sid] = (owners, cwds)
            else:
                owners, cwds = by_session[sid]
            try:
                st = os.stat(tpath)
            except OSError:
                continue
            for o in owners:
                clones[o]["transcripts"].append({
                    "path": tpath, "kind": kind, "session_id": sid, "bytes": st.st_size,
                    "mtime": int(st.st_mtime), "current": bool(is_excluded(sid)),
                    "live": now - st.st_mtime < LIVE_WINDOW_S,
                    "partial": bool(ancestor) or any(owner(c) != o for c in cwds)})
                hits.add(o)
        for o in dir_owner | hits:
            if pd["dir"] not in [d["dir"] for d in clones[o]["project_dirs"]]:
                clones[o]["project_dirs"].append({
                    "dir": pd["dir"], "launch": launch,
                    "memory": os.path.isdir(os.path.join(pd["dir"], "memory")),
                    "sessions_index": os.path.isfile(os.path.join(pd["dir"], "sessions-index.json")),
                    "shared_with_other_paths": o not in dir_owner})

    for t in others:
        if t not in group and name_root(t) and not any(e["path"] == t for e in excluded) \
                and all(r["root"] != t for r in related):
            excluded.append({"path": t, "reason": "name looks similar but git identity differs"})

    rank = {c: i for i, c in enumerate(CONFIDENCE_ORDER)}
    result = []
    for cl in sorted(clones.values(), key=lambda c: (c["root"] != self_top, rank[c["confidence"]], c["root"])):
        cl["history"]["sessions"] = len(cl["history"]["sessions"])
        cl["paths"] = sorted(cl["paths"] | {cl["root"]})
        cl["transcripts"].sort(key=lambda x: x["mtime"])
        result.append(cl)
    return {"self": {"root": self_top, "start": start, "remotes": [_remote_label(r) for r in me["remotes"]],
                     "root_commits": sorted(me["roots"] or [])},
            "clones": result, "related": related,
            "excluded": sorted(excluded, key=lambda e: e["path"]),
            "config_dirs": cfgs, "warnings": git.warnings,
            "stats": {"candidates": len(cands), "toplevels": len(idents), "git_calls": git.calls,
                      "project_dirs": len(pdirs), "elapsed_s": round(time.time() - t0, 3)}}


# =============================================================================
# history.jsonl (first-class source: it survives transcript cleanup)
# =============================================================================
PASTE_PH_RE = re.compile(r"\[Pasted text #\d+(?: \+(\d+) lines?)?\]", re.I)
IMAGE_PH_RE = re.compile(r"\[Image #\d+\]", re.I)


def paste_sizes(display, pasted):
    """[(lines, chars or None)] per paste. Content is measured, never kept."""
    phs = [int(m.group(1)) if m.group(1) else None for m in PASTE_PH_RE.finditer(display)]
    entries = [e for e in (pasted.values() if isinstance(pasted, dict) else [])
               if isinstance(e, dict) and e.get("type", "text") == "text"]
    out = []
    for i in range(max(len(phs), len(entries))):
        content = entries[i].get("content") if i < len(entries) else None
        content = content if isinstance(content, str) else None
        lines = phs[i] if i < len(phs) and phs[i] is not None else (
            content.count("\n") + 1 if content else None)
        out.append((lines, len(content) if content is not None else None))
    return out


def load_history(cfgs, stats):
    """Slim rows {d, ts, p, s, pastes, images} from every config dir's history.jsonl."""
    rows = []
    for cfg in cfgs:
        for r in iter_jsonl(os.path.join(cfg, "history.jsonl"), stats):
            p, d = r.get("project"), r.get("display")
            if not isinstance(p, str) or not isinstance(d, str) or not os.path.isabs(os.path.expanduser(p)):
                continue
            rows.append({"d": d, "ts": parse_ts(r.get("timestamp")), "p": _norm(p),
                         "s": str(r.get("sessionId") or ""), "pastes": paste_sizes(d, r.get("pastedContents")),
                         "images": len(IMAGE_PH_RE.findall(d))})
    return rows


ACK_RE = re.compile(r"^(y|yes|yep|yeah|ok|okay|k|go( ahead)?|continue|proceed|do it|sure|next|lgtm|"
                    r"done|thanks|thank you|[1-9]|[a-e])[.! ]*$", re.I)
OPENER_RE = re.compile(r"^(no[,.! ]|no$|nope|don'?t|do not|stop|wrong|that'?s not|not what|i said|"
                       r"i told you|instead( of)?|why did you|you (didn'?t|forgot|missed|should)|undo|revert)",
                       re.I)
CONTAIN_RE = re.compile(r"\b(never|always|don'?t|do not|stop|instead)\b", re.I)
QUESTION_RE = re.compile(r"^(why|what|how|where|when|which|who|is|are|can|could|does)\b", re.I)
SLASH_RE = re.compile(r"^/([A-Za-z][\w:.\-]*)(?:\s+(.*))?$", re.S)


def cluster_docs(shs, weights, threshold):
    """Union-find over candidate pairs found through each doc's rarest shingles."""
    df = collections.Counter()
    for sh, w in zip(shs, weights):
        for t in sh:
            df[t] += w
    inv, keys = collections.defaultdict(list), []
    for i, sh in enumerate(shs):
        k = sorted(sh, key=lambda t: (df[t], t))[:BLOCK_KEYS]
        keys.append(k)
        for t in k:
            inv[t].append(i)
    parent = list(range(len(shs)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, sh in enumerate(shs):
        cand = set()
        for t in keys[i]:
            if len(inv[t]) <= BLOCK_MAX_POSTINGS:
                cand.update(j for j in inv[t] if j > i)
        for j in cand:
            if jaccard(sh, shs[j]) >= threshold:
                parent[find(i)] = find(j)
    groups = collections.defaultdict(list)
    for i in range(len(shs)):
        groups[find(i)].append(i)
    return list(groups.values())


def medoid_and_variants(members, shs, weights, threshold):
    """Medoid = member with max weighted Jaccard to a sample; variants = the 2 members
    farthest from it that still reach the threshold."""
    step = max(1, len(members) // MEDOID_SAMPLE)
    sample = members[::step][:MEDOID_SAMPLE]
    med = max(members, key=lambda i: (sum(weights[j] * jaccard(shs[i], shs[j]) for j in sample), weights[i], -i))
    far = sorted((jaccard(shs[med], shs[j]), j) for j in members if j != med)
    variants = [j for s, j in far if s >= threshold][:2]
    return med, variants


class History(object):
    """history.jsonl rows of the audited clones: classification, clusters, chains,
    corrections, acks, slash commands, pastes, mid-session /model and /effort."""

    def __init__(self, A):
        rows = []
        for r in A.history_all:
            root = A.path_owner.get(_k(r["p"]))
            if not root or A.is_excluded(r["s"]) or (A.cutoff and (r["ts"] or 0) < A.cutoff):
                continue
            rows.append(dict(r, c=root))
        rows.sort(key=lambda r: (r["s"], r["ts"] or 0))
        self.rows = rows
        self.clusters, self.chains = [], []
        self._classify()
        self._set_period(A.now, A.opts.since_days)
        self._sessions()
        self._cluster()
        self._chains()

    def _classify(self):
        for r in self.rows:
            d = r["d"].strip()
            m = SLASH_RE.match(d)
            r["corr"] = r["opener"] = False
            if not d:
                r["k"] = "empty"
            elif m and "/" not in d.split()[0][1:]:
                r["k"], r["cmd"], r["args"] = "slash", "/" + m.group(1).lower(), (m.group(2) or "").strip()[:40]
            elif ACK_RE.match(d):
                r["k"] = "ack"
            else:
                r["k"] = "prompt"
                r["opener"] = bool(OPENER_RE.match(d))
                r["corr"] = r["opener"] or bool(CONTAIN_RE.search(d))

    def _set_period(self, now, since_days):
        ts = [r["ts"] for r in self.rows if r["ts"]]
        start = now - (since_days or HIST_RATE_DAYS) * 86400
        self.end = now
        if not since_days and ts and sum(1 for t in ts if t >= start) < HIST_MIN_RECENT_ROWS:
            start, self.end = min(ts), max(ts)
            self.full_span = True
        else:
            self.full_span = False
        self.start = max(start, min(ts)) if ts else start
        self.days = max(7.0, (self.end - self.start) / 86400.0)

    def in_period(self, r):
        return r["ts"] is not None and self.start <= r["ts"] <= self.end

    def rate(self, rows):
        return sum(1 for r in rows if self.in_period(r)) * 30.0 / self.days

    def _sessions(self):
        self.by_session = collections.OrderedDict()
        for r in self.rows:
            self.by_session.setdefault(r["s"], []).append(r)
        self.human = [r for r in self.rows if r["k"] in ("prompt", "ack")]
        self.mid_model, self.mid_effort = set(), set()
        self.model_targets, self.slash = collections.Counter(), collections.Counter()
        for sid, rs in self.by_session.items():
            seen_human, pos = False, 0
            for r in rs:
                if r["k"] in ("prompt", "ack"):
                    r["first"], r["hpos"] = not seen_human, pos
                    seen_human, pos = True, pos + 1
                elif r["k"] == "slash":
                    self.slash[r["cmd"]] += 1
                    r["mid"] = seen_human
                    if seen_human and r["cmd"] == "/model":
                        self.mid_model.add(sid)
                        if r["args"]:
                            self.model_targets[r["args"].split()[0].lower()[:20]] += 1
                    if seen_human and r["cmd"] == "/effort":
                        self.mid_effort.add(sid)
        periods = [r for r in self.rows if self.in_period(r)]
        self.sessions_per_month = len({r["s"] for r in periods}) * 30.0 / self.days
        self.sessions_in_period = {r["s"] for r in periods}

    def _cluster(self):
        """Two passes (corrections at a lower threshold); identical shingle sets are
        merged first so thousands of repeats of one prompt cost one comparison."""
        docs = [(r, norm_tokens(r["d"])) for r in self.rows if r["k"] == "prompt"]
        docs = [(r, shingles(toks)) for r, toks in docs if len(toks) >= 3]
        found = []
        for corr, thr in ((False, CLUSTER_JACCARD), (True, CORRECTION_JACCARD)):
            uniq = collections.OrderedDict()
            for r, sh in docs:
                if r["corr"] == corr:
                    uniq.setdefault(sh, []).append(r)
            shs, groups = list(uniq), list(uniq.values())
            weights = [len(g) for g in groups]
            for members in cluster_docs(shs, weights, thr):
                if sum(weights[i] for i in members) < 2:
                    continue
                med, variants = medoid_and_variants(members, shs, weights, thr)
                rows = [r for i in members for r in groups[i]]
                found.append(self._cluster_record(rows, groups[med], [groups[v] for v in variants],
                                                  shs[med], corr))
        found.sort(key=lambda c: (-c["n"], -c["sessions"], c["first"] or ""))
        for i, c in enumerate(found, 1):
            c["cid"] = "c%d" % i
            for r in c["_rows"]:
                r["cid"] = c["cid"]
        self.clusters = found
        self.by_cid = {c["cid"]: c for c in found}

    def _cluster_record(self, rows, med_rows, var_rows, med_sh, corr):
        med_text = collections.Counter(r["d"] for r in med_rows).most_common(1)[0][0]
        d = med_text.strip()
        if corr:
            kind = "correction" if OPENER_RE.match(d) else "preference"
        else:
            kind = "question" if d.endswith("?") or QUESTION_RE.match(d) else "procedure"
        ts = [r["ts"] for r in rows if r["ts"]]
        return {"cid": None, "kind": kind, "n": len(rows), "sessions": len({r["s"] for r in rows}),
                "clones": len({r["c"] for r in rows}), "per_month": rnd(self.rate(rows), 1),
                "first": iso_day(min(ts)) if ts else None, "last": iso_day(max(ts)) if ts else None,
                "avg_chars": int(sum(len(r["d"]) for r in rows) / len(rows)),
                "medoid": med_text, "variants": [g[0]["d"] for g in var_rows],
                "calls_per_occ_p50": None, "corr_after": None, "top_heads": [],
                "_rows": rows, "_sh": med_sh, "_toks": frozenset(norm_tokens(med_text))}

    def _chains(self):
        """Per session, cids of significant clusters in time order -> bigram/trigram counts."""
        big = {c["cid"] for c in self.clusters if c["n"] >= H03_MIN_N}
        counts = collections.Counter()
        for rs in self.by_session.values():
            seq = []
            for r in rs:
                cid = r.get("cid")
                if cid in big and (not seq or seq[-1] != cid):
                    seq.append(cid)
            grams = {tuple(seq[i:i + n]) for n in (2, 3) for i in range(len(seq) - n + 1)}
            counts.update(g for g in grams if len(set(g)) == len(g))
        self.chains = [{"seq": list(g), "sessions": n} for g, n in counts.most_common()
                       if n >= CHAIN_MIN_SESSIONS]

    def next_human(self, r, within=2):
        """The next `within` human rows of the same session."""
        rs = [x for x in self.by_session.get(r["s"], []) if x["k"] in ("prompt", "ack")]
        pos = r.get("hpos", 0)
        return rs[pos + 1:pos + 1 + within]


# =============================================================================
# Transcripts: streaming parser, one Thread per file
# =============================================================================
KNOWN_TYPES = frozenset((
    "assistant", "user", "attachment", "system", "cost-state", "summary", "file-history-snapshot",
    "file-history-delta", "ai-title", "last-prompt", "mode", "permission-mode", "atis-latch",
    "queue-operation", "custom-title", "tag", "agent-name", "pr-link"))
KNOWN_SYSTEM = frozenset(("turn_duration", "stop_hook_summary", "away_summary", "local_command",
                          "api_error", "informational", "bridge_status", "scheduled_task_fire"))
NOT_RENDERED = frozenset(("prompt_snapshot", "deferred_tools_record", "credential_org", "edited_text_file"))
STARTUP_COMPONENT = {"skill_listing": "skill_listing", "mcp_instructions_delta": "mcp_instructions",
                     "agent_listing_delta": "agent_listing", "instructions": "claude_md",
                     "deferred_tools_delta": "deferred_tools", "session_context": "session_context",
                     "nested_memory": "memory", "memory": "memory"}
READ_TOOLS = {"Read": "file_path", "NotebookRead": "notebook_path"}
WRITE_TOOLS = {"Edit": "file_path", "MultiEdit": "file_path", "Write": "file_path",
               "NotebookEdit": "notebook_path"}
SEARCH_TOOLS = ("Grep", "Glob", "LS")
WEB_TOOLS = ("WebFetch", "WebSearch")
KEY_ARGS = ("file_path", "command", "pattern", "url", "query", "skill", "subagent_type", "path",
            "notebook_path", "description")
_CMD_TAG_RE = re.compile(r"<command-name>\s*(/?[^<\s]+)\s*</command-name>")
_CMD_ARGS_RE = re.compile(r"<command-args>(.*?)</command-args>", re.S)
_META_PREFIX_RE = re.compile(r"<(local-command|bash-|task-notification|system-reminder|user-memory|command-)")
_PERSISTED_RE = re.compile(r"Output too large \(([\d.]+)\s*(B|KB|MB)\)", re.I)


class Call(object):
    """One API response (all its split content-block records)."""
    __slots__ = ("idx", "model", "effort", "ts", "ts_end", "inp", "cr", "cw", "w1h", "w5m", "out",
                 "think", "speed", "stop", "tool_ids", "question", "web", "ctx", "comp", "usd")

    def __init__(self, idx, rec, msg, ts):
        self.idx = idx
        self.model = msg.get("model") or "unknown"
        self.effort = rec.get("effort") or rec.get("perTurnEffort")
        self.ts = self.ts_end = ts
        self.inp = self.cr = self.cw = self.w1h = self.w5m = self.think = self.web = self.ctx = 0
        self.out = -1
        self.speed = self.stop = None
        self.tool_ids, self.question = [], False
        self.comp, self.usd = (0.0,) * 5, 0.0

    def absorb(self, u):
        """Keep the usage with the largest output_tokens (the final part of a split response)."""
        out = u.get("output_tokens") or 0
        if out < self.out:
            return
        cc = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
        self.inp = u.get("input_tokens") or 0
        self.cr = u.get("cache_read_input_tokens") or 0
        self.cw = u.get("cache_creation_input_tokens") or 0
        self.w1h = cc.get("ephemeral_1h_input_tokens") or 0
        w5 = cc.get("ephemeral_5m_input_tokens")
        self.w5m = w5 if isinstance(w5, int) else max(0, self.cw - self.w1h)   # no split -> 5m
        self.out = out
        self.think = ((u.get("output_tokens_details") or {}).get("thinking_tokens") or 0) \
            if isinstance(u.get("output_tokens_details"), dict) else 0
        self.speed = u.get("speed")
        stu = u.get("server_tool_use") if isinstance(u.get("server_tool_use"), dict) else {}
        self.web = (stu.get("web_search_requests") or 0) + (stu.get("web_fetch_requests") or 0)
        self.ctx = self.inp + self.cr + self.cw

    def price(self, pricer):
        r = pricer.rates(self.model)
        m = (FAST_MODE_MULTIPLIER if self.speed == "fast" else 1.0) / 1e6
        out = max(0, self.out)
        self.comp = (r["in"] * self.inp * m, r["read"] * self.cr * m, r["w5m"] * self.w5m * m,
                     r["w1h"] * self.w1h * m, r["out"] * out * m)
        self.usd = sum(self.comp)


class Tool(object):
    """A tool_use paired with its tool_result(s)."""
    __slots__ = ("id", "name", "call", "gap", "arg", "head", "reads", "writes", "whole_read", "chars",
                 "images", "results", "error", "err", "rejected", "persisted", "persisted_kb",
                 "agent_id", "cd_chars")

    def __init__(self, tid, name, call):
        self.id, self.name, self.call, self.gap = tid, name, call, call
        self.arg, self.head, self.reads, self.writes = "", name, [], []
        self.whole_read = self.error = self.rejected = self.persisted = False
        self.chars = self.images = self.results = self.cd_chars = 0
        self.err, self.persisted_kb, self.agent_id = "", None, None


class Prompt(object):
    """A user prompt: human (typed) or injected (harness, subagent task, queued)."""
    __slots__ = ("gap", "ts", "chars", "lines", "head", "human", "images", "after_interrupt", "hist",
                 "shape", "run")

    def __init__(self, gap, ts, text, images, human, after_interrupt):
        self.gap, self.ts, self.human, self.images = gap, ts, human, images
        self.after_interrupt = after_interrupt
        self.chars, self.lines = len(text), text.count("\n") + 1
        self.head = text[:PROMPT_HEAD_CHARS]
        self.shape = text_shape(text) if self.chars >= SHAPE_MIN_CHARS or self.lines >= PASTE_BIG_LINES else None
        self.hist, self.run = None, (gap + 1, gap + 1)


_JSONISH = re.compile(r"^\s*[\[{].*[\]},]\s*$")
_STACK = re.compile(r"^\s+at \S|Traceback \(most recent|^\s*File \".*\", line \d+")
_LOGTS = re.compile(r"\d{4}-\d\d-\d\d[ T]\d\d:\d\d|\b\d\d:\d\d:\d\d\b")
_URL = re.compile(r"https?://\S+")
_CODE = re.compile(r"^\s*(def |class |function |const |let |var |import |export |return |if \(|for \(|#include)")


def text_shape(text):
    """Deterministic description of a big prompt/paste (never its content)."""
    lines = text.splitlines() or [""]
    n = float(len(lines))
    shares = {"json": sum(1 for l in lines if _JSONISH.match(l)) / n,
              "log": sum(1 for l in lines if _LOGTS.search(l)) / n,
              "stack": sum(1 for l in lines if _STACK.search(l)) / n,
              "code": sum(1 for l in lines if _CODE.match(l)) / n}
    kind = max(shares, key=lambda k: shares[k])
    return {"lines": int(n), "kind": kind if shares[kind] >= 0.3 else "text",
            "json": rnd(shares["json"]), "urls": len(_URL.findall(text))}


# --- Bash command parsing (tool_use inputs only) -------------------------------------
_CD_RE = re.compile(r"^\s*cd\s+(\"[^\"]*\"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*")
_ENV_RE = re.compile(r"^\s*(?:export\s+)?[A-Za-z_]\w*=(?:\"[^\"]*\"|'[^']*'|[^\s;&|]*)\s*(?:(?:&&|;)\s*)?")
_SEG_RE = re.compile(r"\s*(?:&&|\|\||;|\||\n)\s*")
WRAPPERS = ("sudo", "time", "env", "nice", "nohup", "command", "exec", "xargs")
SUBCOMMAND_TOOLS = frozenset(("git", "npm", "pnpm", "yarn", "npx", "bun", "bunx", "cargo", "go", "docker",
                              "kubectl", "gh", "uv", "poetry", "pip", "pip3", "make", "terraform", "pulumi",
                              "aws", "gcloud", "nx", "deno", "dotnet", "mvn", "gradle", "bundle", "brew",
                              "claude", "just", "rake", "composer", "mix", "swift", "flutter", "helm"))
INTERPRETERS = ("node", "bash", "sh", "zsh", "ruby", "tsx", "ts-node", "perl", "php")
FLAGS_WITH_VALUE = frozenset(("-C", "-c", "--git-dir", "--work-tree", "--filter", "-F", "--prefix",
                              "--dir", "-w", "--workspace", "-e", "-f", "-m"))
READ_CMDS = frozenset(("cat", "head", "tail", "sed", "nl", "wc", "grep", "rg", "jq", "less", "bat", "ls",
                       "find", "tree", "awk", "cut", "sort", "uniq", "diff", "file", "stat", "xxd", "od",
                       "more", "egrep", "fgrep", "ag", "strings"))
PATTERN_FIRST = frozenset(("grep", "rg", "egrep", "fgrep", "ag", "jq", "awk"))
WRITE_CMDS = frozenset(("tee", "touch", "rm", "mv", "cp", "mkdir", "rmdir", "ln", "truncate"))


def strip_prefixes(cmd):
    """Drop leading `cd X &&` and `VAR=... ` prefixes."""
    prev = None
    while prev != cmd:
        prev = cmd
        cmd = _ENV_RE.sub("", _CD_RE.sub("", cmd, count=1), count=1)
    return cmd.strip()


def _words(seg):
    try:
        return shlex.split(seg, posix=True)
    except ValueError:
        return seg.split()


def _skip_wrappers(w):
    while w and (re.match(r"^[A-Za-z_]\w*=", w[0]) or os.path.basename(w[0]) in WRAPPERS + ("timeout",)):
        drop = 2 if w[0] == "timeout" and len(w) > 1 and re.match(r"^\d", w[1]) else 1
        w = w[drop:]
    return w


def bash_head(cmd):
    """First command word (+ subcommand for git/npm/..., script for interpreters)."""
    seg = next((s for s in _SEG_RE.split(strip_prefixes(cmd or "")) if s.strip()), "")
    w = _skip_wrappers(_words(seg))
    if not w:
        return "bash"
    head, i = os.path.basename(w[0])[:30], 1
    while i < len(w):
        a = w[i]
        if head.startswith("python") and a == "-m" and i + 1 < len(w):
            return "%s -m %s" % (head, w[i + 1][:30])
        if a in FLAGS_WITH_VALUE:
            i += 2
            continue
        if a.startswith("-"):
            i += 1
            continue
        if head in SUBCOMMAND_TOOLS:
            return "%s %s" % (head, a[:30])
        if head.startswith("python") or head in INTERPRETERS:
            return "%s %s" % (head, os.path.basename(a)[:40])
        break
    return head


def _pathish(a):
    return (("/" in a or re.search(r"\.[A-Za-z0-9]{1,8}$", a) is not None or a in (".", ".."))
            and not a.startswith(("$", "http://", "https://", "s/")) and "=" not in a and len(a) < 300)


def _join(base, p):
    p = os.path.expanduser(p)
    return os.path.normpath(p if os.path.isabs(p) or not base else os.path.join(base, p))


def _cmd_args(w):
    """Non-flag arguments, without redirection targets, flag values and bare numbers."""
    out, skip = [], False
    for a in w[1:]:
        if skip:
            skip = False
            continue
        if a in (">", ">>", "<", "2>", "&>") or a in FLAGS_WITH_VALUE:
            skip = True
            continue
        if a.startswith(("-", ">", "<", "2>", "&")) or a.isdigit():
            continue
        out.append(a)
    return out


def bash_paths(cmd, cwd):
    """(reads, writes) absolute paths touched by a shell command (best effort)."""
    reads, writes = [], []
    base = cwd or ""
    m = _CD_RE.match(cmd or "")
    if m:
        base = _join(base, m.group(1).strip("'\""))
    body = strip_prefixes(cmd or "")
    for t in re.findall(r"(?<![0-9&<>])>>?\s*([^\s;&|<>]+)", body):
        if not t.startswith(("/dev/", "&")):
            writes.append(_join(base, t))
    for seg in _SEG_RE.split(body):
        w = _skip_wrappers(_words(seg))
        if not w:
            continue
        h, args = os.path.basename(w[0]), _cmd_args(w)
        if h == "sed" and any(a.startswith("-i") for a in w[1:]):
            writes += [_join(base, a) for a in args[1:] if _pathish(a)]
        elif h in WRITE_CMDS:
            writes += [_join(base, a) for a in args if _pathish(a)] or ["?"]
        elif h in ("apply_patch", "patch") or (h == "git" and args[:1] == ["apply"]):
            writes.append("?")
        elif h in READ_CMDS:
            if h == "find":
                args = [a for a in w[1:] if not a.startswith("-")][:1]
            elif (h in PATTERN_FIRST or h == "sed") and not ({"-e", "-f"} & set(w[1:])):
                args = args[1:]
            reads += [_join(base, a) for a in args if _pathish(a)]
    return reads, writes


def describe_tool(t, inp, cwd):
    """Fill head/arg/paths of a Tool from its input (commands, paths, URLs only)."""
    n = t.name
    if n == "Bash":
        cmd = str(inp.get("command") or "")
        t.arg, t.head = cmd[:ARG_KEEP_CHARS], bash_head(cmd)
        t.reads, t.writes = bash_paths(cmd, cwd)
        m = _CD_RE.match(cmd)
        t.cd_chars = m.end() if m and os.path.isabs(m.group(1).strip("'\"")) else 0
    elif n in READ_TOOLS or n in WRITE_TOOLS:
        p = str(inp.get(READ_TOOLS.get(n) or WRITE_TOOLS.get(n)) or "")
        t.arg = p
        if p:
            (t.reads if n in READ_TOOLS else t.writes).append(_join(cwd, p))
        t.whole_read = n == "Read" and not inp.get("offset") and not inp.get("limit")
    elif n in SEARCH_TOOLS:
        p = str(inp.get("path") or "")
        t.arg = ("%s %s" % (inp.get("pattern") or "", p)).strip()
        t.reads = [_join(cwd, p)] if p else []
    elif n == "Skill":
        t.arg = str(inp.get("skill") or "")
        t.head = "Skill:" + t.arg[:40]
    elif n in ("Agent", "Task"):
        t.arg = str(inp.get("description") or inp.get("subagent_type") or "")
        t.head = "%s:%s" % (n, str(inp.get("subagent_type") or "general")[:30])
    else:
        t.arg = next((str(inp[k]) for k in KEY_ARGS if inp.get(k)), "")[:ARG_KEEP_CHARS]
        if n.startswith("mcp__"):
            t.head = "mcp__" + mcp_server(n)


def mcp_server(tool_name):
    parts = tool_name.split("__")
    return parts[1] if len(parts) > 2 else tool_name


def norm_server(name):
    return re.sub(r"[^A-Za-z0-9]", "_", name or "")


def text_of(content):
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text") or "" for b in (content or []) if isinstance(b, dict) and b.get("type") == "text")


def result_size(block):
    """(chars the model saw, images, first 400 chars of text) of a tool_result block."""
    c = block.get("content")
    if isinstance(c, str):
        return len(c), 0, c[:400]
    chars = images = 0
    head = []
    for x in c or []:
        if not isinstance(x, dict):
            continue
        t = x.get("type")
        if t == "text":
            s = x.get("text") or ""
            chars += len(s)
            if sum(len(h) for h in head) < 400:
                head.append(s[:400])
        elif t == "image":
            images += 1
        else:
            chars += len(json.dumps(x))
    return chars, images, "\n".join(head)[:400]


def first_error_line(text):
    """First error line (plus the next one after a bare "Exit code N")."""
    lines = [re.sub(r"</?[\w-]+>", "", l).strip() for l in (text or "").splitlines()]
    lines = [l for l in lines if l][:2]
    if not lines:
        return ""
    out = lines[0]
    if re.match(r"^Exit code \d+$", out) and len(lines) > 1:
        out += " | " + lines[1]
    return out[:SHORT_CHARS]


def classify_user(r, text, sidechain):
    """human | injected | interrupt | slash | meta"""
    if r.get("isMeta") or r.get("isVisibleInTranscriptOnly"):
        return "meta"
    t = text.lstrip()
    if not t:
        return "meta"
    if "[Request interrupted by user" in t[:200]:
        return "interrupt"
    if t.startswith("<command-name>") or t.startswith("<command-message>"):
        return "slash"
    if _META_PREFIX_RE.match(t):
        return "meta"
    if sidechain:
        return "injected"
    origin = r.get("origin") if isinstance(r.get("origin"), dict) else {}
    ps, ok = r.get("promptSource"), origin.get("kind")
    if ps is None and ok is None:
        return "human"                      # versions before 2.1.283 carry no provenance
    return "human" if ps == "typed" or ok == "human" else "injected"


class Thread(object):
    """One transcript file (main session or subagent) reduced to what the heuristics need.
    "gap g" = everything between API call g and call g+1 (g = -1: before the first call)."""

    def __init__(self, path, kind, sid, clone, scope=None, roots=()):
        self.path, self.kind, self.sid, self.clone = path, kind, sid, clone
        self.scope, self.roots, self.in_scope, self.cwd = scope, roots, True, None
        self.agent_id = self.agent_type = self.desc = self.returned_chars = None
        self.calls, self.tools, self.prompts, self._keys = [], {}, [], {}
        self.gap_chars = collections.Counter()
        self.gap_tool_chars = collections.Counter()
        self.gap_tool_count = collections.Counter()
        self.gap_images = collections.Counter()
        self.markers = collections.defaultdict(set)
        self.startup = collections.Counter()
        self.skills_listed, self.mcp_servers, self.tool_defs = set(), set(), {}
        self.slash, self.cost_states, self.unknown = [], {}, set()
        self.stats, self.perm_modes = collections.Counter(), collections.Counter()
        self.first_ts = self.last_ts = None
        self.side, self._after_interrupt = None, False
        self.usd = self.first_ctx = self.max_ctx = 0
        self.seg_end, self.resets, self.ttl_1h = [], set(), False

    # --- record dispatch -------------------------------------------------------------
    def feed(self, r):
        cwd = r.get("cwd")
        if isinstance(cwd, str):
            self.cwd = cwd
            if self.scope:
                self.in_scope = in_clone(_norm(cwd), self.scope, self.roots)
        if not self.in_scope:
            return
        t = r.get("type")
        if self.kind == "main" and r.get("isSidechain") is True and t in ("assistant", "user"):
            if self.side is None:                   # inline sidechains of very old versions
                self.side = Thread(self.path, "subagent", self.sid, self.clone)
                self.side.agent_type = "inline-sidechain"
            self.side.feed(r)
            return
        ts = parse_ts(r.get("timestamp"))
        if ts:
            self.first_ts = min(self.first_ts or ts, ts)
            self.last_ts = max(self.last_ts or ts, ts)
        g = len(self.calls) - 1
        if t == "assistant":
            self._assistant(r, ts)
        elif t == "user":
            self._user(r, g, ts)
        elif t == "attachment":
            self._attachment(r, g)
        elif t == "system":
            self._system(r, g)
        elif t == "cost-state":
            self._cost_state(r)
        elif t == "permission-mode":
            self.perm_modes[str(r.get("permissionMode"))[:30]] += 1
        elif t not in KNOWN_TYPES:
            self.unknown.add("type:%s" % str(t)[:40])

    def _assistant(self, r, ts):
        msg = r.get("message") if isinstance(r.get("message"), dict) else {}
        if msg.get("model") == "<synthetic>" or r.get("isApiErrorMessage"):
            self.stats["api_error_records"] += 1
            return
        key = msg.get("id") or r.get("requestId") or r.get("uuid") or "anon-%d" % len(self.calls)
        call = self._keys.get(key)
        if call is None:
            call = self._keys[key] = Call(len(self.calls), r, msg, ts)
            self.calls.append(call)
        elif ts:
            call.ts_end = ts
        if isinstance(msg.get("usage"), dict):
            call.absorb(msg["usage"])
        if msg.get("stop_reason"):
            call.stop = msg["stop_reason"]
        wire = r.get("wireToolInputs") if isinstance(r.get("wireToolInputs"), dict) else {}
        content = msg.get("content")
        for b in (content if isinstance(content, list) else []):
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                self._tool_use(b, call, wire)
            elif b.get("type") == "text" and (b.get("text") or "").strip():
                call.question = b["text"].rstrip().endswith("?")

    def _tool_use(self, b, call, wire):
        tid = b.get("id") or "anon-tool-%d" % len(self.tools)
        inp = wire.get(tid) if isinstance(wire.get(tid), dict) else b.get("input")
        t = Tool(tid, str(b.get("name") or "?"), call.idx)
        describe_tool(t, inp if isinstance(inp, dict) else {}, self.cwd)
        self.tools[tid] = t
        call.tool_ids.append(tid)

    def _user(self, r, g, ts):
        msg = r.get("message") if isinstance(r.get("message"), dict) else {}
        content = msg.get("content")
        blocks = [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []
        results = [b for b in blocks if b.get("type") == "tool_result"]
        if results:
            for b in results:
                self._tool_result(b, r, g)
            return
        src = r.get("sourceToolUseID")
        if src in self.tools:                        # e.g. a Skill body: part of that call's result
            n = len(text_of(content))
            self.tools[src].chars += n
            self.gap_tool_chars[g] += n
            return
        text = text_of(content)
        images = sum(1 for b in blocks if b.get("type") == "image")
        self.gap_chars[g] += len(text)
        self.gap_images[g] += images
        if r.get("isCompactSummary"):
            self.markers[g].add("compaction")
            return
        kind = classify_user(r, text, self.kind != "main")
        if kind == "interrupt":
            self.markers[g].add("interrupt")
            self._after_interrupt = True
        elif kind == "slash":
            m = _CMD_TAG_RE.search(text)
            name = "/" + m.group(1).lstrip("/").lower() if m else "/?"
            a = _CMD_ARGS_RE.search(text)
            self.slash.append((g, name, (a.group(1).strip() if a else "")[:40]))
            if name == "/clear":
                self.markers[g].add("clear")
        elif kind in ("human", "injected"):
            self.prompts.append(Prompt(g, ts, text, images, kind == "human", self._after_interrupt))
            self._after_interrupt = False

    def _tool_result(self, b, r, g):
        t = self.tools.get(b.get("tool_use_id"))
        if t is None:
            self.stats["orphan_results"] += 1
            return
        chars, images, head = result_size(b)
        t.chars += chars
        t.images += images
        t.results += 1
        t.gap = g
        self.gap_tool_chars[g] += chars
        self.gap_tool_count[g] += 1
        self.gap_images[g] += images
        if b.get("is_error"):
            t.error, t.err = True, first_error_line(head)
            t.rejected = head.startswith("The user doesn't want to proceed")
        if head.startswith("<persisted-output>"):
            m = _PERSISTED_RE.search(head)
            t.persisted = True
            if m:
                t.persisted_kb = float(m.group(1)) * {"b": 1e-3, "kb": 1.0, "mb": 1e3}[m.group(2).lower()]
        if "[Request interrupted by user" in head[:200]:
            self.markers[g].add("interrupt")
            self._after_interrupt = True
        tur = r.get("toolUseResult")
        if isinstance(tur, dict) and tur.get("agentId"):
            t.agent_id = str(tur["agentId"])

    def _attachment(self, r, g):
        a = r.get("attachment") if isinstance(r.get("attachment"), dict) else {}
        at = str(a.get("type") or "?")
        chars = 0 if at in NOT_RENDERED else rendered_chars(r, a)
        self.gap_chars[g] += chars
        if g < 0:
            self.startup[STARTUP_COMPONENT.get(at, "other")] += chars
        if at == "skill_listing" and isinstance(a.get("names"), list):
            self.skills_listed.update(str(n) for n in a["names"])
        elif at == "mcp_instructions_delta":
            self.mcp_servers.update(norm_server(str(n)) for n in a.get("addedNames") or [])
            if a.get("removedNames"):
                self.markers[g].add("tools_changed")
        elif at == "deferred_tools_delta":
            self.mcp_servers.update(mcp_server(str(n)) for n in a.get("addedNames") or []
                                    if str(n).startswith("mcp__"))
            if a.get("removedNames"):
                self.markers[g].add("tools_changed")
        elif at == "thinking_drop":
            self.markers[g].add("thinking_drop")
        elif at == "session_context" and g < 0:
            ctx = a.get("context") if isinstance(a.get("context"), dict) else {}
            self.startup["git_status"] += len(ctx.get("gitStatus") or "")
        elif at == "prompt_snapshot" and not self.tool_defs and isinstance(a.get("tools"), list):
            self.tool_defs = {str(x.get("name")): len(json.dumps(x)) for x in a["tools"] if isinstance(x, dict)}
            self.startup["system_prompt"] += sum(len(s) for s in a.get("systemPrompt") or [] if isinstance(s, str))

    def _system(self, r, g):
        st = str(r.get("subtype") or "")
        if "compact" in st:
            self.markers[g].add("compaction")
        elif st == "api_error":
            self.stats["api_retries"] += 1
        elif st == "away_summary":
            self.markers[g].add("away")
        elif st == "stop_hook_summary":
            self.gap_chars[g] += sum(len(x) for x in r.get("hookAdditionalContext") or [] if isinstance(x, str))
        elif st not in KNOWN_SYSTEM:
            self.unknown.add("system:%s" % st[:40])

    def _cost_state(self, r):
        total = r.get("totalCostUSD")
        if not isinstance(total, (int, float)):
            return
        key = r.get("startTime") or len(self.cost_states)
        if key not in self.cost_states or total >= self.cost_states[key][0]:
            mu = r.get("modelUsage") if isinstance(r.get("modelUsage"), dict) else {}
            self.cost_states[key] = (float(total), {str(m): float(d.get("costUSD") or 0) for m, d in mu.items()
                                                    if isinstance(d, dict)})

    # --- derived values ----------------------------------------------------------------
    def finish(self, pricer):
        for c in self.calls:
            c.price(pricer)
        n = len(self.calls)
        resets = {j for j in range(1, n) if ({"compaction", "clear"} & self.markers.get(j - 1, set()))
                  or self.calls[j].ctx < RESET_RATIO * self.calls[j - 1].ctx}
        self.seg_end, nxt = [n] * n, n
        for i in range(n - 1, -1, -1):
            self.seg_end[i] = nxt
            if i in resets:
                nxt = i
        self.resets = resets
        self.usd = sum(c.usd for c in self.calls)
        self.first_ctx = self.calls[0].ctx if self.calls else 0
        self.max_ctx = max([c.ctx for c in self.calls] or [0])
        self.ttl_1h = any(c.w1h > 0 for c in self.calls)
        starts = sorted({p.gap + 1 for p in self.prompts})
        for p in self.prompts:
            s = p.gap + 1
            p.run = (s, next((x for x in starts if x > s), n))

    def gap_total_chars(self, g):
        return self.gap_chars.get(g, 0) + self.gap_tool_chars.get(g, 0)

    def cost_state_usd(self):
        return sum(v[0] for v in self.cost_states.values()) if self.cost_states else None

    def load_subagent_meta(self):
        m = re.match(r"agent-(.+)\.jsonl$", os.path.basename(self.path))
        self.agent_id = m.group(1) if m else None
        meta = load_json(self.path[:-6] + ".meta.json")
        if isinstance(meta, dict):
            self.agent_type = str(meta.get("agentType") or "")[:40] or None
            self.desc = str(meta.get("description") or "")[:SHORT_CHARS] or None
        journal = os.path.join(os.path.dirname(self.path), "journal.jsonl")
        if self.agent_id and os.path.isfile(journal):
            for rec in iter_jsonl(journal):
                if rec.get("type") == "result" and rec.get("agentId") == self.agent_id:
                    self.returned_chars = len(str(rec.get("result") or ""))


def rendered_chars(r, a):
    """What the model saw for an attachment: rendered[].content, else its text fields."""
    rend = r.get("rendered")
    if isinstance(rend, list):
        return sum(len(x.get("content") or "") for x in rend if isinstance(x, dict))
    n = sum(len(a[k]) for k in ("content", "text", "prompt") if isinstance(a.get(k), str))
    for k in ("addedBlocks", "addedLines"):
        if isinstance(a.get(k), list):
            n += sum(len(x) for x in a[k] if isinstance(x, str))
    return n


def parse_transcript(tx, clone_root, scope_root=None, roots=()):
    """Stream one transcript file into Thread objects (main + inline sidechains)."""
    th = Thread(tx["path"], tx["kind"], tx["session_id"], clone_root, scope_root, roots)
    if th.kind == "subagent":
        th.load_subagent_meta()
    for r in iter_jsonl(th.path, th.stats):
        th.feed(r)
    return [th] + ([th.side] if th.side is not None else [])


# =============================================================================
# Repository and user configuration inventory
# =============================================================================
INSTRUCTION_NAMES = ("CLAUDE.md", "CLAUDE.local.md")
PRUNE_DIRS = frozenset(("node_modules", ".venv", "venv", "dist", "build", "target", "vendor", "__pycache__",
                        ".next", ".cache", ".tox", "coverage", ".turbo", ".gradle", "Pods", "DerivedData",
                        ".terraform", "worktrees", "token-usage-audit"))


def frontmatter(text):
    """Flat YAML frontmatter (key: value, folded/literal blocks joined)."""
    if not text or not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    fm, key = {}, None
    for line in text[3:end if end > 0 else len(text)].splitlines():
        m = re.match(r"^([A-Za-z][\w-]*)\s*:\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            fm[key] = "" if val in ("|", ">", "|-", ">-") else val.strip("\"'")
        elif key and line.startswith((" ", "\t")):
            fm[key] = (fm[key] + " " + line.strip()).strip()
    return fm


def md_sections(text):
    """[(heading, chars)] of a markdown file (fenced code is not a heading)."""
    secs, cur, fence = [], ["(preamble)", 0], False
    for line in text.splitlines(True):
        if line.lstrip().startswith("```"):
            fence = not fence
        m = None if fence else re.match(r"^#{1,6}\s+(.+?)\s*#*\s*$", line)
        if m:
            secs.append(cur)
            cur = [m.group(1)[:80], 0]
        cur[1] += len(line)
    secs.append(cur)
    return [(h, c) for h, c in secs if c]


def find_instruction_files(root):
    """CLAUDE.md / CLAUDE.local.md anywhere in the repo (heavy dirs pruned) and .claude/rules/*.md."""
    out, seen = [], 0
    for d, dirs, files in os.walk(root):
        seen += 1
        if seen > WALK_MAX_DIRS:
            break
        dirs[:] = sorted(x for x in dirs if x not in PRUNE_DIRS and x != ".git"
                         and (not x.startswith(".") or x == ".claude"))
        out += [os.path.join(d, f) for f in sorted(files) if f in INSTRUCTION_NAMES]
    rules = os.path.join(root, ".claude", "rules")
    out += sorted(glob.glob(os.path.join(rules, "**", "*.md"), recursive=True))
    return out, seen > WALK_MAX_DIRS


def settings_summary(path):
    data = load_json(path)
    if not isinstance(data, dict):
        return None
    hooks = []
    for event, lst in (data.get("hooks") or {}).items() if isinstance(data.get("hooks"), dict) else []:
        for h in lst if isinstance(lst, list) else []:
            if isinstance(h, dict):
                hooks.append("%s:%s" % (event, h.get("matcher") or "*"))
    perms = data.get("permissions") if isinstance(data.get("permissions"), dict) else {}
    plugins = data.get("enabledPlugins") if isinstance(data.get("enabledPlugins"), dict) else {}
    env = data.get("env") if isinstance(data.get("env"), dict) else {}
    ms = data.get("modelSettings")
    return {"keys": sorted(data)[:CAPS["names"]], "hooks": hooks[:CAPS["names"]],
            "model": data.get("model"), "effortLevel": data.get("effortLevel"),
            "cleanupPeriodDays": data.get("cleanupPeriodDays"),
            "modelSettings": json.dumps(ms)[:SHORT_CHARS] if ms else None,
            "enabledPlugins": sorted(k for k, v in plugins.items() if v)[:CAPS["names"]],
            "env_keys": sorted(env)[:CAPS["names"]],
            "permissions_allow": len(perms.get("allow") or []) if isinstance(perms.get("allow"), list) else 0}


def skill_entries(base):
    out = []
    for p in sorted(glob.glob(os.path.join(base, "*", "SKILL.md"))):
        text = read_text(p) or ""
        fm = frontmatter(text)
        out.append({"name": fm.get("name") or os.path.basename(os.path.dirname(p)),
                    "desc": fm.get("description") or "", "chars": len(text)})
    return out


def agent_entries(base):
    out = []
    for p in sorted(glob.glob(os.path.join(base, "*.md"))):
        fm = frontmatter(read_text(p) or "")
        out.append({"name": fm.get("name") or os.path.basename(p)[:-3], "desc": fm.get("description") or "",
                    "model": fm.get("model")})
    return out


def repo_inventory(root):
    """Instruction files (+ sections), skills, commands, agents, hooks, settings, MCP."""
    files, truncated = find_instruction_files(root)
    inst, lines = [], []
    for p in files:
        text = read_text(p) or ""
        rel = os.path.relpath(p, root)
        fm = frontmatter(text) if "/rules/" in "/" + rel.replace(os.sep, "/") else {}
        always = rel in ("CLAUDE.md", "CLAUDE.local.md", os.path.join(".claude", "CLAUDE.md")) or \
            ("/rules/" in "/" + rel.replace(os.sep, "/") and not fm.get("paths"))
        inst.append({"path": rel, "chars": len(text), "lines": text.count("\n") + 1, "always": always,
                     "sections": md_sections(text), "text_lc": text.lower()})
        lines += [(rel, l.strip()) for l in text.splitlines() if len(l.strip()) > 8]
    cdir = os.path.join(root, ".claude")
    skills = skill_entries(os.path.join(cdir, "skills"))
    lines += [(".claude/skills/%s/SKILL.md" % s["name"], s["desc"]) for s in skills if s["desc"]]
    settings = {}
    for name in ("settings.json", "settings.local.json"):
        s = settings_summary(os.path.join(cdir, name))
        if s:
            settings[".claude/" + name] = s
    mcp = load_json(os.path.join(root, ".mcp.json"))
    return {"instruction_files": inst, "walk_truncated": truncated, "skills": skills,
            "commands": sorted(os.path.basename(p)[:-3] for p in glob.glob(os.path.join(cdir, "commands", "*.md"))),
            "agents": agent_entries(os.path.join(cdir, "agents")), "settings": settings,
            "mcp_servers": sorted((mcp.get("mcpServers") or {}).keys()) if isinstance(mcp, dict) else [],
            "_lines": lines}


def user_config(cfgs):
    out = []
    for cfg in cfgs:
        md = read_text(os.path.join(cfg, "CLAUDE.md"))
        out.append({"dir": cfg, "settings": settings_summary(os.path.join(cfg, "settings.json")) or {},
                    "claude_md_chars": len(md) if md else 0,
                    "skills": [s["name"] for s in skill_entries(os.path.join(cfg, "skills"))],
                    "agents": [a["name"] for a in agent_entries(os.path.join(cfg, "agents"))]})
    return out


# =============================================================================
# The audit: data collection and shared analyses
# =============================================================================
class Audit(object):
    """Holds every input and derived value; heuristics read from it."""

    def __init__(self, opts):
        self.opts, self.now = opts, time.time()
        self.cutoff = self.now - opts.since_days * 86400 if opts.since_days else None
        self.limits, self.stats = [], collections.Counter()
        self.home = _norm("~")
        self.cpt, self.cpt_samples = DEFAULT_CHARS_PER_TOKEN, 0
        self.threads, self.session_flags = [], collections.defaultdict(set)
        self.excluded = [e for e in ([os.environ.get("CLAUDE_CODE_SESSION_ID")] + list(opts.exclude_session or []))
                         if e]
        self.excluded_seen = set()

    def limit(self, msg):
        if msg not in self.limits:
            self.limits.append(msg)

    def is_excluded(self, sid):
        return any(sid == e or (len(e) >= 8 and sid.startswith(e)) for e in self.excluded) if sid else False

    def tok(self, chars):
        return chars / self.cpt

    # --- collection ----------------------------------------------------------------------
    def collect(self):
        self.cfgs = claude_config_dirs(self.opts.config_dir)
        if not self.cfgs:
            self.limit("no Claude Code config dir found ($CLAUDE_CONFIG_DIR, ~/.claude or --config-dir)")
        self.history_all = load_history(self.cfgs, self.stats)
        level = "recorded" if self.opts.no_unverified else "unverified"
        self.res = find_repo_clones(self.opts.repo, self.cfgs, self.history_all, self.is_excluded, level)
        self.clones = self.res["clones"][:CAPS["clones"]] if not self.opts.clones_only else self.res["clones"]
        if len(self.res["clones"]) > CAPS["clones"]:
            self.limit("clones capped at %d of %d" % (CAPS["clones"], len(self.res["clones"])))
        self.repo_root = self.res["self"]["root"]
        self.roots = [c["root"] for c in self.clones]
        self.names = unique_names(self.roots)
        self.path_owner = {_k(p): c["root"] for c in self.clones for p in c["paths"]}
        self.redact = Redactor(self.home, self.roots)

    def parse(self):
        self.pricer = Pricer(load_prices(self.opts.prices))
        self.tx_counts = collections.defaultdict(lambda: [0, 0])
        for cl in self.clones:
            for tx in cl["transcripts"]:
                if self.is_excluded(tx["session_id"]):
                    self.excluded_seen.add(tx["session_id"][:8])
                    continue
                if self.cutoff and tx["mtime"] < self.cutoff:
                    self.stats["old_files"] += 1
                    continue
                self.stats["live_files"] += int(tx["live"])
                scope = cl["root"] if tx["partial"] else None
                for th in parse_transcript(tx, cl["root"], scope, self.roots):
                    if th.calls or th.prompts:
                        th.finish(self.pricer)
                        self.threads.append(th)
                        self.tx_counts[cl["root"]][0 if th.kind == "main" else 1] += 1
                self.stats["tx_bytes"] += tx["bytes"]
        self.mains = [t for t in self.threads if t.kind == "main" and t.calls]
        self.subs = [t for t in self.threads if t.kind != "main" and t.calls]
        self.subs_by_sid = collections.defaultdict(list)
        for t in self.subs:
            self.subs_by_sid[t.sid].append(t)
        self.inv = repo_inventory(self.repo_root)
        self.user_cfg = user_config(self.cfgs)

    # --- shared derived values -------------------------------------------------------------
    def derive(self):
        self.H = History(self)
        self._calibrate()
        calls = [c for t in self.threads for c in t.calls]
        self.ctx_med = median([c.ctx for c in calls], DEFAULT_CTX)
        models = collections.Counter(c.model for t in (self.mains or self.threads) for c in t.calls)
        self.model = models.most_common(1)[0][0] if models else FALLBACK_PRICE_MODEL
        self.rates = self.pricer.rates(self.model)
        self.calls_per_session = median([len(t.calls) + sum(len(s.calls) for s in self.subs_by_sid[t.sid])
                                         for t in self.mains], DEFAULT_CALLS_PER_SESSION)
        runs = [p.run[1] - p.run[0] for t in self.mains for p in t.prompts if p.human and p.run[1] > p.run[0]]
        self.calls_per_prompt = median(runs, DEFAULT_CALLS_PER_PROMPT)
        self._month_factor()
        self._link_history()
        self.tool_rows = []
        for th in self.threads:
            for t in th.tools.values():
                if t.results:
                    tok = self.tok(t.chars) + t.images * IMAGE_TOKENS
                    self.tool_rows.append((th, t, tok, self.carry(th, t.gap + 1, tok)))
        self.misses = [e for th in self.threads for e in cache_misses(self, th)]

    def _calibrate(self):
        """chars/token from context deltas of calls followed by exactly one tool result."""
        chars = toks = n = 0
        for th in self.threads:
            for i in range(len(th.calls) - 1):
                a, b = th.calls[i], th.calls[i + 1]
                gc = th.gap_total_chars(i)
                if th.gap_tool_count.get(i) != 1 or th.gap_images.get(i) or gc < CPT_MIN_RESULT_CHARS \
                        or (i + 1) in th.resets or any(p.gap == i for p in th.prompts):
                    continue
                delta = b.ctx - a.ctx - max(0, a.out)
                if delta > 0:
                    chars, toks, n = chars + gc, toks + delta, n + 1
        self.cpt_samples = n
        if n >= CPT_MIN_SAMPLES and toks:
            self.cpt = min(CPT_BOUNDS[1], max(CPT_BOUNDS[0], chars / float(toks)))

    def _month_factor(self):
        """month_factor turns window dollars into dollars per month (see module docstring)."""
        self.tx_sids = {t.sid for t in self.mains}
        ts = [x for t in self.threads for x in (t.first_ts, t.last_ts) if x]
        self.win_start, self.win_end = (min(ts), max(ts)) if ts else (None, None)
        self.window_days = max(1.0, (self.win_end - self.win_start) / 86400.0) if ts else 0.0
        hist_sids = {r["s"] for r in self.H.rows}
        win_sids = {r["s"] for r in self.H.rows if ts and r["ts"] and self.win_start <= r["ts"] <= self.win_end}
        tx = len(self.tx_sids)
        self.tx_coverage = len(self.tx_sids & hist_sids) / float(len(hist_sids)) if hist_sids else (1.0 if tx else 0.0)
        self.window_coverage = len(self.tx_sids & win_sids) / float(len(win_sids)) if win_sids else 1.0
        tx_rate = tx * 30.0 / max(7.0, self.window_days) if tx else 0.0
        self.sessions_per_month = max(self.H.sessions_per_month, tx_rate)
        self.month_factor = self.sessions_per_month / tx if tx else 0.0
        self.MF = 30.0 / self.window_days if self.window_days else 0.0
        self.SF = self.H.sessions_per_month / tx_rate if tx_rate else None
        measured = self.window_days >= 7 and self.window_coverage >= 0.8
        self.mf_confidence = "measured" if measured else "extrapolated"

    def _link_history(self):
        """Match human transcript prompts to their history rows (same session, nearest time)."""
        by_sid = collections.defaultdict(list)
        for r in self.H.human:
            if r["ts"]:
                by_sid[r["s"]].append(r)
        for th in self.mains:
            used = set()
            for p in th.prompts:
                if not p.human or not p.ts:
                    continue
                best = min(by_sid.get(th.sid, []), key=lambda r: abs(r["ts"] - p.ts), default=None)
                if best is not None and abs(best["ts"] - p.ts) <= HISTORY_MATCH_S and id(best) not in used:
                    used.add(id(best))
                    p.hist = best
                    best["tx"] = (th, p)

    # --- cost helpers --------------------------------------------------------------------
    def carry(self, th, k, tok):
        """Cost of `tok` tokens entering the context before call k: one cache write plus a
        cache read on every later call of the same segment (until compaction/clear)."""
        if tok <= 0 or k < 0 or k >= len(th.calls):
            return 0.0
        c = th.calls[k]
        r = self.pricer.rates(c.model)
        w = r["w1h"] if (c.w1h > 0 or (c.cw == 0 and th.ttl_1h)) else r["w5m"]
        reads = max(0, th.seg_end[k] - k - 1)
        fast = FAST_MODE_MULTIPLIER if c.speed == "fast" else 1.0
        return tok * (w + r["read"] * reads) * fast / 1e6

    def default_carry(self, tok):
        """Carry estimate when only history is available (dominant model, 1h writes)."""
        reads = max(1.0, self.calls_per_session / 2.0)
        return tok * (self.rates["w1h"] + self.rates["read"] * reads) / 1e6

    def turn_usd(self, calls=1):
        return calls * self.ctx_med * self.rates["read"] / 1e6

    def conf(self, kind):
        return "extrapolated" if kind == "measured" and self.mf_confidence != "measured" else kind

    def analyze(self):
        """Shared analyses read by several heuristics and digest sections."""
        self.cleanup_days = cleanup_period(self)
        enrich_clusters(self)
        self.procedures = procedure_clusters(self)
        self.memory = memory_inventory(self)
        self.loops, self.err_agg = error_analysis(self)
        self.sub_rows = subagent_rows(self)
        self.paths = build_paths(self)
        self.overhead = overhead_analysis(self)

    # --- excerpt helpers -------------------------------------------------------------------
    def name(self, root):
        return self.names.get(root, os.path.basename(root))

    def prompt_excerpt(self, p, limit=EXCERPT_CHARS):
        """Human prompt text; long transcript prompts may contain pastes -> shape only."""
        if not p.human:
            return "[injected prompt: %d chars]" % p.chars
        if p.hist is not None:
            return self.redact(p.hist["d"], limit)
        if p.chars <= PROMPT_RAW_EXCERPT_MAX:
            return self.redact(p.head, limit)
        s = p.shape or {"lines": p.lines, "kind": "text", "urls": 0}
        return "[long prompt: %d chars, %d lines, %s, %d urls]" % (p.chars, s["lines"], s["kind"], s["urls"])

    def tool_excerpt(self, t, limit=EXCERPT_CHARS):
        return self.redact("%s: %s" % (t.name, t.arg) if t.arg else t.name, limit)

    def ev(self, th=None, call=None, ts=None, excerpt="", **extra):
        item = {"sid": th.sid[:8] if th else extra.pop("sid", None),
                "clone": self.name(th.clone) if th else extra.pop("clone", None),
                "ts": iso_min(ts if ts else (th.calls[call].ts if th and call is not None and
                                             0 <= call < len(th.calls) else None)),
                "call": call, "excerpt": excerpt}
        if th is not None and th.kind != "main":
            item["agent"] = (th.agent_id or "")[:12] or None
        for k, v in extra.items():
            item[k] = self.redact(v, SHORT_CHARS) if isinstance(v, str) else (rnd(v) if isinstance(v, float) else v)
        return {k: v for k, v in item.items() if v is not None and v != ""}

    def coverage(self, keywords):
        """Best CLAUDE.md / rules / skill-description line overlapping the keywords."""
        kw = _canon_negations(set(keywords) - STOPWORDS)
        best = None
        for label, line in self.inv["_lines"]:
            toks = _canon_negations(set(norm_tokens(line)))
            if len(kw & toks) < COVERAGE_MIN_OVERLAP:
                continue
            score = overlap(kw, toks)
            if score >= COVERAGE_MIN_SCORE and (best is None or score > best[0]):
                best = (score, label, line)
        return {"file": best[1], "line": self.redact(best[2], SHORT_CHARS)} if best else None

    def rel_path(self, path, th):
        """Clone-relative path for repo files, else None."""
        if not path or path == "?" or not os.path.isabs(path):
            return None
        root = th.clone
        if not _within(path, root):
            root = next((r for r in self.roots if _within(path, r)), None)
            if root is None:
                return None
        rel = os.path.relpath(path, root)
        return "." if rel == "." else rel

    def finding(self, fid, title, metric, usd_window, usd_month, confidence, artifact, scope, evidence,
                coverage=None):
        metric = {k: (rnd(v, 3) if isinstance(v, float) else v) for k, v in list(metric.items())[:CAPS["metric"]]}
        for e in evidence:
            if e.get("sid"):
                self.session_flags[e["sid"]].add(fid)
        return {"id": fid, "title": title[:80], "metric": metric, "est_usd_window": rnd(usd_window),
                "est_usd_month": rnd(usd_month), "confidence": confidence, "artifact_hint": artifact,
                "scope": scope, "existing_coverage": coverage, "evidence": evidence[:CAPS["evidence"]]}


def unique_names(roots):
    names, count = {}, collections.Counter(os.path.basename(r) for r in roots)
    for r in roots:
        b = os.path.basename(r)
        names[r] = b if count[b] == 1 else os.path.join(os.path.basename(os.path.dirname(r)), b)
    return names


def cache_misses(A, th):
    """Cache-miss events (cache_read < 50% of previous context) with a rule-based cause."""
    for i in range(1, len(th.calls)):
        a, b = th.calls[i - 1], th.calls[i]
        if a.ctx <= MISS_MIN_PREV_CTX or b.cr >= MISS_READ_RATIO * a.ctx:
            continue
        marks = th.markers.get(i - 1, set())
        gap_s = (b.ts - a.ts_end) if (b.ts and a.ts_end) else None
        ttl = TTL_1H_S if (a.w1h > 0 or (a.cw == 0 and th.ttl_1h)) else TTL_5M_S
        if a.model != b.model:
            cause = "model_switch"
        elif i in th.resets:
            cause = "compaction"
        elif gap_s is not None and gap_s > ttl:
            cause = "idle>ttl"
        elif "tools_changed" in marks:
            cause = "tools_changed"
        elif (a.effort or "") != (b.effort or ""):
            cause = "effort_change"
        else:
            cause = "unknown"
        new_tok = max(0, a.out) + A.tok(th.gap_total_chars(i - 1))
        rewrite = max(0.0, min(b.cw, b.ctx) - new_tok)
        r = A.pricer.rates(b.model)
        w = r["w1h"] if b.w1h >= b.w5m else r["w5m"]
        yield {"th": th, "call": i, "gap_s": int(gap_s) if gap_s is not None else None, "prev_ctx": a.ctx,
               "cw": b.cw, "cause": cause, "usd": rewrite * max(0.0, w - r["read"]) / 1e6,
               "from": a.model, "to": b.model}


# =============================================================================
# Heuristics H00-H19 (each returns one finding dict or None)
# =============================================================================
def cleanup_period(A):
    """Effective cleanupPeriodDays (repo settings override user settings), None if unset."""
    cleanup = next((u["settings"].get("cleanupPeriodDays") for u in A.user_cfg
                    if u["settings"].get("cleanupPeriodDays") is not None), None)
    for s in A.inv["settings"].values():
        cleanup = s.get("cleanupPeriodDays") if s.get("cleanupPeriodDays") is not None else cleanup
    return cleanup


def h00_retention(A):
    cleanup = A.cleanup_days
    hist_sessions = len({r["s"] for r in A.H.rows})
    if not (A.tx_coverage < H00_MIN_COVERAGE or cleanup is None):
        return None
    age = (A.now - A.win_start) / 86400.0 if A.win_start else None
    metric = {"tx_sessions": len(A.tx_sids), "hist_sessions": hist_sessions, "coverage": A.tx_coverage,
              "cleanup_period_days": cleanup if cleanup is not None else 30, "oldest_tx_age_days": rnd(age, 1)}
    first_hist = min([r["ts"] for r in A.H.rows if r["ts"]] or [None]) if A.H.rows else None
    ev = [A.ev(excerpt="oldest transcript %s; history since %s; cleanupPeriodDays %s" % (
        iso_day(A.win_start) or "none", iso_day(first_hist) or "none",
        cleanup if cleanup is not None else "unset (default 30)"))]
    return A.finding("H00", "Transcript retention hides most sessions from this audit", metric, 0.0, 0.0,
                     "measured", "user_settings", "user", ev)


def _runs(th):
    """(prompt, start, end) for each distinct prompt run of a main thread."""
    seen, out = set(), []
    for p in th.prompts:
        if p.run not in seen:
            seen.add(p.run)
            out.append((p, p.run[0], p.run[1]))
    return out


def _tool_mix(th, s, e):
    mix = collections.Counter(th.tools[tid].name for c in th.calls[s:e] for tid in c.tool_ids if tid in th.tools)
    return " ".join("%s:%d" % kv for kv in mix.most_common(4))


def h01_long_context(A):
    flagged, long_total, topic = [], 0, 0
    for th in A.threads:
        long_calls = [c for c in th.calls if c.ctx > C_LONG]
        excess = sum(A.pricer.rates(c.model)["read"] * (c.ctx - C_TARGET) for c in long_calls) / 1e6
        runs = _runs(th) if th.kind == "main" else []
        storm = max(runs, key=lambda r: r[2] - r[1], default=None)
        cpp = storm[2] - storm[1] if storm else len(th.calls)
        humans = [p for p in th.prompts if p.human]
        for a, b in zip(humans, humans[1:]):
            k = b.gap + 1
            if k < len(th.calls) and th.calls[k].ctx > H01_TOPIC_CTX and \
                    jaccard(shingles(norm_tokens(a.head)), shingles(norm_tokens(b.head))) < H01_TOPIC_JACCARD:
                topic += 1
        if th.max_ctx > H01_MAX_CTX or len(long_calls) >= H01_LONG_CALLS or cpp > H01_CALLS_PER_PROMPT:
            flagged.append((excess * H01_AVOIDABLE, th, len(long_calls), cpp, storm))
            long_total += len(long_calls)
    if not flagged:
        return None
    usd = sum(f[0] for f in flagged)
    ev = []
    for save, th, n_long, cpp, storm in sorted(flagged, key=lambda f: -f[0])[:CAPS["evidence"]]:
        s, e = (storm[1], storm[2]) if storm else (0, len(th.calls))
        what = A.prompt_excerpt(storm[0], 140) if storm else "(subagent %s)" % (th.agent_type or "?")
        ev.append(A.ev(th, s, excerpt=what, max_ctx=th.max_ctx, long_calls=n_long, calls_in_run=cpp,
                       tools=_tool_mix(th, s, e), save_usd=save))
    metric = {"threads_flagged": len(flagged), "long_calls": long_total,
              "max_ctx": max(f[1].max_ctx for f in flagged), "excess_read_usd": usd / H01_AVOIDABLE,
              "max_calls_per_prompt": max(f[3] for f in flagged), "topic_switches": topic}
    return A.finding("H01", "Long tool loops at large context (every call re-reads it)", metric, usd,
                     usd * A.month_factor, A.conf("measured"), "claude_md", "repo", ev,
                     A.coverage(["subagent", "delegate", "clear", "compact", "context"]))


def _is_web(t):
    return t.name in WEB_TOOLS or t.name.startswith("mcp__")


def h02_injections(A):
    big = [(th, t, tok, A.carry(th, t.gap + 1, tok - T_KEEP_TOOL)) for th, t, tok, _c in A.tool_rows
           if tok >= T_BIG_TOOL and not _is_web(t)]
    pastes = []
    for th in A.threads:
        for p in th.prompts:
            tok = A.tok(p.chars) + p.images * IMAGE_TOKENS
            if p.human and (tok >= T_BIG_PASTE or p.lines >= PASTE_BIG_LINES):
                pastes.append((th, p, tok, A.carry(th, p.gap + 1, tok - T_KEEP_PASTE)))
    hist_big = [x for r in A.H.rows for x in r["pastes"]
                if (x[0] or 0) >= PASTE_BIG_LINES or (x[1] or 0) >= T_BIG_PASTE * A.cpt]
    hist_rows = [r for r in A.H.rows if any((x[0] or 0) >= PASTE_BIG_LINES or (x[1] or 0) >= T_BIG_PASTE * A.cpt
                                            for x in r["pastes"])]
    tool_usd, paste_usd = sum(b[3] for b in big), sum(p[3] for p in pastes)
    if hist_rows:
        per = paste_usd / len(pastes) if pastes else A.default_carry(
            median([(x[0] or 0) * PASTE_TOKENS_PER_LINE for x in hist_big], 0))
        paste_month = A.H.rate(hist_rows) * per
    else:
        paste_month = paste_usd * A.month_factor
    month = tool_usd * A.month_factor + paste_month
    if not big and not pastes and not hist_rows:
        return None
    rows = [(b[3], "tool", b) for b in big] + [(p[3], "paste", p) for p in pastes]
    ev = []
    for usd, kind, x in sorted(rows, key=lambda r: -r[0])[:CAPS["evidence"]]:
        th = x[0]
        if kind == "tool":
            ev.append(A.ev(th, x[1].call, excerpt=A.tool_excerpt(x[1]), tok=int(x[2]),
                           calls_in_thread=len(th.calls), carry_usd=usd))
        else:
            ev.append(A.ev(th, x[1].gap + 1, ts=x[1].ts, excerpt=A.prompt_excerpt(x[1]), tok=int(x[2]),
                           lines=x[1].lines, carry_usd=usd))
    head_sessions = collections.defaultdict(set)
    for th, t, _tok, _c in big:
        if not t.head.startswith("Skill:"):
            head_sessions[t.head].add(th.sid)
    hookable = any(len(s) >= HOOK_MIN_SESSIONS for s in head_sessions.values())
    hooks = [h for s in A.inv["settings"].values() for h in s["hooks"] if h.startswith("PreToolUse")]
    cov = {"file": ".claude/settings.json", "line": "hooks: " + ", ".join(hooks)[:100]} if hooks else \
        A.coverage(["head", "output", "limit", "pipe", "offset", "cat", "large", "truncate", "lines"])
    metric = {"big_tool_results": len(big), "huge": sum(1 for b in big if b[2] >= T_HUGE_TOOL),
              "tokens": int(sum(b[2] for b in big) + sum(p[2] for p in pastes)),
              "persisted": sum(1 for _th, t, _tok, _c in A.tool_rows if t.persisted),
              "whole_file_reads": sum(1 for _th, t, tok, _c in A.tool_rows if t.whole_read and tok > T_WHOLE_READ),
              "big_pastes_month": rnd(A.H.rate(hist_rows), 1) if hist_rows else len(pastes)}
    conf = A.conf("measured") if tool_usd * A.month_factor >= paste_month else "extrapolated"
    return A.finding("H02", "Oversized tool outputs and pastes carried through later calls", metric,
                     tool_usd + paste_usd, month, conf, "hook" if hookable else "claude_md", "repo", ev, cov)


def _cluster_cost(A, c):
    cpo = c["calls_per_occ_p50"] or DEFAULT_CALLS_PER_PROMPT
    return c["per_month"] * (max(0, cpo - CALLS_WITH_SKILL) + (c["corr_after"] or 0) * REDO_CALLS) * \
        A.ctx_med * A.rates["read"] / 1e6


def enrich_clusters(A):
    """Transcript-derived cluster stats: calls per occurrence, corrections after, heads."""
    for c in A.H.clusters:
        cpos, heads, corr = [], collections.Counter(), 0
        for r in c["_rows"]:
            if r.get("tx"):
                th, p = r["tx"]
                s, e = p.run
                cpos.append(e - s)
                heads.update(th.tools[tid].head for x in th.calls[s:e] for tid in x.tool_ids
                             if tid in th.tools and th.tools[tid].name == "Bash")
            corr += any(x["corr"] for x in A.H.next_human(r))
        c["calls_per_occ_p50"] = median(cpos)
        c["corr_after"] = rnd(corr / float(c["n"]), 2) if c["n"] else None
        c["top_heads"] = [A.redact(h, 40) for h, _n in heads.most_common(3)]


def procedure_clusters(A):
    return [c for c in A.H.clusters if c["kind"] == "procedure" and c["n"] >= H03_MIN_N and
            (c["sessions"] >= H03_MIN_SESSIONS or c["clones"] >= H03_MIN_CLONES)]


def h03_procedures(A):
    qual = A.procedures
    if not qual:
        return None
    costs = [(_cluster_cost(A, c), c) for c in qual]
    month = sum(x[0] for x in costs)
    window = sum(x[0] / 30.0 * A.H.days for x in costs)
    ev = [A.ev(excerpt=A.redact(c["medoid"]), cid=c["cid"], n=c["n"], sessions=c["sessions"],
               per_month=c["per_month"], calls_per_occ=c["calls_per_occ_p50"], usd_month=usd)
          for usd, c in sorted(costs, key=lambda x: -x[0])[:CAPS["evidence"]]]
    measured = any(c["calls_per_occ_p50"] for c in qual)
    top = max(costs, key=lambda x: x[0])[1]
    metric = {"clusters": len(qual), "occurrences_month": sum(c["per_month"] for c in qual),
              "calls_per_occ_p50": median([c["calls_per_occ_p50"] for c in qual if c["calls_per_occ_p50"]]),
              "chains": len(A.H.chains), "ctx_med": int(A.ctx_med)}
    return A.finding("H03", "Repeated multi-step requests that could be skills", metric, window, month,
                     "extrapolated" if measured else "heuristic", "skill", "repo", ev, A.coverage(top["_toks"]))


def _skill_names(A):
    names = {s["name"]: "repo" for s in A.inv["skills"]}
    names.update({c: "repo" for c in A.inv["commands"]})
    for u in A.user_cfg:
        for s in u["skills"]:
            names.setdefault(s, "user")
    for th in A.mains:
        for s in th.skills_listed:
            names.setdefault(s.split(":")[-1], "user")
    return {n: s for n, s in names.items() if len(n) >= 3}


def h04_skill_triggers(A):
    names = _skill_names(A)
    alt = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    rx = re.compile(r"(?i)\b(load|use|read|follow|apply|invoke)\b.{0,40}?\b(skills?|claude\.md%s)\b" %
                    ("|" + alt if alt else ""))
    targets = collections.defaultdict(list)
    for r in A.H.rows:
        if r["k"] != "prompt" or not rx.search(r["d"]):
            continue
        low = r["d"].lower()
        hit = [n for n in names if re.search(r"(?<![\w-])%s(?![\w-])" % re.escape(n.lower()), low)]
        for n in hit or (["CLAUDE.md"] if "claude.md" in low else ["skills"]):
            targets[n].append(r)
    qual = {n: rs for n, rs in targets.items()
            if len(rs) >= H04_MIN_N and len({r["s"] for r in rs}) >= H04_MIN_SESSIONS}
    if not qual:
        return None
    month = sum(A.H.rate(rs) for rs in qual.values()) * A.turn_usd()
    descs = {s["name"]: s["desc"] for s in A.inv["skills"]}
    ev = [A.ev(excerpt=A.redact(rs[-1]["d"]), target=n, n=len(rs), sessions=len({r["s"] for r in rs}),
               description=descs.get(n, ""))
          for n, rs in sorted(qual.items(), key=lambda kv: -len(kv[1]))[:CAPS["evidence"]]]
    top = max(qual, key=lambda n: len(qual[n]))
    scope = "user" if names.get(top) == "user" else "repo"
    cov = {"file": ".claude/skills/%s/SKILL.md" % top, "line": A.redact(descs[top], SHORT_CHARS)} \
        if descs.get(top) else None
    metric = {"targets": len(qual), "prompts": sum(len(rs) for rs in qual.values()),
              "per_month": sum(A.H.rate(rs) for rs in qual.values()),
              "skill_tool_calls": sum(1 for _th, t, _tok, _c in A.tool_rows if t.name == "Skill")}
    return A.finding("H04", "Skills or CLAUDE.md are loaded by hand (triggers not firing)", metric,
                     month / 30.0 * A.H.days, month, "heuristic", "skill", scope, ev, cov)


def _correction_calls(r):
    """(wasted, redo) calls for a correction linked to a transcript, else defaults."""
    if not r.get("tx"):
        return H05_DEFAULT_WASTED, H05_DEFAULT_REDO, False
    th, p = r["tx"]
    prev = [q for q in th.prompts if q.run[1] <= p.run[0]]
    wasted = (prev[-1].run[1] - prev[-1].run[0]) if prev else 0
    return wasted, p.run[1] - p.run[0], True


def _prev_tool(A, r):
    if not r.get("tx"):
        return None
    th, p = r["tx"]
    tools = [th.tools[tid] for c in th.calls[:p.gap + 1] for tid in c.tool_ids if tid in th.tools]
    return A.tool_excerpt(tools[-1], SHORT_CHARS) if tools else None


def h05_corrections(A):
    qual = [c for c in A.H.clusters if c["kind"] in ("correction", "preference") and c["n"] >= H05_MIN_N
            and c["sessions"] >= H05_MIN_SESSIONS]
    if not qual:
        return None
    rows, measured = [], False
    for c in qual:
        reactive = [r for r in c["_rows"] if not r.get("first")]
        share = len(reactive) / float(c["n"])
        if share >= 0.5:
            calls = [_correction_calls(r) for r in reactive]
            measured = measured or any(x[2] for x in calls)
            per_occ = sum(x[0] + x[1] for x in calls) / float(len(calls)) * A.turn_usd()
            usd = A.H.rate(reactive) * per_occ
        else:
            usd = A.H.rate(c["_rows"]) * A.default_carry(A.tok(c["avg_chars"]))
        rows.append((usd, share, c))
    month = sum(x[0] for x in rows)
    ev = []
    for usd, share, c in sorted(rows, key=lambda x: -x[0])[:CAPS["evidence"]]:
        example = next((r for r in c["_rows"] if r.get("tx") and not r.get("first")), None)
        ev.append(A.ev(excerpt=A.redact(c["medoid"]), cid=c["cid"], n=c["n"], sessions=c["sessions"],
                       reactive=rnd(share), prev_tool=_prev_tool(A, example) if example else None,
                       existing=(A.coverage(c["_toks"]) or {}).get("line"), usd_month=usd))
    after_int = sum(1 for th in A.mains for p in th.prompts if p.human and p.after_interrupt)
    metric = {"clusters": len(qual), "prompts": sum(c["n"] for c in qual),
              "reactive_share": sum(x[1] * x[2]["n"] for x in rows) / float(sum(c["n"] for c in qual)),
              "clones": max(c["clones"] for c in qual), "after_interrupt": after_int}
    top = max(rows, key=lambda x: x[0])[2]
    return A.finding("H05", "Repeated corrections and standing preferences missing from CLAUDE.md", metric,
                     month / 30.0 * A.H.days, month, "extrapolated" if measured else "heuristic", "claude_md",
                     "repo", ev, A.coverage(top["_toks"]))


_PERSONAL_RE = re.compile(r"/Users/|/home/|[A-Za-z]:\\\\Users")


def looks_personal(text):
    """Machine-specific paths, credentials or emails: never proposed for the shared repo."""
    return bool(_PERSONAL_RE.search(text) or any(rx.search(text) for rx, _rep in _SECRET_SUBS))


def memory_inventory(A):
    """Per-clone memory files, near-duplicates across clones and repo CLAUDE.md coverage."""
    files = []
    for cl in A.clones:
        for pd in cl["project_dirs"]:
            mem = os.path.join(pd["dir"], "memory")
            for p in sorted(glob.glob(os.path.join(mem, "*.md"))) if pd["memory"] else []:
                if os.path.basename(p) != "MEMORY.md":
                    text = read_text(p) or ""
                    toks = norm_tokens(text, 20000)
                    files.append({"clone": A.name(cl["root"]), "file": os.path.basename(p), "path": p,
                                  "chars": len(text), "toks": frozenset(toks),
                                  "sh": frozenset(" ".join(toks[i:i + 5]) for i in range(max(0, len(toks) - 4))),
                                  "personal": looks_personal(text)})
    sections = [frozenset(norm_tokens(l)) for _lbl, l in A.inv["_lines"]]
    claude_toks = frozenset(t for s in sections for t in s)
    all_clones = [A.name(c["root"]) for c in A.clones]
    per_clone = collections.Counter(f["clone"] for f in files)
    promotable, seen, personal = [], set(), 0
    for f in files:
        if f["path"] in seen or not f["file"].startswith(("feedback_", "project_")):
            continue
        dups = [g for g in files if g is f or (g["file"] == f["file"] or jaccard(f["sh"], g["sh"]) >= MEMORY_DUP_JACCARD)]
        seen.update(g["path"] for g in dups)
        covered = f["toks"] and len(f["toks"] & claude_toks) / float(len(f["toks"])) >= MEMORY_COVERED
        if covered:
            continue
        if f["personal"]:
            personal += 1
            continue
        present = sorted({g["clone"] for g in dups})
        promotable.append({"file": f["file"], "in": present, "missing": [c for c in all_clones if c not in present],
                           "tok": int(A.tok(f["chars"])), "path": A.redact(f["path"], SHORT_CHARS)})
    return {"per_clone": dict(per_clone), "promotable": promotable, "skipped_personal": personal}


def h06_memory(A):
    mem = A.memory
    prom = mem["promotable"]
    if not prom:
        return None
    month = sum(max(1, len(p["missing"])) for p in prom) * A.turn_usd(REDO_CALLS)
    ev = [A.ev(excerpt="%s (in %s; missing in %s)" % (p["file"], ", ".join(p["in"]), ", ".join(p["missing"]) or "-"),
               path=p["path"], tok=p["tok"]) for p in prom[:CAPS["evidence"]]]
    metric = {"promotable": len(prom), "clones_with_memory": len(mem["per_clone"]),
              "memory_files": sum(mem["per_clone"].values()), "skipped_personal": mem["skipped_personal"]}
    return A.finding("H06", "Per-clone memory feedback not promoted to the repo CLAUDE.md", metric,
                     month / 30.0 * A.H.days, month, "heuristic", "claude_md", "repo", ev)


def h07_model_switch(A):
    switches = []
    for th in A.mains:
        for a, b in zip(th.calls, th.calls[1:]):
            if a.model != b.model:
                switches.append((th, b.idx, a, b))
    miss_usd = sum(e["usd"] for e in A.misses if e["cause"] == "model_switch" and e["th"].kind == "main")
    hist_sessions = len(A.H.by_session)
    share = len(A.H.mid_model) / float(hist_sessions) if hist_sessions else 0.0
    hist_month = A.H.rate([r for r in A.H.rows if r["k"] == "slash" and r["cmd"] == "/model" and r.get("mid")]) * \
        A.ctx_med * (A.rates["w1h"] - A.rates["read"]) / 1e6
    month = miss_usd * A.month_factor if switches else hist_month
    if share < H07_MIN_SESSION_SHARE and month < MIN_FINDING_USD_MONTH:
        return None
    pairs = collections.Counter("%s->%s" % (Pricer.normalize(a.model), Pricer.normalize(b.model))
                                for _th, _i, a, b in switches)
    ev = [A.ev(th, i, excerpt="%s -> %s at ctx %d" % (a.model, b.model, a.ctx)) for th, i, a, b in switches[:2]]
    if A.H.model_targets:
        ev.append(A.ev(excerpt="history /model targets: " + ", ".join(
            "%s x%d" % kv for kv in A.H.model_targets.most_common(4))))
    repo_model = next((s.get("model") for s in A.inv["settings"].values() if s.get("model")), None)
    metric = {"hist_sessions_mid_model": len(A.H.mid_model), "session_share": share,
              "tx_switches": len(switches), "median_ctx_at_switch": median([a.ctx for _t, _i, a, _b in switches], 0),
              "top_pair": pairs.most_common(1)[0][0] if pairs else None}
    cov = {"file": ".claude/settings.json", "line": "model: %s" % repo_model} if repo_model else None
    return A.finding("H07", "Mid-session model switches rebuild the whole prompt cache", metric,
                     miss_usd if switches else hist_month / 30.0 * A.H.days, month,
                     A.conf("measured") if switches else "heuristic", "settings", "repo", ev, cov)


def h08_cache_expiry(A):
    events = [e for e in A.misses if e["cause"] != "model_switch"]
    if not events:
        return None
    avoid = sum(e["usd"] * MISS_AVOIDABLE[e["cause"]] for e in events)
    by_th = collections.defaultdict(float)
    for e in events:
        by_th[id(e["th"])] += e["usd"]
    heavy = any(by_th[id(t)] > H08_SESSION_SHARE * t.usd for t in A.threads if t.usd)
    if avoid * A.month_factor < MIN_FINDING_USD_MONTH and not heavy:
        return None
    causes = collections.Counter(e["cause"] for e in events)
    ev = [A.ev(e["th"], e["call"], excerpt="%s after %ss gap, prev ctx %d" % (e["cause"], e["gap_s"], e["prev_ctx"]),
               cw=e["cw"], usd=e["usd"]) for e in sorted(events, key=lambda e: -e["usd"])[:CAPS["evidence"]]]
    metric = {"events": len(events), "rewrite_usd": sum(e["usd"] for e in events), "avoidable_usd": avoid,
              "idle": causes["idle>ttl"], "unknown": causes["unknown"], "compaction": causes["compaction"]}
    return A.finding("H08", "Prompt cache rebuilt after idle gaps or tool changes", metric, avoid,
                     avoid * A.month_factor, A.conf("measured"), "workflow", "user", ev)


def _tasks(A):
    """Human-prompt tasks of main threads: (thread, prompt, calls, edits)."""
    out = []
    for th in A.mains:
        for p, s, e in _runs(th):
            calls = th.calls[s:e]
            if p.human and calls:
                edits = sum(1 for c in calls for tid in c.tool_ids if tid in th.tools and th.tools[tid].writes)
                out.append((th, p, calls, edits))
    return out


def h09_effort(A):
    tasks = _tasks(A)
    high = [x for x in tasks if (x[2][0].effort or "") in H09_HIGH_EFFORTS]
    proc = {c["cid"] for c in A.procedures}
    small = [x for x in high if (len(x[2]) <= H09_SMALL_CALLS and x[3] == 0) or
             (x[1].hist is not None and x[1].hist.get("cid") in proc)]
    if len(small) < H09_MIN_TASKS:
        return None
    out = sum(max(0, c.out) for x in small for c in x[2])
    think = sum(c.think for x in small for c in x[2])
    usd_small = sum(c.usd for x in small for c in x[2])
    usd_high = sum(c.usd for x in high for c in x[2]) or 1.0
    share = think / float(out) if out else 0.0
    if not (share > H09_THINK_SHARE or usd_small / usd_high >= H09_USD_SHARE):
        return None
    usd = sum(c.think * A.pricer.rates(c.model)["out"] for x in small for c in x[2]) / 1e6 * 0.5
    if not think:
        usd = usd_small * 0.25
    ev = [A.ev(th, calls[0].idx, ts=p.ts, excerpt=A.prompt_excerpt(p, 140), effort=calls[0].effort,
               calls=len(calls), think=sum(c.think for c in calls), usd=sum(c.usd for c in calls))
          for th, p, calls, _e in sorted(small, key=lambda x: -sum(c.usd for c in x[2]))[:CAPS["evidence"]]]
    metric = {"small_high_effort_tasks": len(small), "high_effort_tasks": len(high), "thinking_share": share,
              "usd_small_share": usd_small / usd_high, "thinking_recorded": int(think > 0)}
    eff = next((u["settings"].get("effortLevel") for u in A.user_cfg if u["settings"].get("effortLevel")), None)
    cov = {"file": "~/.claude/settings.json", "line": "effortLevel: %s" % eff} if eff else None
    return A.finding("H09", "High effort spent on small or routine tasks", metric, usd, usd * A.month_factor,
                     "heuristic", "user_settings", "user", ev, cov)


def subagent_rows(A):
    returned = {t.agent_id: t.chars for th in A.mains for t in th.tools.values() if t.agent_id}
    rows = []
    for th in A.subs:
        absorbed = sum(A.tok(t.chars) + t.images * IMAGE_TOKENS for t in th.tools.values())
        ret_chars = th.returned_chars if th.returned_chars is not None else returned.get(th.agent_id)
        ret = A.tok(ret_chars) if ret_chars is not None else None
        model = collections.Counter(c.model for c in th.calls).most_common(1)[0][0]
        search_only = th.tools and all(not t.writes and (t.name in READ_TOOLS or t.name in SEARCH_TOOLS or
                                                          t.name in WEB_TOOLS or t.name == "Bash")
                                       for t in th.tools.values())
        rows.append({"th": th, "type": th.agent_type or "?", "model": model, "calls": len(th.calls),
                     "first_ctx": th.first_ctx, "absorbed": int(absorbed),
                     "returned": int(ret) if ret is not None else None,
                     "yield": rnd(absorbed / ret, 1) if ret else None, "usd": th.usd,
                     "overhead": th.calls[0].comp[2] + th.calls[0].comp[3], "search_only": bool(search_only)})
    return rows


def h10_subagents(A):
    rows = A.sub_rows
    low = [r for r in rows if r["calls"] <= 2 or r["absorbed"] < r["first_ctx"]]
    cheap = A.pricer.rates(CHEAP_MODEL)
    pricey = [r for r in rows if r["search_only"] and A.pricer.rates(r["model"])["in"] >= 3 * cheap["in"]]
    pricey_usd = sum(r["usd"] * (1 - cheap["in"] / A.pricer.rates(r["model"])["in"]) * 0.5 for r in pricey)
    missed = []
    for th in A.mains:
        if A.subs_by_sid.get(th.sid) or th.max_ctx <= H01_MAX_CTX:
            continue
        first_edit = next((c.idx for c in th.calls for tid in c.tool_ids if tid in th.tools and th.tools[tid].writes),
                          len(th.calls))
        explore = [(t, tok) for t_th, t, tok, _c in A.tool_rows if t_th is th and t.call < first_edit and t.reads
                   and not t.writes]
        tok = sum(x[1] for x in explore)
        if tok > H10_EXPLORE_TOKENS:
            missed.append((th, explore[0][0].call, tok, A.carry(th, explore[0][0].gap + 1, tok - 1000)))
    usd = sum(r["overhead"] for r in low) + pricey_usd + sum(m[3] for m in missed)
    if usd * A.month_factor < MIN_FINDING_USD_MONTH:
        return None
    ev = [A.ev(th, k, excerpt="main thread explored %d tok before first edit, no subagent" % tok, usd=u)
          for th, k, tok, u in sorted(missed, key=lambda m: -m[3])[:2]]
    for r in sorted(low + pricey, key=lambda r: -r["usd"])[:CAPS["evidence"] - len(ev)]:
        ev.append(A.ev(r["th"], 0, excerpt="%s %s: %d calls, absorbed %d tok, returned %s tok" % (
            r["type"], r["model"], r["calls"], r["absorbed"], r["returned"]), desc=r["th"].desc or "", usd=r["usd"]))
    metric = {"subagents": len(rows), "low_yield": len(low), "search_only_pricey": len(pricey),
              "missed_delegation": len(missed), "sub_usd": sum(r["usd"] for r in rows)}
    return A.finding("H10", "Subagent overhead vs. delegation opportunities", metric, usd, usd * A.month_factor,
                     "heuristic", "agent", "repo", ev, A.coverage(["subagent", "delegate", "agent"]))


def normalize_cmd(t):
    s = strip_prefixes(t.arg) if t.name == "Bash" else "%s %s" % (t.name, t.arg)
    s = re.sub(r"(['\"]).*?\1", "STR", s)
    s = re.sub(r"(?:~|\.{1,2})?(?:/[\w.\-@]+)+/?", "PATH", s)
    s = re.sub(r"\b[0-9a-f]{7,40}\b", "HEX", s)
    return re.sub(r"\s+", " ", re.sub(r"\b\d+\b", "N", s)).strip()[:300]


def error_class(err):
    if re.search(r"Exit code (124|137|143)\b|timed out", err, re.I):
        return "timeout"
    if re.search(r"not found|No such file|does not exist|ENOENT|cannot find|Unknown command", err, re.I):
        return "not_found"
    if re.search(r"Permission denied|EACCES|not permitted|rejected|doesn't want to proceed", err, re.I):
        return "permission"
    if re.search(r"\bFAIL|failed|failing|AssertionError", err):
        return "test_fail"
    return "other"


def error_analysis(A):
    """Retry loops per thread and failing commands repeated across sessions."""
    loops, agg = [], {}
    for th in A.threads:
        errs = [t for t in sorted(th.tools.values(), key=lambda t: t.call) if t.error and not t.rejected]
        chain = []
        for t in errs:
            norm = normalize_cmd(t)
            a = agg.setdefault(norm, {"cmd": norm, "err": collections.Counter(), "n": 0, "sessions": set(),
                                      "clones": set(), "loop": False, "ex": t, "th": th})
            a["n"] += 1
            a["err"][t.err] += 1
            a["sessions"].add(th.sid)
            a["clones"].add(th.clone)
            toks = frozenset(norm.split())
            if chain and chain[-1][0].name == t.name and t.call - chain[-1][0].call <= H11_LOOP_WINDOW and \
                    jaccard(chain[-1][1], toks) >= H11_LOOP_JACCARD:
                chain.append((t, toks))
            else:
                if len(chain) >= H11_LOOP_MIN:
                    loops.append((th, [x[0] for x in chain]))
                chain = [(t, toks)]
        if len(chain) >= H11_LOOP_MIN:
            loops.append((th, [x[0] for x in chain]))
    for th, chain in loops:
        agg[normalize_cmd(chain[0])]["loop"] = True
    return loops, agg


def h11_errors(A):
    loops, agg = A.loops, A.err_agg
    repeated = [a for a in agg.values() if len(a["sessions"]) >= H11_MIN_SESSIONS]
    if not loops and not repeated:
        return None
    usd = sum(c.usd for th, chain in loops for c in th.calls[chain[0].call:chain[-1].call + 1])
    usd += sum(A.turn_usd(a["n"]) for a in repeated if not a["loop"])
    ev = [A.ev(th, chain[0].call, excerpt=A.redact(normalize_cmd(chain[0])), err=chain[0].err, n=len(chain),
               cls=error_class(chain[0].err)) for th, chain in loops[:2]]
    for a in sorted(repeated, key=lambda a: -len(a["sessions"]))[:CAPS["evidence"] - len(ev)]:
        ev.append(A.ev(a["th"], a["ex"].call, excerpt=A.redact(a["cmd"]), err=a["err"].most_common(1)[0][0],
                       n=a["n"], sessions=len(a["sessions"])))
    errors = [t for th in A.threads for t in th.tools.values() if t.error]
    metric = {"loops": len(loops), "repeated_failures": len(repeated), "errors": len(errors),
              "timeouts": sum(1 for t in errors if error_class(t.err) == "timeout"),
              "not_found": sum(1 for t in errors if error_class(t.err) == "not_found")}
    words = set(norm_tokens(" ".join(a["cmd"] for a in repeated[:3]))) | {"command", "run", "commands"}
    return A.finding("H11", "Failing commands retried in loops or across sessions", metric, usd,
                     usd * A.month_factor, A.conf("measured"), "claude_md", "repo", ev, A.coverage(words))


def path_analysis(A):
    """Session-start hot paths and within-session re-reads (repo files only)."""
    start_sets, rereads, n_sessions = collections.defaultdict(list), [], 0
    for th in A.mains:
        n_sessions += 1
        tools = sorted(th.tools.values(), key=lambda t: t.call)
        first_edit = next((t.call for t in tools if t.writes), len(th.calls))
        limit = min(H12_START_CALLS, first_edit)
        seen_start, since_write, extra = {}, collections.Counter(), collections.defaultdict(list)
        for t in tools:
            per = (A.tok(t.chars) / len(t.reads)) if t.reads else 0.0
            for w in t.writes:
                since_write[A.rel_path(w, th)] = 0
            for p in t.reads:
                rel = A.rel_path(p, th)
                if not rel:
                    continue
                if t.call < limit and rel not in seen_start:
                    seen_start[rel] = (per, t)
                since_write[rel] += 1
                if since_write[rel] > 1:
                    extra[rel].append((per, t))
        for rel, v in seen_start.items():
            start_sets[rel].append((th, v[0], v[1]))
        for rel, xs in extra.items():
            if len(xs) + 1 >= H12_REREADS:
                rereads.append((th, rel, len(xs) + 1, xs))
    return start_sets, rereads, n_sessions


def build_paths(A):
    """Hot session-start paths and re-read paths, each with its carry cost in "_usd"."""
    start_sets, rereads, n = path_analysis(A)
    texts = [f["text_lc"] for f in A.inv["instruction_files"]]
    hot = []
    for rel, occ in start_sets.items():
        sessions = {x[0].sid for x in occ}
        if len(sessions) >= H12_HOT_SESSIONS and len(sessions) / float(max(1, n)) >= H12_HOT_SHARE:
            hot.append({"path": A.redact(rel, SHORT_CHARS), "sessions": len(sessions), "share": rnd(len(sessions) / float(n)),
                        "avg_tok": int(sum(x[1] for x in occ) / len(occ)),
                        "in_claude_md": any(rel.lower() in t or os.path.basename(rel).lower() in t for t in texts),
                        "_usd": sum(A.carry(x[0], x[2].gap + 1, x[1]) for x in occ) * H12_AVOIDABLE})
    rer = [{"path": A.redact(rel, SHORT_CHARS), "max_in_session": cnt, "sessions": 1,
            "_usd": sum(A.carry(th, t.gap + 1, tok) for tok, t in xs), "_th": th, "_call": xs[0][1].call}
           for th, rel, cnt, xs in rereads]
    hot.sort(key=lambda h: -h["_usd"])
    rer.sort(key=lambda r: -r["max_in_session"])
    return {"session_start_hot": hot, "rereads": rer, "sessions": n}


def h12_exploration(A):
    hot, rer, n = A.paths["session_start_hot"], A.paths["rereads"], A.paths["sessions"]
    usd = sum(h["_usd"] for h in hot) + sum(r["_usd"] for r in rer)
    if (not hot and not rer) or usd * A.month_factor < MIN_FINDING_USD_MONTH:
        return None
    ev = [A.ev(excerpt="%s read at start of %d sessions" % (h["path"], h["sessions"]), tok=h["avg_tok"])
          for h in hot[:2]]
    ev += [A.ev(r["_th"], r["_call"], excerpt="%s read %dx without edits" % (r["path"], r["max_in_session"]))
           for r in rer[:CAPS["evidence"] - len(ev)]]
    metric = {"hot_paths": len(hot), "reread_paths": len(rer), "sessions": n,
              "hot_not_in_claude_md": sum(1 for h in hot if not h["in_claude_md"])}
    return A.finding("H12", "Same files re-explored every session or re-read within one", metric, usd,
                     usd * A.month_factor, A.conf("measured"), "claude_md", "repo", ev,
                     A.coverage(["map", "structure", "layout", "directory", "files"]))


def overhead_analysis(A):
    """Fixed per-session context: startup components, listed vs used skills, MCP servers."""
    comps = collections.defaultdict(list)
    for th in A.mains:
        for k, v in th.startup.items():
            comps[k].append(v)
    tokens = {k: int(A.tok(median(v, 0))) for k, v in comps.items()}
    listed = set().union(*[th.skills_listed for th in A.mains]) if A.mains else set()
    used = collections.Counter(t.arg.split(":")[-1] for th in A.threads for t in th.tools.values() if t.name == "Skill")
    for r in A.H.rows:
        if r["k"] == "slash" and any(r["cmd"][1:] == n.split(":")[-1] for n in listed):
            used[r["cmd"][1:]] += 1
    listed_short = {n.split(":")[-1] for n in listed}
    used_listed = len(listed_short & set(used))
    servers = collections.defaultdict(lambda: {"sessions": 0, "calls": 0})
    for th in A.mains:
        for s in th.mcp_servers:
            servers[s]["sessions"] += 1
    for th in A.threads:
        for t in th.tools.values():
            if t.name.startswith("mcp__"):
                servers[norm_server(mcp_server(t.name))]["calls"] += 1
    defs = collections.Counter()
    for th in A.mains:
        for n, c in th.tool_defs.items():
            defs[n] = max(defs[n], c)
    plugins = sorted({p for u in A.user_cfg for p in u["settings"].get("enabledPlugins") or []})
    return {"components_tokens": tokens,
            "first_ctx_p50": {"main": median([t.first_ctx for t in A.mains]), "sub": median([t.first_ctx for t in A.subs])},
            "skills": {"listed": len(listed_short), "used_listed": used_listed,
                       "sessions_with_listing": sum(1 for t in A.mains if t.skills_listed),
                       "used": dict(used.most_common(CAPS["names"]))},
            "unused_skills": sorted(listed_short - set(used))[:CAPS["names"]],
            "mcp": dict(sorted(servers.items())[:CAPS["names"]]), "plugins_enabled": plugins[:CAPS["names"]],
            "tool_definitions_top": [{"tool": n, "tok": int(A.tok(c))} for n, c in defs.most_common(8)]}


def h13_overhead(A):
    ov = A.overhead
    tok, removable, ev = ov["components_tokens"], [], []
    sk = ov["skills"]
    if sk["sessions_with_listing"] >= H13_SKILL_SESSIONS and sk["listed"] and \
            sk["used_listed"] / float(sk["listed"]) < H13_SKILL_USED_SHARE:
        part = tok.get("skill_listing", 0) * len(ov["unused_skills"]) / float(sk["listed"])
        removable.append(("user", part, "skill listing ~%d tok: %d skills listed, %d used" % (
            tok.get("skill_listing", 0), sk["listed"], len(sk["used"]))))
    idle = [s for s, v in ov["mcp"].items() if v["sessions"] >= H13_MCP_SESSIONS and v["calls"] == 0]
    if idle:
        part = tok.get("mcp_instructions", 0) * len(idle) / float(max(1, len(ov["mcp"])))
        removable.append(("user", part, "MCP servers never called: " + ", ".join(idle[:5])))
    always = sum(f["chars"] for f in A.inv["instruction_files"] if f["always"])
    md_tok = A.tok(always)
    if md_tok > H13_CLAUDE_MD_TOKENS:
        secs = sorted(((f["path"], h, c) for f in A.inv["instruction_files"] if f["always"] for h, c in f["sections"]),
                      key=lambda x: -x[2])
        removable.append(("repo", (md_tok - H13_CLAUDE_MD_TOKENS) * 0.5, "always-loaded instructions %d tok; largest: %s" % (
            md_tok, "; ".join("%s %s %d tok" % (p, h, A.tok(c)) for p, h, c in secs[:2]))))
    if tok.get("git_status", 0) > H13_GIT_STATUS_TOKENS:
        removable.append(("repo", tok["git_status"] - H13_GIT_STATUS_TOKENS,
                          "gitStatus at startup %d tok (untracked files?)" % tok["git_status"]))
    if not removable:
        return None
    total = sum(r[1] for r in removable)
    shares = [t.calls[0].cw / float(t.calls[0].ctx) for t in A.mains if t.calls[0].ctx]
    cw_share = median(shares, DEFAULT_CW_SHARE)
    n_calls = sum(len(t.calls) for t in A.mains) / float(len(A.mains)) if A.mains else DEFAULT_CALLS_PER_SESSION
    per_session = total * (A.rates["w1h"] * cw_share + A.rates["read"] * max(0.0, n_calls - 1)) / 1e6
    month = A.sessions_per_month * per_session
    ev = [A.ev(excerpt=desc, tok=int(part)) for scope, part, desc in sorted(removable, key=lambda r: -r[1])]
    metric = {"removable_tok": int(total), "first_ctx_main": ov["first_ctx_p50"]["main"],
              "skill_listing_tok": tok.get("skill_listing", 0), "claude_md_tok": int(md_tok),
              "git_status_tok": tok.get("git_status", 0), "unused_skills": len(ov["unused_skills"])}
    scope = max(removable, key=lambda r: r[1])[0]
    return A.finding("H13", "Fixed per-session context overhead that is rarely used", metric,
                     per_session * len(A.mains), month, "extrapolated" if A.mains else "heuristic",
                     "settings" if scope == "user" else "claude_md", scope, ev)


def h14_acks(A):
    human = A.H.human
    acks = [r for r in human if r["k"] == "ack"]
    rate = len(acks) / float(len(human)) if human else 0.0
    tx_acks = [(th, p) for th in A.mains for p in th.prompts if p.human and ACK_RE.match(p.head.strip())]
    after_q = sum(1 for th, p in tx_acks if 0 <= p.gap < len(th.calls) and th.calls[p.gap].question)
    interrupts, wasted = 0, 0.0
    for th in A.mains:
        for g in (g for g, m in th.markers.items() if "interrupt" in m):
            interrupts += 1
            run = next(((s, e) for _p, s, e in _runs(th) if s <= g < e), None)
            if run:
                wasted += sum(c.usd for c in th.calls[run[0]:g + 1])
    per_session = interrupts / float(len(A.mains)) if A.mains else 0.0
    if rate < H14_ACK_RATE and per_session < H14_INTERRUPTS_PER_SESSION:
        return None
    month = wasted * A.month_factor + A.H.rate(acks) * A.turn_usd()
    top = collections.Counter(r["d"].strip().lower() for r in acks).most_common(3)
    ev = [A.ev(excerpt="acks: " + ", ".join("%s x%d" % kv for kv in top))] if top else []
    ev += [A.ev(th, p.gap, ts=p.ts, excerpt=A.prompt_excerpt(p, 60), after_question=bool(
        0 <= p.gap < len(th.calls) and th.calls[p.gap].question)) for th, p in tx_acks[:2]]
    metric = {"acks": len(acks), "ack_rate": rate, "ack_after_question": after_q, "tx_acks": len(tx_acks),
              "interrupts": interrupts, "interrupt_usd": wasted}
    return A.finding("H14", "Confirmation prompts ('continue', 'yes') and interrupted turns", metric,
                     wasted, month, "heuristic", "claude_md", "repo", ev,
                     A.coverage(["confirmation", "pause", "ask", "continue", "without"]))


def h15_images(A):
    tx = [(th, k, n) for th in A.threads for k, n in th.gap_images.items() if n]
    usd = sum(A.carry(th, k + 1, n * IMAGE_TOKENS) for th, k, n in tx)
    img_rows = [r for r in A.H.rows if r["images"]]
    n_hist = sum(r["images"] for r in img_rows)
    per = usd / float(sum(n for _t, _k, n in tx)) if tx else A.default_carry(IMAGE_TOKENS)
    month = (A.H.rate(img_rows) * per) if img_rows else usd * A.month_factor
    if n_hist + sum(n for _t, _k, n in tx) < H15_MIN_IMAGES or month < MIN_FINDING_USD_MONTH:
        return None
    ev = [A.ev(th, k + 1, excerpt="%d image(s) entered at call %d of %d" % (n, k + 1, len(th.calls)))
          for th, k, n in tx[:CAPS["evidence"]]]
    metric = {"tx_images": sum(n for _t, _k, n in tx), "hist_images": n_hist, "carry_usd_per_image": per}
    return A.finding("H15", "Screenshots carried through long sessions", metric, usd, month,
                     "extrapolated", "workflow", "user", ev)


def h16_web_mcp(A):
    big = [(th, t, tok, A.carry(th, t.gap + 1, tok - T_KEEP_TOOL)) for th, t, tok, _c in A.tool_rows
           if _is_web(t) and tok > H16_MIN_TOKENS]
    usd = sum(b[3] for b in big)
    if not big or usd * A.month_factor < MIN_FINDING_USD_MONTH:
        return None
    by = collections.Counter()
    for _th, t, tok, _c in big:
        by[t.head] += tok
    ev = [A.ev(th, t.call, excerpt=A.tool_excerpt(t), tok=int(tok), carry_usd=c)
          for th, t, tok, c in sorted(big, key=lambda b: -b[3])[:CAPS["evidence"]]]
    metric = {"results": len(big), "tokens": int(sum(b[2] for b in big)), "sources": len(by),
              "server_tool_requests": sum(c.web for th in A.threads for c in th.calls)}
    return A.finding("H16", "Large web fetch / MCP results kept in context", metric, usd, usd * A.month_factor,
                     A.conf("measured"), "settings", "repo", ev)


def h17_permissions(A):
    rej = [(th, t) for th in A.threads for t in th.tools.values() if t.rejected]
    sessions = {th.sid for th, _t in rej}
    if len(rej) < H17_MIN_REJECTIONS or len(sessions) < H17_MIN_SESSIONS:
        return None
    usd = A.turn_usd(len(rej))
    modes = collections.Counter()
    for th in A.mains:
        modes.update(th.perm_modes)
    ev = [A.ev(th, t.call, excerpt=A.tool_excerpt(t)) for th, t in rej[:CAPS["evidence"]]]
    metric = {"rejections": len(rej), "sessions": len(sessions), "modes": len(modes)}
    return A.finding("H17", "Tool calls rejected at the permission prompt", metric, usd, usd * A.month_factor,
                     "heuristic", "settings", "local", ev)


def h18_boilerplate(A):
    pref = [(th, t) for th in A.threads for t in th.tools.values() if t.cd_chars]
    if len(pref) <= H18_MIN_PREFIXES:
        return None
    usd = sum(A.tok(t.cd_chars) * A.pricer.rates(th.calls[t.call].model)["out"] / 1e6 +
              A.carry(th, t.call + 1, A.tok(t.cd_chars)) for th, t in pref)
    ev = [A.ev(th, t.call, excerpt=A.redact(t.arg[:t.cd_chars], SHORT_CHARS)) for th, t in pref[:2]]
    metric = {"cd_prefixes": len(pref), "prefix_tok": int(sum(A.tok(t.cd_chars) for _th, t in pref))}
    return A.finding("H18", "Redundant 'cd <repo> &&' prefixes on shell commands", metric, usd,
                     usd * A.month_factor, A.conf("measured"), "claude_md", "repo", ev)


def h19_verbosity(A):
    finals = [(th, c, max(0, c.out) - c.think) for th in A.mains for c in th.calls if c.stop == "end_turn"]
    vis = [v for _t, _c, v in finals]
    p50 = median(vis, 0)
    if p50 <= H19_P50_TOKENS:
        return None
    usd = sum(max(0, v - H19_TARGET_TOKENS) * A.pricer.rates(c.model)["out"] for _t, c, v in finals) / 1e6 * 0.5
    ev = [A.ev(th, c.idx, excerpt="final answer %d visible output tokens" % v)
          for th, c, v in sorted(finals, key=lambda x: -x[2])[:2]]
    metric = {"final_answers": len(finals), "p50_tok": p50, "p90_tok": percentile(vis, 0.9)}
    return A.finding("H19", "Long final answers after tasks", metric, usd, usd * A.month_factor, "heuristic",
                     "claude_md", "repo", ev, A.coverage(["concise", "brief", "short", "summary", "lines"]))


HEURISTICS = (h00_retention, h01_long_context, h02_injections, h03_procedures, h04_skill_triggers,
              h05_corrections, h06_memory, h07_model_switch, h08_cache_expiry, h09_effort, h10_subagents,
              h11_errors, h12_exploration, h13_overhead, h14_acks, h15_images, h16_web_mcp, h17_permissions,
              h18_boilerplate, h19_verbosity)
ALWAYS_REPORTED = ("H00", "H04", "H06")          # structural findings without a $ floor


def run_heuristics(A):
    found = []
    for h in HEURISTICS:
        f = h(A)
        if f and (f["id"] in ALWAYS_REPORTED or (f["est_usd_month"] or 0) >= MIN_FINDING_USD_MONTH):
            found.append(f)
    found.sort(key=lambda f: (f["id"] != "H00", -(f["est_usd_month"] or 0), f["id"]))
    if len(found) > CAPS["findings"]:
        A.limit("findings capped at %d of %d" % (CAPS["findings"], len(found)))
    return found[:CAPS["findings"]]


# =============================================================================
# Digest assembly and shedding
# =============================================================================
def capped(A, seq, n, label):
    seq = list(seq)
    if len(seq) > n:
        A.limit("%s capped at %d of %d" % (label, n, len(seq)))
    return seq[:n]


def totals_section(A):
    comp, by_model, by_effort = [0.0] * 5, {}, {}
    think = out = 0
    for th in A.threads:
        for c in th.calls:
            comp = [x + y for x, y in zip(comp, c.comp)]
            m = by_model.setdefault(c.model, {"calls": 0, "usd": 0.0})
            m["calls"] += 1
            m["usd"] += c.usd
            e = by_effort.setdefault(c.effort or "unset", {"calls": 0, "usd": 0.0, "_think": 0, "_out": 0})
            e["calls"] += 1
            e["usd"] += c.usd
            e["_think"] += c.think
            e["_out"] += max(0, c.out)
            think += c.think
            out += max(0, c.out)
    usd = sum(comp)
    cs, best, cs_sessions = 0.0, 0.0, 0
    for th in A.mains:
        state = th.cost_state_usd()
        derived = th.usd + sum(s.usd for s in A.subs_by_sid[th.sid])
        if state is not None:
            cs, cs_sessions = cs + state, cs_sessions + 1
        # cost-state is per process: a resumed session only records the last process's spend
        # (0.0 after a bare /resume), so it is authoritative only when it is not below the transcripts.
        best += max(state, derived) if state is not None else derived
    best += sum(s.usd for s in A.subs if s.sid not in A.tx_sids)
    A.usd_best = best
    models = sorted(by_model.items(), key=lambda kv: -kv[1]["usd"])
    return {"api_calls": sum(len(t.calls) for t in A.threads), "usd": rnd(usd),
            "usd_cost_state": rnd(cs) if cs_sessions else None, "cost_state_sessions": cs_sessions,
            "usd_best": rnd(best), "usd_month_est": rnd(best * A.month_factor), "confidence": A.mf_confidence,
            "by_component": {"input": rnd(comp[0]), "cache_read": rnd(comp[1]), "write_5m": rnd(comp[2]),
                             "write_1h": rnd(comp[3]), "output": rnd(comp[4]), "thinking_tokens": think,
                             "output_tokens": out},
            "by_model": {m: {"calls": v["calls"], "usd": rnd(v["usd"]),
                             "price_guess": m in A.pricer.guessed or None}
                         for m, v in capped(A, models, CAPS["by_model"], "totals.by_model")},
            "by_effort": {e: {"calls": v["calls"], "usd": rnd(v["usd"]),
                              "thinking_share": rnd(v["_think"] / float(v["_out"])) if v["_out"] else None}
                          for e, v in sorted(by_effort.items(), key=lambda kv: -kv[1]["usd"])},
            "main_vs_sub": {"main_usd": rnd(sum(t.usd for t in A.mains)), "sub_usd": rnd(sum(t.usd for t in A.subs))},
            "medians": {"ctx": A.ctx_med, "first_ctx_main": median([t.first_ctx for t in A.mains]),
                        "first_ctx_sub": median([t.first_ctx for t in A.subs]), "calls_per_prompt": A.calls_per_prompt}}


def sessions_section(A):
    rows = []
    for th in A.mains:
        subs = A.subs_by_sid[th.sid]
        usd = th.usd + sum(s.usd for s in subs)
        read = sum(c.comp[1] for t in [th] + subs for c in t.calls)
        rows.append({"sid": th.sid[:8], "clone": A.name(th.clone), "date": iso_day(th.first_ts),
                     "calls": len(th.calls) + sum(len(s.calls) for s in subs), "subagents": len(subs),
                     "prompts": sum(1 for p in th.prompts if p.human), "usd": rnd(usd),
                     "usd_cost_state": rnd(th.cost_state_usd()), "first_ctx": th.first_ctx, "max_ctx": th.max_ctx,
                     "read_share": rnd(read / usd) if usd else None,
                     "flags": sorted(A.session_flags.get(th.sid[:8], ()))})
    rows.sort(key=lambda r: -(r["usd"] or 0))
    return capped(A, rows, CAPS["sessions_top"], "sessions_top")


def clusters_section(A):
    out = []
    for c in A.H.clusters:
        if c["n"] < CLUSTER_DIGEST_MIN_N:
            continue
        d = {k: v for k, v in c.items() if not k.startswith("_")}
        d["medoid"] = A.redact(c["medoid"])
        d["variants"] = [A.redact(v, SHORT_CHARS) for v in c["variants"]]
        out.append(d)
    return capped(A, out, CAPS["prompt_clusters"], "prompt_clusters")


def tools_section(A):
    per = {}
    for th, t, tok, carry in A.tool_rows:
        d = per.setdefault(t.name, {"calls": 0, "toks": [], "errors": 0, "timeouts": 0, "heads": {}})
        d["calls"] += 1
        d["toks"].append(tok)
        d["errors"] += int(t.error)
        d["timeouts"] += int(t.error and error_class(t.err) == "timeout")
        h = d["heads"].setdefault(t.head, [0, 0.0, 0.0])
        h[0], h[1], h[2] = h[0] + 1, h[1] + tok, h[2] + carry
    out = {}
    for name, d in capped(A, sorted(per.items(), key=lambda kv: -sum(kv[1]["toks"])), CAPS["tools"], "tools"):
        heads = sorted(d["heads"].items(), key=lambda kv: -kv[1][2])
        out[name] = {"calls": d["calls"], "result_tok": int(sum(d["toks"])), "p95_tok": int(percentile(d["toks"], 0.95)),
                     "errors": d["errors"], "timeouts": d["timeouts"],
                     "heavy_heads": [{"head": A.redact(h, 60), "n": v[0], "avg_tok": int(v[1] / v[0]),
                                      "carry_usd": rnd(v[2])} for h, v in heads[:CAPS["heads"]]]}
    return out


def cache_section(A):
    causes = collections.Counter(e["cause"] for e in A.misses)
    events = sorted(A.misses, key=lambda e: -e["usd"])
    return {"miss_by_cause": {c: causes.get(c, 0) for c in MISS_AVOIDABLE},
            "rewrite_usd_by_cause": {c: rnd(sum(e["usd"] for e in A.misses if e["cause"] == c)) for c in causes},
            "hist_mid_session_model": len(A.H.mid_model), "hist_mid_session_effort": len(A.H.mid_effort),
            "events": [{"sid": e["th"].sid[:8], "call": e["call"], "gap_s": e["gap_s"], "prev_ctx": e["prev_ctx"],
                        "cw": e["cw"], "cause": e["cause"], "usd": rnd(e["usd"])}
                       for e in capped(A, events, CAPS["cache_events"], "cache.events")]}


def error_loops_section(A):
    rows = sorted(A.err_agg.values(), key=lambda a: (-a["loop"], -len(a["sessions"]), -a["n"]))
    rows = [a for a in rows if a["loop"] or a["n"] >= 2]
    return [{"cmd": A.redact(a["cmd"]), "err": A.redact(a["err"].most_common(1)[0][0], SHORT_CHARS),
             "cls": error_class(a["err"].most_common(1)[0][0]), "n": a["n"], "sessions": len(a["sessions"]),
             "clones": len(a["clones"]), "loop": a["loop"]} for a in capped(A, rows, CAPS["error_loops"], "error_loops")]


def subagents_section(A):
    rows = sorted(A.sub_rows, key=lambda r: -r["usd"])
    return [{"sid": r["th"].sid[:8], "agent": (r["th"].agent_id or "")[:12], "type": r["type"], "model": r["model"],
             "calls": r["calls"], "first_ctx": r["first_ctx"], "absorbed": r["absorbed"], "returned": r["returned"],
             "yield": r["yield"], "usd": rnd(r["usd"]), "desc": A.redact(r["th"].desc or "", SHORT_CHARS)}
            for r in capped(A, rows, CAPS["subagents"], "subagents")]


def pastes_section(A):
    lines = [x[0] for r in A.H.rows for x in r["pastes"] if x[0]]
    shapes = collections.Counter(p.shape["kind"] for th in A.threads for p in th.prompts if p.human and p.shape)
    n_shapes = float(sum(shapes.values())) or 1.0
    return {"n": sum(len(r["pastes"]) for r in A.H.rows), "lines_p50": median(lines), "lines_p90": percentile(lines, 0.9),
            "max_lines": max(lines) if lines else None,
            "big_n": sum(1 for x in lines if x >= PASTE_BIG_LINES),
            "hash_only": sum(1 for r in A.H.rows for x in r["pastes"] if x[1] is None),
            "shape_top": {k: rnd(v / n_shapes) for k, v in shapes.most_common(4)}}


def paths_section(A):
    strip = lambda d: {k: v for k, v in d.items() if not k.startswith("_")}  # noqa: E731
    return {"session_start_hot": [strip(h) for h in capped(A, A.paths["session_start_hot"], CAPS["hot_paths"],
                                                             "paths.session_start_hot")],
            "rereads": [strip(r) for r in capped(A, A.paths["rereads"], CAPS["rereads"], "paths.rereads")]}


def repo_config_section(A):
    inv = A.inv
    files = sorted(inv["instruction_files"], key=lambda f: -f["chars"])
    secs = sorted(((f["path"], h, c) for f in files for h, c in f["sections"]), key=lambda x: -x[2])
    hooks = sorted({h for s in inv["settings"].values() for h in s["hooks"]})
    return {"claude_md_tok": int(A.tok(sum(f["chars"] for f in files if f["always"]))),
            "instruction_files": [{"path": f["path"], "tok": int(A.tok(f["chars"])), "lines": f["lines"],
                                   "always_loaded": f["always"]} for f in capped(A, files, CAPS["sections"], "instruction_files")],
            "claude_md_sections": [{"file": p, "h": A.redact(h, 80), "tok": int(A.tok(c))}
                                   for p, h, c in capped(A, secs, CAPS["sections"], "claude_md_sections")],
            "skills": [{"name": s["name"], "desc": A.redact(s["desc"]), "tok": int(A.tok(s["chars"]))}
                       for s in capped(A, inv["skills"], CAPS["names"], "repo skills")],
            "commands": inv["commands"][:CAPS["names"]],
            "agents": [{"name": a["name"], "desc": A.redact(a["desc"], SHORT_CHARS), "model": a["model"]}
                       for a in inv["agents"][:CAPS["names"]]],
            "hooks": hooks, "settings": inv["settings"], "mcp_servers": inv["mcp_servers"]}


def user_config_section(A):
    return [{"dir": A.redact(u["dir"], SHORT_CHARS), "settings": u["settings"],
             "claude_md_tok": int(A.tok(u["claude_md_chars"])), "skills": u["skills"][:CAPS["names"]],
             "agents": u["agents"][:CAPS["names"]]} for u in A.user_cfg]


def repo_section(A):
    rows = []
    for cl in A.clones:
        rel = cl["relation"]
        ev = " ".join(cl["evidence"])
        by = rel if rel != "path-gone" else ("githubRepoPaths" if "githubRepoPaths" in ev else
                                             "history" if "mention" in ev else "name")
        mains, subs = A.tx_counts.get(cl["root"], [0, 0])
        hist = [r for r in A.H.rows if r["c"] == cl["root"]]
        rows.append({"name": A.name(cl["root"]), "path": _tilde(cl["root"], A.home), "exists": cl["exists"], "relation": rel, "confidence": cl["confidence"], "inferred_by": by,
                     "tx_sessions": mains, "tx_subagents": subs, "hist_sessions": len({r["s"] for r in hist}),
                     "hist_prompts": len(hist)})
    remote = next((r for r in A.res["self"]["remotes"] if "/" in r), None)
    return {"name": os.path.basename(A.repo_root), "remote": A.redact(remote, SHORT_CHARS) if remote else None,
            "root_commit": (A.res["self"]["root_commits"] or [None])[0] and A.res["self"]["root_commits"][0][:12],
            "clones": rows, "related": len(A.res["related"]), "excluded": len(A.res["excluded"])}


def _tilde(path, home):
    return "~" + path[len(home):] if _within(path, home) and home != os.sep else path


def coverage_section(A):
    unknown = sorted(set().union(*[t.unknown for t in A.threads])) if A.threads else []
    return {"window": [iso_day(A.win_start), iso_day(A.win_end)], "window_days": rnd(A.window_days, 2),
            "tx_sessions": len(A.tx_sids), "subagent_files": len(A.subs),
            "hist_sessions": len({r["s"] for r in A.H.rows}), "hist_prompts": len(A.H.human),
            "hist_period": [iso_day(A.H.start), iso_day(A.H.end)], "hist_period_days": rnd(A.H.days, 1),
            "tx_coverage": rnd(A.tx_coverage, 3), "window_coverage": rnd(A.window_coverage, 3),
            "cleanup_period_days": A.cleanup_days, "sessions_per_month": rnd(A.sessions_per_month, 1),
            "month_factor": rnd(A.month_factor, 2), "MF": rnd(A.MF, 2), "SF": rnd(A.SF, 2),
            "excluded_sessions": sorted(A.excluded_seen | {e[:8] for e in A.excluded}),
            "tx_mb": rnd(A.stats["tx_bytes"] / 1e6, 1),
            "bad_lines": sum(t.stats["bad"] for t in A.threads), "partial_lines": sum(t.stats["partial"] for t in A.threads),
            "live_files": A.stats["live_files"],
            "unknown": {"types": [u[5:] for u in unknown if u.startswith("type:")][:CAPS["unknown"]],
                        "subtypes": [u[7:] for u in unknown if u.startswith("system:")][:CAPS["unknown"]]}}


def collect_limits(A):
    """Everything that could not be measured, and every silent default."""
    think = sum(c.think for t in A.threads for c in t.calls)
    fast = sum(1 for t in A.threads for c in t.calls if c.speed == "fast")
    cs = sum(1 for t in A.mains if t.cost_states)
    A.limit("thinking text is not stored; thinking cost comes from output_tokens_details.thinking_tokens"
            + ("" if think else " (0 recorded in these transcripts: H09 thinking share unmeasurable)"))
    A.limit("fast mode: %d calls priced at %gx (Opus 5/5.5 fast mode is 2x standard per pricing docs)" % (fast, FAST_MODE_MULTIPLIER)
            if fast else "no fast-mode calls observed (usage.speed); none priced at the fast-mode premium")
    A.limit("cost-state totals present for %d of %d sessions; transcript-derived $ is a lower bound "
            "(title/summary side calls are only in cost-state; cost-state assumed to include subagents; it is per "
            "process, so per session the larger of cost-state and transcript $ is used)" % (cs, len(A.mains)))
    A.limit("tokens for text estimated at %.2f chars/token (%s)" % (
        A.cpt, "calibrated from %d single-tool steps" % A.cpt_samples if A.cpt_samples >= CPT_MIN_SAMPLES
        else "default; only %d calibration samples" % A.cpt_samples))
    A.limit("history.jsonl records interactive prompts only (claude -p / SDK sessions are missing)")
    A.limit("images estimated at %d tokens each; history-only estimates assume 1h cache writes on %s" % (
        IMAGE_TOKENS, A.model))
    if A.H.full_span:
        A.limit("little recent history: per-month rates use the full history span")
    if A.opts.since_days:
        A.limit("--since-days filters transcripts by file mtime (session granularity) and history by timestamp")
    if not os.environ.get("CLAUDE_CODE_SESSION_ID"):
        A.limit("CLAUDE_CODE_SESSION_ID not set: the audit's own session may be included")
    if A.stats["live_files"]:
        A.limit("%d live transcript file(s) (modified <%ds ago) included up to their last complete line" % (
            A.stats["live_files"], LIVE_WINDOW_S))
    guessed = sorted(A.pricer.guessed)
    if guessed:
        A.limit("price_guess: unknown model ids priced by nearest/fallback row: " + ", ".join(guessed)[:200])
    orphans = sum(t.stats["orphan_results"] for t in A.threads)
    unpaired = sum(1 for t in A.threads for x in t.tools.values() if not x.results)
    if orphans or unpaired:
        A.limit("%d tool results without a tool_use and %d tool_use without result (in-flight/interrupted)" % (
            orphans, unpaired))
    if A.inv["walk_truncated"]:
        A.limit("repo walk for CLAUDE.md files stopped after %d directories" % WALK_MAX_DIRS)
    for w in A.res["warnings"][:5]:
        A.limit("git: " + A.redact(w, SHORT_CHARS))
    if A.opts.no_unverified:
        A.limit("--no-unverified: clones below 'recorded' confidence were dropped")
    A.limit("stats-cache.json not used (global, not attributable to clones)")


def build_digest(A, findings):
    d = collections.OrderedDict()
    d["schema"] = SCHEMA
    d["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(A.now))
    d["tool_version"] = VERSION
    d["since_days"] = A.opts.since_days
    d["params"] = {"C_long": C_LONG, "T_big_tool": T_BIG_TOOL, "T_big_paste": T_BIG_PASTE, "jaccard": CLUSTER_JACCARD,
                   "chars_per_token": rnd(A.cpt), "k_tok": rnd(4.0 / A.cpt), "cpt_samples": A.cpt_samples,
                   "price_table": PRICE_TABLE_ID, "prices_override": bool(A.opts.prices), "ctx_med": A.ctx_med,
                   "dominant_model": A.model, "month_factor_confidence": A.mf_confidence}
    d["repo"] = repo_section(A)
    d["coverage"] = coverage_section(A)
    d["totals"] = totals_section(A)
    d["findings"] = findings
    d["sessions_top"] = sessions_section(A)
    d["overhead"] = A.overhead
    d["prompt_clusters"] = clusters_section(A)
    d["prompt_chains"] = capped(A, A.H.chains, CAPS["prompt_chains"], "prompt_chains")
    corr = [r for r in A.H.human if r["corr"]]
    d["corrections"] = {"n": len(corr), "rate": rnd(len(corr) / float(len(A.H.human)), 3) if A.H.human else None,
                        "reactive_share": rnd(sum(1 for r in corr if not r.get("first")) / float(len(corr)), 2) if corr else None,
                        "cluster_ids": [c["cid"] for c in A.H.clusters if c["kind"] in ("correction", "preference")
                                        and c["n"] >= CLUSTER_DIGEST_MIN_N][:CAPS["names"]],
                        "after_interrupt": sum(1 for t in A.mains for p in t.prompts if p.human and p.after_interrupt)}
    acks = [r for r in A.H.human if r["k"] == "ack"]
    d["acks"] = {"n": len(acks), "rate": rnd(len(acks) / float(len(A.H.human)), 3) if A.H.human else None,
                 "top": dict(collections.Counter(r["d"].strip().lower() for r in acks).most_common(5))}
    d["slash"] = dict(capped(A, A.H.slash.most_common(), CAPS["slash"], "slash"))
    d["cache"] = cache_section(A)
    d["tools"] = tools_section(A)
    d["error_loops"] = error_loops_section(A)
    d["paths"] = paths_section(A)
    d["subagents"] = subagents_section(A)
    d["pastes"] = pastes_section(A)
    d["memory"] = {"per_clone": A.memory["per_clone"], "promotable": capped(A, A.memory["promotable"],
                                                                           CAPS["promotable"], "memory.promotable")}
    d["repo_config"] = repo_config_section(A)
    d["user_config"] = user_config_section(A)
    collect_limits(A)
    d["limits"] = []
    return d


def _cut(path, n):
    """Shed step: truncate the list at `path` to n items."""
    def step(d):
        parent = d
        for key in path[:-1]:
            parent = parent.get(key) or {}
        lst = parent.get(path[-1])
        if isinstance(lst, list) and len(lst) > n:
            parent[path[-1]] = lst[:n]
            return True
        return False
    return step


def _evidence_to(n):
    def step(d):
        changed = False
        for f in d.get("findings") or []:
            if len(f.get("evidence") or []) > n:
                f["evidence"], changed = f["evidence"][:n], True
        return changed
    return step


def _drop_variants(d):
    changed = False
    for c in d.get("prompt_clusters") or []:
        if c.pop("variants", None):
            changed = True
    return changed


def _tool_heads_to(n):
    def step(d):
        changed = False
        for v in (d.get("tools") or {}).values():
            if len(v.get("heavy_heads") or []) > n:
                v["heavy_heads"], changed = v["heavy_heads"][:n], True
        return changed
    return step


def _both(*steps):
    return lambda d: any([s(d) for s in steps])


# Documented shed order (research order first, then further steps until the digest fits).
SHED_STEPS = (
    ("findings: drop evidence[2]", _evidence_to(2)),
    ("prompt_clusters: drop variants", _drop_variants),
    ("prompt_clusters: cut to 20", _cut(("prompt_clusters",), 20)),
    ("paths: cut lists to 10", _both(_cut(("paths", "session_start_hot"), 10), _cut(("paths", "rereads"), 10))),
    ("sessions_top: cut to 8", _cut(("sessions_top",), 8)),
    ("findings: cut to top 15", _cut(("findings",), 15)),
    ("cache.events: cut to 5", _cut(("cache", "events"), 5)),
    ("prompt_clusters: cut to 10", _cut(("prompt_clusters",), 10)),
    ("error_loops/subagents: cut to 5, tools heavy_heads to 3",
     _both(_cut(("error_loops",), 5), _cut(("subagents",), 5), _tool_heads_to(3))),
    ("repo_config lists: cut to 5", _both(_cut(("repo_config", "claude_md_sections"), 5),
                                          _cut(("repo_config", "instruction_files"), 5),
                                          _cut(("repo_config", "skills"), 5))),
    ("findings: keep 1 evidence item", _evidence_to(1)),
    ("findings: cut to top 10", _cut(("findings",), 10)),
    ("prompt_clusters: cut to 5, prompt_chains: cut to 3",
     _both(_cut(("prompt_clusters",), 5), _cut(("prompt_chains",), 3))),
    ("sessions_top: cut to 3, memory.promotable: cut to 5",
     _both(_cut(("sessions_top",), 3), _cut(("memory", "promotable"), 5))),
)


def dump_digest(d):
    """Compact JSON with one top-level key per line."""
    parts = ["%s:%s" % (json.dumps(k), json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=str))
             for k, v in d.items()]
    return "{\n" + ",\n".join(parts) + "\n}\n"


def fit_digest(d, limits, max_chars):
    """Apply SHED_STEPS in order until the digest fits; record every applied step."""
    applied = []

    def render():
        lim = list(limits) + ["digest shed: " + s for s in applied]
        if len(lim) > MAX_LIMITS_LINES:
            lim = lim[:MAX_LIMITS_LINES - 1] + ["... %d more limits" % (len(lim) - MAX_LIMITS_LINES + 1)]
        d["limits"] = lim
        return dump_digest(d)

    text = render()
    for label, step in SHED_STEPS:
        if len(text) <= max_chars:
            break
        if step(d):
            applied.append(label)
            text = render()
    if len(text) > max_chars:
        limits = list(limits) + ["digest still %d chars after all shed steps (max %d)" % (len(text), max_chars)]
        text = render()
    return text, applied


# =============================================================================
# Output: stdout summary, files, --explain
# =============================================================================
def clone_lines(A, max_rows=8):
    lines = ["clones (%d):  name | path | relation/confidence | transcripts main+sub | history prompts" % len(A.clones)]
    for cl in A.clones[:max_rows]:
        if hasattr(A, "tx_counts"):
            mains, subs = A.tx_counts.get(cl["root"], [0, 0])
        else:
            live = [t for t in cl["transcripts"] if not t["current"]]
            mains, subs = sum(t["kind"] == "main" for t in live), sum(t["kind"] == "subagent" for t in live)
        hist = cl["history"]["prompts"] if not hasattr(A, "H") else sum(1 for r in A.H.rows if r["c"] == cl["root"])
        lines.append("  %-22s %-38s %-21s %4d+%-4d %6d%s" % (
            A.name(cl["root"])[:22], _tilde(cl["root"], A.home)[:38], "%s/%s" % (cl["relation"], cl["confidence"]),
            mains, subs, hist, "" if cl["exists"] else "  (gone)"))
    if len(A.clones) > max_rows:
        lines.append("  ... %d more clones in clones.json" % (len(A.clones) - max_rows))
    return lines


def summary_lines(A, digest, digest_path):
    t, c = digest["totals"], digest["coverage"]
    remote = digest["repo"]["remote"] or "no remote"
    lines = ["token-usage-audit %s | repo %s (%s)" % (VERSION, digest["repo"]["name"], remote)]
    lines += clone_lines(A)
    lines.append("coverage: %d transcript sessions (+%d subagent files, %.1f MB) of %d history sessions (%.0f%%); "
                 "window %s..%s; cleanupPeriodDays %s" % (
                     c["tx_sessions"], c["subagent_files"], c["tx_mb"] or 0, c["hist_sessions"],
                     100 * (c["tx_coverage"] or 0), c["window"][0], c["window"][1],
                     c["cleanup_period_days"] if c["cleanup_period_days"] is not None else "unset (default 30)"))
    lines.append("totals: $%.2f in window over %d API calls (transcripts $%.2f, cost-state %s); est $%.2f/month [%s]" % (
        t["usd_best"] or 0, t["api_calls"], t["usd"] or 0,
        "$%.2f" % t["usd_cost_state"] if t["usd_cost_state"] is not None else "n/a",
        t["usd_month_est"] or 0, t["confidence"]))
    lines.append("top findings (est $/month):")
    for f in digest["findings"][:10]:
        lines.append("  %-4s %-66s %8s  %s" % (f["id"], f["title"][:66], "$%.2f" % (f["est_usd_month"] or 0),
                                               f["confidence"]))
    if not digest["findings"]:
        lines.append("  (none above thresholds)")
    lines.append("digest: %s" % digest_path)
    return lines[:40]


def default_out_root(repo_root):
    return os.path.join(repo_root, ".claude", "token-usage-audit")


def prepare_out_dir(opts, repo_root):
    """--out as given, else a timestamped dir under <repo>/.claude/token-usage-audit/
    whose .gitignore ("*") keeps every output out of git."""
    if opts.out:
        out = _norm(opts.out)
        os.makedirs(out, exist_ok=True)
        return out
    root = default_out_root(repo_root)
    os.makedirs(root, exist_ok=True)
    gi = os.path.join(root, ".gitignore")
    if not os.path.isfile(gi):
        with open(gi, "w") as fh:
            fh.write("*\n")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out, n = os.path.join(root, stamp), 1
    while os.path.exists(out):
        n += 1
        out = os.path.join(root, "%s-%d" % (stamp, n))
    os.makedirs(out)
    return out


def write_text(path, text):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def clones_json(res):
    return json.dumps(res, indent=1, default=sorted, ensure_ascii=False)


def run_audit(opts):
    """Collect, analyze and assemble. Returns (Audit, digest dict, findings)."""
    A = Audit(opts)
    A.collect()
    A.parse()
    A.derive()
    A.analyze()
    findings = run_heuristics(A)
    digest = build_digest(A, findings)
    return A, digest


def cmd_audit(opts):
    A, digest = run_audit(opts)
    out = prepare_out_dir(opts, A.repo_root)
    dpath = os.path.join(out, "digest.json")
    text, _applied = fit_digest(digest, A.limits, opts.max_digest_chars)
    write_text(dpath, text)
    write_text(os.path.join(out, "clones.json"), clones_json(A.res))
    lines = summary_lines(A, digest, dpath)
    write_text(os.path.join(out, "summary.txt"), "\n".join(lines) + "\n")
    print("\n".join(lines))
    for w in A.res["warnings"]:
        sys.stderr.write("warning: %s\n" % w)
    return 0


def cmd_clones_only(opts):
    A = Audit(opts)
    A.collect()
    lines = clone_lines(A, max_rows=CAPS["clones"])
    for r in A.res["related"]:
        lines.append("  related (not included): %s %s" % (_tilde(r["root"], A.home), ", ".join(r["remotes"])))
    for e in A.res["excluded"]:
        lines.append("  excluded: %s - %s" % (_tilde(e["path"], A.home), e["reason"]))
    out = prepare_out_dir(opts, A.repo_root)
    write_text(os.path.join(out, "clones.json"), clones_json(A.res))
    lines.append("clones.json: %s" % os.path.join(out, "clones.json"))
    print("\n".join(lines[:40]))
    for w in A.res["warnings"]:
        sys.stderr.write("warning: %s\n" % w)
    return 0


def latest_digest_dir(opts, repo_root):
    base = _norm(opts.out) if opts.out else default_out_root(repo_root)
    if os.path.isfile(os.path.join(base, "digest.json")):
        return base
    dirs = sorted(os.path.dirname(p) for p in glob.glob(os.path.join(base, "*", "digest.json")))
    return dirs[-1] if dirs else None


def _explain_thread(A, clones_res, sid, agent):
    for cl in clones_res["clones"]:
        for tx in cl["transcripts"]:
            if tx["session_id"].startswith(sid) and (tx["kind"] == "main") == (not agent) and \
                    (not agent or agent in os.path.basename(tx["path"])):
                scope = cl["root"] if tx["partial"] else None
                for th in parse_transcript(tx, cl["root"], scope, [c["root"] for c in clones_res["clones"]]):
                    return th
    return None


def explain_evidence(A, clones_res, e):
    """Surrounding human prompt, tool commands/paths and first error lines (never tool output)."""
    th = _explain_thread(A, clones_res, e["sid"], e.get("agent")) if e.get("sid") else None
    if th is None or e.get("call") is None:
        return []
    k = e["call"]
    th.finish(A.pricer)
    prompt = next((p for p in reversed(th.prompts) if p.gap < k and p.human), None)
    out = []
    if prompt is not None:
        out.append("  prompt: " + (A.redact(prompt.head, 300) if prompt.chars <= PROMPT_RAW_EXCERPT_MAX else
                                   "[long prompt: %d chars, %d lines]" % (prompt.chars, prompt.lines)))
    for c in th.calls[max(0, k - 2):k + 3]:
        for tid in c.tool_ids:
            t = th.tools.get(tid)
            if t is None:
                continue
            line = "  #%d %s" % (c.idx, A.tool_excerpt(t, 160))
            if t.error:
                line += " -> error: " + A.redact(t.err, SHORT_CHARS)
            out.append(line)
    return out


def explain_cluster(A, clones_res, c):
    owner = {_k(p): cl["root"] for cl in clones_res["clones"] for p in cl["paths"]}
    names = unique_names([cl["root"] for cl in clones_res["clones"]])
    target = shingles(norm_tokens(c.get("medoid") or ""))
    rows = []
    for r in load_history(claude_config_dirs(A.opts.config_dir), collections.Counter()):
        root = owner.get(_k(r["p"]))
        if not root:
            continue
        sh = shingles(norm_tokens(r["d"]))
        if jaccard(sh, target) >= CORRECTION_JACCARD or (target and len(sh & target) / float(len(target)) >= 0.6):
            rows.append((r["ts"] or 0, r, names.get(root, "?")))
    rows.sort(key=lambda x: -x[0])
    return ["  %s %s %s: %s" % (iso_day(ts), r["s"][:8], name, A.redact(r["d"], 160)) for ts, r, name in rows[:15]]


def cmd_explain(opts):
    top, _ = find_git_toplevel(opts.repo or os.getcwd())
    if not top:
        raise UsageError("%s is not inside a git repository" % (opts.repo or os.getcwd()))
    ddir = latest_digest_dir(opts, top)
    if not ddir:
        raise UsageError("no digest.json found; run the audit first")
    digest = load_json(os.path.join(ddir, "digest.json")) or {}
    clones_res = load_json(os.path.join(ddir, "clones.json")) or {"clones": []}
    A = Audit(opts)
    A.redact = Redactor(A.home, [c["root"] for c in clones_res["clones"]])
    A.pricer = Pricer(load_prices(opts.prices))
    want = opts.explain.strip().lower()
    finding = next((f for f in digest.get("findings") or [] if f["id"].lower() == want), None)
    cluster = next((c for c in digest.get("prompt_clusters") or [] if c.get("cid", "").lower() == want), None)
    if not finding and not cluster:
        raise UsageError("%s is not a finding id or cluster id in %s" % (opts.explain, ddir))
    lines = []
    if finding:
        lines.append("%s %s - est $%s/month (%s)" % (finding["id"], finding["title"], finding.get("est_usd_month"),
                                                    finding.get("confidence")))
        lines.append("metric: " + json.dumps(finding.get("metric"))[:300])
        for i, e in enumerate(finding.get("evidence") or [], 1):
            lines.append("[%d] %s %s %s call %s: %s" % (i, e.get("sid", "-"), e.get("clone", ""), e.get("ts", ""),
                                                       e.get("call", "-"), e.get("excerpt", "")))
            lines += explain_evidence(A, clones_res, e)
            cid = e.get("cid")
            c = next((x for x in digest.get("prompt_clusters") or [] if x.get("cid") == cid), None)
            if c:
                lines += explain_cluster(A, clones_res, c)[:5]
    else:
        lines.append("%s %s: n=%s sessions=%s clones=%s per_month=%s" % (
            cluster["cid"], cluster.get("kind"), cluster.get("n"), cluster.get("sessions"), cluster.get("clones"),
            cluster.get("per_month")))
        lines += explain_cluster(A, clones_res, cluster)
    text = "\n".join(lines)
    print(text if len(text) <= EXPLAIN_MAX_CHARS else text[:EXPLAIN_MAX_CHARS - 1] + "\u2026")
    return 0


# =============================================================================
# CLI
# =============================================================================
def build_parser():
    ap = argparse.ArgumentParser(
        prog="token_usage_audit.py",
        description="Audit Claude Code token usage across every local clone of this git repository and "
                    "write a compact, redacted digest (digest.json) with ranked findings.")
    ap.add_argument("--repo", metavar="DIR", help="clone to start from (default: git toplevel of the CWD)")
    ap.add_argument("--out", metavar="DIR", help="output dir (default: <repo>/.claude/token-usage-audit/<YYYYMMDD-HHMMSS>/)")
    ap.add_argument("--since-days", metavar="N", type=int, help="only use data newer than N days (default: all)")
    ap.add_argument("--exclude-session", metavar="ID", action="append", default=[],
                    help="exclude a session (repeatable); $CLAUDE_CODE_SESSION_ID is always excluded")
    ap.add_argument("--no-unverified", action="store_true", help='drop clones whose confidence is below "recorded"')
    ap.add_argument("--config-dir", metavar="DIR", action="append",
                    help="Claude config dir (repeatable; default: $CLAUDE_CONFIG_DIR and ~/.claude)")
    ap.add_argument("--prices", metavar="FILE", help="JSON override of the $/MTok price table")
    ap.add_argument("--max-digest-chars", metavar="N", type=int, default=MAX_DIGEST_CHARS,
                    help="digest size budget (default %d, ~15k tokens)" % MAX_DIGEST_CHARS)
    ap.add_argument("--clones-only", action="store_true", help="print the clone table, write clones.json and exit")
    ap.add_argument("--explain", metavar="ID", help="finding id (H02) or cluster id (c3) from the latest digest: "
                                                    "print <= 2000 chars of redacted context and exit")
    ap.add_argument("--version", action="version", version="%(prog)s " + VERSION)
    return ap


def main(argv=None):
    opts = build_parser().parse_args(argv)
    if opts.since_days is not None and opts.since_days <= 0:
        sys.stderr.write("error: --since-days must be positive\n")
        return 2
    if opts.max_digest_chars < 2000:
        sys.stderr.write("error: --max-digest-chars must be >= 2000\n")
        return 2
    try:
        if opts.explain:
            return cmd_explain(opts)
        if opts.clones_only:
            return cmd_clones_only(opts)
        return cmd_audit(opts)
    except UsageError as e:
        sys.stderr.write("error: %s\n" % e)
        return 2
    except KeyboardInterrupt:
        return 1
    except Exception as e:  # fatal: report without a traceback flood
        sys.stderr.write("fatal: %s: %s\n" % (type(e).__name__, e))
        if os.environ.get("TOKEN_AUDIT_DEBUG"):
            raise
        return 1


if __name__ == "__main__":
    sys.exit(main())
