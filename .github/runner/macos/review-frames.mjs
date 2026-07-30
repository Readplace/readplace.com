import { execFile } from "node:child_process";
import { appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const runCommand = promisify(execFile);

const GENERATE_TIMEOUT_MS = 3 * 60 * 1000;
const GENERATE_MAX_TOKENS = 800;
const VERIFY_MAX_TOKENS = 10;

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
}

function reviewPrompt(frameCount) {
  return [
    `You are a UI regression reviewer. These ${frameCount} frames were captured in order, about 150ms apart, while a web application responded to a user action.`,
    "Report structural defects only: text clipped mid-glyph, elements overlapping other elements or text, unreadable low-contrast text, template values leaking into the UI (undefined, null, NaN, {{...}}), overlays covering interactive controls, or collapsed layout.",
    "Normal in-progress rendering is NOT a defect: partially scrolled content, loading indicators, or an animation caught mid-flight.",
    "Judge each frame strictly on its own. Never compare frames to each other: differences between frames are the transition happening and are expected.",
    'Respond with ONLY a JSON array. Each item: {"frame": <zero-based index>, "defect": "...", "location": "..."}. Respond [] if nothing is broken.',
  ].join("\n");
}

function verifyPrompt(finding) {
  return `Look only at this single UI screenshot. A reviewer claims this defect: "${finding.defect}" at "${finding.location}". Is the claim clearly visible in this image? Answer with ONLY the word true or false.`;
}

function responseText(stdout) {
  const sections = stdout.split("==========");
  const middle = sections.length >= 3 ? sections[1] : stdout;
  const assistantMarker = middle.lastIndexOf("<|im_start|>assistant");
  return assistantMarker === -1 ? middle : middle.slice(assistantMarker);
}

function extractFindings(stdout) {
  const body = responseText(stdout);
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end <= start) {
    return { findings: [], parseFailed: true, raw: body.trim() };
  }
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return {
      findings: Array.isArray(parsed) ? parsed : [],
      parseFailed: false,
      raw: body.trim(),
    };
  } catch {
    return { findings: [], parseFailed: true, raw: body.trim() };
  }
}

async function listFlows(framesDir) {
  const entries = await readdir(framesDir, { withFileTypes: true });
  const flows = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const flowDir = path.join(framesDir, entry.name);
    const frames = (await readdir(flowDir))
      .filter((file) => file.endsWith(".png"))
      .sort()
      .map((file) => path.join(flowDir, file));
    if (frames.length > 0) {
      flows.push({ flow: entry.name, frames });
    }
  }
  return flows;
}

async function generate({ python, model, prompt, images, maxTokens }) {
  const { stdout } = await runCommand(
    python,
    [
      "-m",
      "mlx_vlm.generate",
      "--model",
      model,
      "--max-tokens",
      String(maxTokens),
      "--temperature",
      "0.0",
      "--prompt",
      prompt,
      "--image",
      ...images,
    ],
    {
      timeout: GENERATE_TIMEOUT_MS,
      env: { ...process.env, HF_HUB_OFFLINE: "1" },
    },
  );
  return stdout;
}

async function verifiedFindings({ python, model, flow, findings }) {
  const verified = [];
  for (const finding of findings) {
    const frameFile = flow.frames[Number(finding.frame)];
    if (frameFile === undefined) {
      continue;
    }
    const reply = await generate({
      python,
      model,
      prompt: verifyPrompt(finding),
      images: [frameFile],
      maxTokens: VERIFY_MAX_TOKENS,
    });
    if (/true/i.test(responseText(reply))) {
      verified.push(finding);
    }
  }
  return verified;
}

async function reviewFlow({ python, model, flow }) {
  const stdout = await generate({
    python,
    model,
    prompt: reviewPrompt(flow.frames.length),
    images: flow.frames,
    maxTokens: GENERATE_MAX_TOKENS,
  });
  const extracted = extractFindings(stdout);
  const findings = await verifiedFindings({ python, model, flow, findings: extracted.findings });
  return {
    flow: flow.flow,
    frameCount: flow.frames.length,
    findings,
    parseFailed: extracted.parseFailed,
    raw: extracted.raw,
  };
}

function cell(value) {
  return String(value ?? "?").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function fencedBlock(text) {
  const longestRun = text.match(/`+/g);
  const fence = "`".repeat(longestRun === null ? 3 : Math.max(3, Math.max(...longestRun.map((run) => run.length)) + 1));
  return [fence, text, fence];
}

function formatSummary(reviews) {
  const lines = ["## Visual review (advisory)", ""];
  for (const review of reviews) {
    lines.push(`### ${review.flow} (${review.frameCount} frames)`, "");
    if (review.parseFailed) {
      lines.push("The model reply was not parseable JSON; raw output:", "", ...fencedBlock(review.raw), "");
      continue;
    }
    if (review.findings.length === 0) {
      lines.push("No structural defects reported.", "");
      continue;
    }
    lines.push("| Frame | Defect | Location |", "|---|---|---|");
    for (const finding of review.findings) {
      lines.push(`| ${cell(finding.frame)} | ${cell(finding.defect)} | ${cell(finding.location)} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function publishSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    await appendFile(summaryFile, `${markdown}\n`);
  }
  console.log(markdown);
}

async function commentOnPullRequest(markdown) {
  const prNumber = process.env.PR_NUMBER;
  if (!prNumber) {
    return;
  }
  await runCommand("gh", ["pr", "comment", prNumber, "--body", markdown]);
}

async function main() {
  const framesDir = requireEnv("FRAMES_DIR");
  const model = requireEnv("VLM_MODEL");
  const python = requireEnv("VLM_PYTHON");
  const flows = await listFlows(framesDir);
  if (flows.length === 0) {
    await publishSummary("## Visual review (advisory)\n\nNo transition frames were captured for this run.");
    return;
  }
  const reviews = [];
  for (const flow of flows) {
    reviews.push(await reviewFlow({ python, model, flow }));
  }
  const markdown = formatSummary(reviews);
  await publishSummary(markdown);
  const findingsCount = reviews.reduce((total, review) => total + review.findings.length, 0);
  if (findingsCount > 0) {
    await commentOnPullRequest(markdown);
  }
}

main().catch((error) => {
  console.error("Visual review skipped:", error instanceof Error ? error.message : error);
});
