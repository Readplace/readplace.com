import assert from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireEnv } from "@packages/require-env";
import { resolveTool, run } from "./tools.mjs";

const BROWSERS = {
  chrome: {
    process: "Google Chrome",
    binary: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: (profile, article) => [
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      article,
    ],
    sessionState: ["Default/Sessions", "Default/Session Storage"],
    boundsScript: 'tell application "Google Chrome" to get bounds of front window',
    pinnedIn: (profile) => {
      const preferences = join(profile, "Default", "Preferences");
      if (!existsSync(preferences)) return "";
      return JSON.parse(readFileSync(preferences, "utf8")).extensions?.pinned_extensions?.join(",") ?? "";
    },
  },
  firefox: {
    process: "firefox",
    binary: "/Applications/Firefox.app/Contents/MacOS/firefox",
    args: (profile, article) => ["-no-remote", "-profile", profile, article],
    sessionState: ["sessionstore-backups", "sessionstore.jsonlz4", "crashes", "minidumps"],
    pinnedIn: (profile) => {
      const prefs = join(profile, "prefs.js");
      if (!existsSync(prefs)) return "";
      const line = readFileSync(prefs, "utf8")
        .split("\n")
        .find((candidate) => candidate.includes("browser.uiCustomization.state"));
      if (!line) return "";
      const raw = line.match(/user_pref\("browser\.uiCustomization\.state", "(.*)"\);/)?.[1];
      if (!raw) return "";
      const state = JSON.parse(JSON.parse(`"${raw}"`));
      return (state.placements?.["nav-bar"] ?? []).join(",");
    },
  },
};

function screenTop(browser, fallbackY) {
  if (!browser.boundsScript) return fallbackY;
  const [, top] = run(resolveTool("osascript", "macOS ships it"), ["-e", browser.boundsScript])
    .trim()
    .split(", ")
    .map(Number);
  return top;
}

function windowServerSees(pid) {
  try {
    run(resolveTool("osascript", "macOS ships it"), [
      "-e",
      `tell application "System Events" to get name of (first process whose unix id is ${pid})`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function browserPid(browser, profile) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const line = run("/usr/bin/pgrep", ["-fl", profile])
        .trim()
        .split("\n")
        .find((candidate) => candidate.split(" ")[1] === browser.binary);
      const pid = line ? Number(line.split(" ")[0]) : undefined;
      if (pid && windowServerSees(pid)) return pid;
    } catch {
      // pgrep exits non-zero until the process appears
    }
    try {
      const byName = Number(
        run(resolveTool("osascript", "macOS ships it"), [
          "-e",
          `tell application "System Events" to get unix id of first process whose name is "${browser.process}"`,
        ]).trim(),
      );
      if (byName) return byName;
    } catch {
      // the GUI process has not registered yet
    }
    await sleep(500);
  }
  assert.fail(`no browser process came up for ${profile}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function placeWindow(pid, [x, y, width, height]) {
  const script = [
    `tell application "System Events" to tell (first process whose unix id is ${pid})`,
    "set best to missing value",
    "set bestArea to 0",
    "repeat with w in windows",
    'if subrole of w is "AXStandardWindow" then',
    "set {ww, hh} to size of w",
    "if ww * hh > bestArea then",
    "set bestArea to ww * hh",
    "set best to w",
    "end if",
    "end if",
    "end repeat",
    'if best is missing value then return "no standard window"',
    `set position of best to {${x}, ${y}}`,
    `set size of best to {${width}, ${height}}`,
    "return (get {position of best, size of best})",
    "end tell",
  ].flatMap((line) => ["-e", line]);
  let placed = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      placed = run(resolveTool("osascript", "macOS ships it"), script).trim();
      if (placed.split(", ").map(Number).join() === [x, y, width, height].join()) return;
    } catch (cause) {
      placed = String(cause.message).split("\n")[1] ?? "osascript failed";
    }
    await sleep(1000);
  }
  assert.fail(`the window settled at ${placed} instead of ${[x, y, width, height].join(",")}`);
}

function activateWindow(pid) {
  run(resolveTool("osascript", "macOS ships it"), [
    "-e",
    `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
  ]);
}

function screenshotWindow([x, y, width, height], offsetY, out) {
  run(resolveTool("screencapture", "macOS ships it"), [
    "-x",
    `-R${x},${y + offsetY},${width},${height}`,
    out,
  ]);
}

function glideAndClick([x, y], [windowX, windowY]) {
  const target = `${windowX + x},${windowY + y}`;
  run("cliclick", ["-e", "600", `m:${target}`]);
  run("cliclick", ["w:400", `c:${target}`]);
}

export async function desktopTake({ manifest, repoRoot, name, dryRun }) {
  const video = manifest.videos[name];
  assert(video?.desktop, `no desktop recipe for ${name}`);
  const recipe = video.desktop;
  const browser = BROWSERS[recipe.browser];
  assert(browser, `unknown browser ${recipe.browser}`);
  resolveTool("cliclick", "brew install cliclick");

  const profile = requireEnv(recipe.profileDirEnv);
  assert(existsSync(profile), `${recipe.profileDirEnv} points at ${profile}, which does not exist`);
  const pinned = browser.pinnedIn(profile);
  assert(
    !pinned.includes(recipe.pinnedMarker),
    `Readplace is already pinned in ${profile} — unpin it from the toolbar before recording`,
  );

  const workDir = join(repoRoot, "projects/hutch/test-results/media", name);
  mkdirSync(workDir, { recursive: true });
  const rawPath = join(workDir, "raw.mp4");
  for (const stale of browser.sessionState) rmSync(join(profile, stale), { recursive: true, force: true });
  let offsetY = 0;

  const awake = spawn(resolveTool("caffeinate", "macOS ships it"), ["-d", "-u"], { stdio: "ignore" });
  const child = spawn(browser.binary, browser.args(profile, recipe.article), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pid = await browserPid(browser, profile);
  await sleep(recipe.settleMs);
  await placeWindow(pid, recipe.window);
  activateWindow(pid);
  await sleep(1500);
  offsetY = screenTop(browser, recipe.window[1]) - recipe.window[1];

  const [windowX, windowY, windowWidth, windowHeight] = recipe.window;
  run("cliclick", [`m:${windowX + windowWidth + 120},${windowY + offsetY + windowHeight - 40}`]);

  const events = [];
  let recorder;
  let recorderStartedAtMs = 0;
  if (!dryRun) {
    recorder = spawn(resolveTool("ffmpeg", "brew install ffmpeg"), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "avfoundation",
      "-capture_cursor",
      "1",
      "-framerate",
      "30",
      "-pixel_format",
      "bgr0",
      "-i",
      `${manifest.screenDevice}:none`,
      "-vf",
      `crop=${windowWidth * 2}:${windowHeight * 2}:${windowX * 2}:${(windowY + offsetY) * 2}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "12",
      "-pix_fmt",
      "yuv444p",
      rawPath,
    ], { stdio: ["pipe", "ignore", "ignore"] });
    recorderStartedAtMs = Date.now();
    await sleep(1500);
  }

  for (const [index, step] of recipe.steps.entries()) {
    const isLast = index === recipe.steps.length - 1;
    if (dryRun) screenshotWindow(recipe.window, offsetY, join(workDir, `dry-run-${index}-${step.label}.png`));
    if (dryRun && isLast) break;
    if (step.key) {
      events.push({ wallMs: Date.now(), label: step.label, kind: "key" });
      run("cliclick", [`kp:${step.key}`]);
    } else {
      events.push({
        wallMs: Date.now(),
        label: step.label,
        kind: "click",
        x: step.at[0] * 2,
        y: step.at[1] * 2,
      });
      glideAndClick(step.at, [windowX, windowY + offsetY]);
    }
    const hold = video.cut.holds?.[step.label] ?? video.cut.holdMs;
    await sleep(hold);
    if (step.still && !dryRun) screenshotWindow(recipe.window, offsetY, join(workDir, `${step.still}.png`));
  }

  if (!dryRun) {
    await sleep(1000);
    recorder.stdin.write("q");
    await new Promise((resolve) => recorder.on("close", resolve));
  }
  process.kill(pid, "SIGTERM");
  awake.kill();
  await sleep(2000);

  if (dryRun) {
    console.log(`dry run: review ${workDir}/dry-run-*.png and correct the step coordinates`);
    return;
  }
  const takePath = join(workDir, "take.json");
  writeFileSync(takePath, `${JSON.stringify({ raw: rawPath, recorderStartedAtMs, syncOffsetMs: 0, events }, null, 2)}\n`);
  console.log(`recorded ${rawPath}`);
  console.log(`next: pnpm --filter hutch media encode ${name} --take ${takePath}`);
}
