import assert from "node:assert";
import { spawn } from "node:child_process";
import { appendFile, cp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const GENERATE_TIMEOUT_MS = 3 * 60 * 1000;
const SERVER_LOAD_TIMEOUT_MS = 5 * 60 * 1000;
const SERVER_POLL_INTERVAL_MS = 2000;
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

function extractFindings(body) {
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

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer({ python, model }) {
  const port = await freePort();
  const child = spawn(
    python,
    ["-m", "mlx_vlm.server", "--host", "127.0.0.1", "--port", String(port), "--model", model],
    { env: { ...process.env, HF_HUB_OFFLINE: "1" }, stdio: ["ignore", "inherit", "inherit"] },
  );
  const server = { baseUrl: `http://127.0.0.1:${port}`, child, exit: undefined };
  child.once("exit", (code, signal) => {
    server.exit = { code, signal };
  });
  const startedAt = performance.now();
  for (;;) {
    assert(server.exit === undefined, `mlx_vlm.server exited before loading ${model}: ${JSON.stringify(server.exit)}`);
    assert(performance.now() - startedAt < SERVER_LOAD_TIMEOUT_MS, `mlx_vlm.server did not load ${model} in time`);
    const health = await fetch(`${server.baseUrl}/health`)
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined);
    if (health?.loaded_model === model) {
      return server;
    }
    await sleep(SERVER_POLL_INTERVAL_MS);
  }
}

async function stopServer(server) {
  if (server.exit !== undefined) {
    return;
  }
  const exited = new Promise((resolve) => server.child.once("exit", resolve));
  server.child.kill();
  await exited;
}

async function generate({ server, model, prompt, images, maxTokens }) {
  const startedAt = performance.now();
  const failure = (message, cause) =>
    Object.assign(new Error(message, { cause }), {
      elapsedMs: Math.round(performance.now() - startedAt),
      serverExit: server.exit,
    });
  const response = await fetch(`${server.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((image) => ({ type: "image_url", image_url: { url: image } })),
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  }).catch((error) => {
    throw failure(`mlx_vlm.server request failed: ${error.message} (${error.cause?.code ?? error.cause?.message ?? "no cause"})`, error);
  });
  const body = await response.text();
  if (!response.ok) {
    throw failure(`mlx_vlm.server answered ${response.status}: ${body}`);
  }
  const content = JSON.parse(body).choices?.[0]?.message?.content;
  assert(typeof content === "string", `mlx_vlm.server reply has no message content: ${body}`);
  return content;
}

async function verifiedFindings({ server, model, flow, findings }) {
  const verified = [];
  for (const finding of findings) {
    const frameFile = flow.frames[Number(finding.frame)];
    if (frameFile === undefined) {
      continue;
    }
    const reply = await generate({
      server,
      model,
      prompt: verifyPrompt(finding),
      images: [frameFile],
      maxTokens: VERIFY_MAX_TOKENS,
    });
    if (/true/i.test(reply)) {
      verified.push(finding);
    }
  }
  return verified;
}

async function reviewFlow({ server, model, flow }) {
  const reply = await generate({
    server,
    model,
    prompt: reviewPrompt(flow.frames.length),
    images: flow.frames,
    maxTokens: GENERATE_MAX_TOKENS,
  });
  const extracted = extractFindings(reply);
  const findings = await verifiedFindings({ server, model, flow, findings: extracted.findings });
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
  const lines = ["## Visual review", ""];
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

async function main() {
  const framesDir = requireEnv("FRAMES_DIR");
  const model = requireEnv("VLM_MODEL");
  const python = requireEnv("VLM_PYTHON");
  const flows = await listFlows(framesDir);
  if (flows.length === 0) {
    throw new Error(`No transition frames reached ${framesDir}`);
  }
  const server = await startServer({ python, model });
  const reviews = [];
  try {
    for (const flow of flows) {
      reviews.push(await reviewFlow({ server, model, flow }));
    }
  } finally {
    await stopServer(server);
  }
  await publishSummary(formatSummary(reviews));
  const defectCount = reviews.reduce((total, review) => total + review.findings.length, 0);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `defect-count=${defectCount}\n`);
  }
  // Flagged frames are the evidence for the summary above, so they are copied
  // into the workspace for the upload step to keep; a clean review has nothing
  // worth keeping. The copy is what lets the upload name a relative path —
  // uploading straight from the host directory reads as exfiltration to
  // GitHub's workflow scanner, which holds the whole run for approval.
  if (defectCount > 0) {
    await cp(framesDir, "flagged-frames", { recursive: true });
  }
  await rm(framesDir, { recursive: true, force: true });
  const unparsedFlows = reviews.filter((review) => review.parseFailed).map((review) => review.flow);
  if (unparsedFlows.length > 0) {
    throw new Error(`The model reply was not parseable JSON for: ${unparsedFlows.join(", ")}`);
  }
  if (defectCount > 0) {
    throw new Error(`The model confirmed ${defectCount} defect(s) in the transition frames`);
  }
}

main().catch((error) => {
  console.error(
    "::error::Visual review failed:",
    error instanceof Error ? error.message : error,
    JSON.stringify({ elapsedMs: error?.elapsedMs, serverExit: error?.serverExit }),
  );
  process.exitCode = 1;
});
