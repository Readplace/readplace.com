import assert from "node:assert";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { chromium } from "@playwright/test";
import { waitForBrandFonts, waitForImagePixels } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { cwebp, dataUri, ffmpeg, probeImage } from "./tools.mjs";

const COMPASS = {
  n: [0, -1],
  ne: [0.7071, -0.7071],
  e: [1, 0],
  se: [0.7071, 0.7071],
  s: [0, 1],
  sw: [-0.7071, 0.7071],
  w: [-1, 0],
  nw: [-0.7071, -0.7071],
};

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const CALLOUT_COLOUR = "#FF3B30";
const ARROW_GAP = 14;
const ARROW_LENGTH = 150;

function ellipsePoint({ rx, ry, dx, dy }) {
  const t = 1 / Math.hypot(dx / rx, dy / ry);
  return [dx * t, dy * t];
}

function calloutSvg({ width, height, box, pad, stroke, arrowFrom }) {
  const direction = COMPASS[arrowFrom];
  assert(direction, `unknown arrowFrom "${arrowFrom}"`);
  const [dx, dy] = direction;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = box.width / 2 + pad[0];
  const ry = box.height / 2 + pad[1];
  const [ex, ey] = ellipsePoint({ rx, ry, dx, dy });
  const headX = cx + ex + dx * ARROW_GAP;
  const headY = cy + ey + dy * ARROW_GAP;
  const tailX = headX + dx * ARROW_LENGTH;
  const tailY = headY + dy * ARROW_LENGTH;
  const side = stroke * 3;
  const baseX = headX + dx * side;
  const baseY = headY + dy * side;
  const points = [
    [headX, headY],
    [baseX - dy * (side / 2), baseY + dx * (side / 2)],
    [baseX + dy * (side / 2), baseY - dx * (side / 2)],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="position:absolute;inset:0">`,
    `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="none" stroke="${CALLOUT_COLOUR}" stroke-width="${stroke}"/>`,
    `<line x1="${tailX.toFixed(1)}" y1="${tailY.toFixed(1)}" x2="${baseX.toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="${CALLOUT_COLOUR}" stroke-width="${stroke}" stroke-linecap="round"/>`,
    `<polygon points="${points}" fill="${CALLOUT_COLOUR}"/>`,
    "</svg>",
  ].join("");
}

function pageHtml({ width, height, body }) {
  return [
    "<!doctype html><html><head><meta charset='utf-8'><style>",
    "*{margin:0;padding:0}",
    `body{width:${width}px;height:${height}px;position:relative;overflow:hidden}`,
    "img.base{display:block;width:100%;height:100%}",
    "</style></head><body>",
    body,
    "</body></html>",
  ].join("");
}

async function shoot(browser, { width, height, body, out }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(pageHtml({ width, height, body }), { waitUntil: "load" });
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images).map((image) => (image.complete ? null : image.decode())),
    );
  });
  await page.screenshot({ path: out });
  await page.close();
}

async function signedInState(browser, origin) {
  const context = await browser.newContext();
  const response = await context.request.post(`${origin}/login`, {
    form: {
      email: requireEnv("SCREENSHOTS_ACCOUNT_EMAIL"),
      password: requireEnv("SCREENSHOTS_ACCOUNT_PASSWORD"),
    },
    maxRedirects: 0,
  });
  assert.equal(response.status(), 303, "signing the screenshots account in must redirect");
  const state = await context.storageState();
  await context.close();
  return state;
}

async function settle(page) {
  await waitForBrandFonts(page, ["Inter"]);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function openReadlist(page, origin) {
  await page.goto(`${origin}/queue`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-test-article-list]");
  await waitForImagePixels(page, ".readlist-article__thumbnail");
  await settle(page);
}

async function openReader(page, origin) {
  await openReadlist(page, origin);
  const hrefs = await page
    .locator("[data-test-article-title]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  for (const href of hrefs) {
    await page.goto(`${origin}${href}`, { waitUntil: "networkidle" });
    const status = await page.locator("[data-test-reader-summary]").getAttribute("data-summary-status");
    if (status !== "ready") continue;
    await page.click("details.article-body__summary > summary");
    await page.waitForSelector("details.article-body__summary[open]");
    await page.evaluate(() => {
      for (const element of document.querySelectorAll("[data-test-reader-float-stack]")) element.remove();
    });
    await settle(page);
    return;
  }
  assert.fail("no article in the readlist has a summary ready to show");
}

async function openImport(page, origin, linksPage) {
  await page.goto(`${origin}/import`, { waitUntil: "networkidle" });
  await page.fill("[data-test-import-from-url-input]", linksPage);
  await page.click('[data-test-action="import-from-url-submit"]');
  await page.waitForSelector('[data-test-action="import-commit"]');
  await settle(page);
}

const PAGES = {
  readlist: (page, manifest) => openReadlist(page, manifest.origin),
  reader: (page, manifest) => openReader(page, manifest.origin),
  import: (page, manifest) => openImport(page, manifest.origin, manifest.linksPage),
};

function selectorsFor(manifest, stillName) {
  const selectors = new Map();
  for (const output of manifest.outputs) {
    if (output.still !== stillName) continue;
    if (typeof output.callout?.around === "string")
      selectors.set(output.callout.around, { selector: output.callout.around, tight: output.callout.tight === true });
    if (output.cropBelow) selectors.set(output.cropBelow, { selector: output.cropBelow, tight: false });
  }
  return [...selectors.values()];
}

async function captureStill(browser, manifest, name, still, workDir, storageState) {
  const [width, height] = still.viewport;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "en-US",
    userAgent: DESKTOP_USER_AGENT,
    ...(still.page === "import" ? {} : { storageState }),
  });
  const page = await context.newPage();
  await PAGES[still.page](page, manifest);
  await page.evaluate((selectors) => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) element.remove();
    }
  }, manifest.volatile);
  const boxes = {};
  for (const { selector, tight } of selectorsFor(manifest, name)) {
    const box = tight
      ? await page.evaluate((wanted) => {
          const element = document.querySelector(wanted);
          if (!element) return undefined;
          const range = document.createRange();
          range.selectNodeContents(element);
          const rect = range.getBoundingClientRect();
          return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
        }, selector)
      : await page.locator(selector).first().boundingBox();
    assert(box, `${name}: ${selector} has no bounding box`);
    boxes[selector] = box;
  }
  const shot = join(workDir, `${name}@2x.png`);
  await page.screenshot({ path: shot });
  await context.close();
  return { shot, width, height, boxes };
}

function scaleTo(source, out, { width, height, crop }) {
  const filters = [];
  if (crop) filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  filters.push(`scale=${width}:${height}:flags=lanczos`);
  ffmpeg(["-y", "-i", source, "-vf", filters.join(","), "-pix_fmt", "rgb24", "-frames:v", "1", out]);
}

function finish(composed, file) {
  mkdirSync(dirname(file), { recursive: true });
  if (file.endsWith(".webp")) cwebp([composed, "-q", "90", "-m", "6", "-o", file]);
  else ffmpeg(["-y", "-i", composed, "-pix_fmt", "rgb24", "-frames:v", "1", file]);
}

async function composeOutput({ browser, manifest, output, captures, workDir, repoRoot }) {
  const name = basename(output.file);
  const target = join(repoRoot, output.file);
  const capture = output.still ? captures[output.still] : undefined;
  const background = output.card ? probeImage(target) : undefined;
  const size =
    output.size ??
    (background ? [background.width, background.height] : capture ? [capture.width, capture.height] : undefined);
  assert(size, `${name}: no output size`);
  const [width, height] = size;
  const base = join(workDir, `${name}.base.png`);

  if (output.card) {
    const [x, y, cardWidth, cardHeight] = output.card.rect;
    const cardImage = join(workDir, `${name}.card.png`);
    scaleTo(capture.shot, cardImage, { width: cardWidth, height: cardHeight });
    await shoot(browser, {
      width,
      height,
      out: base,
      body: [
        `<img class="base" src="${dataUri(target)}">`,
        `<div style="position:absolute;left:${x}px;top:${y}px;width:${cardWidth}px;height:${cardHeight}px;border-radius:${output.card.radius}px;overflow:hidden">`,
        `<img src="${dataUri(cardImage)}" style="display:block;width:100%;height:100%">`,
        "</div>",
      ].join(""),
    });
  } else if (output.source) {
    scaleTo(join(repoRoot, output.source), base, { width, height });
  } else if (output.cropBelow) {
    const box = capture.boxes[output.cropBelow];
    const cropHeight = Math.round(capture.width * 2 * (height / width));
    scaleTo(capture.shot, base, {
      width,
      height,
      crop: { x: 0, y: Math.round((box.y + box.height) * 2), width: capture.width * 2, height: cropHeight },
    });
  } else {
    scaleTo(capture.shot, base, { width, height });
  }

  let composed = base;
  if (output.callout) {
    const around = output.callout.around;
    const box = Array.isArray(around)
      ? { x: around[0], y: around[1], width: around[2], height: around[3] }
      : capture.boxes[around];
    composed = join(workDir, `${name}.callout.png`);
    await shoot(browser, {
      width,
      height,
      out: composed,
      body: [
        `<img class="base" src="${dataUri(base)}">`,
        calloutSvg({ width, height, box, pad: output.callout.pad, stroke: output.callout.stroke, arrowFrom: output.callout.arrowFrom }),
      ].join(""),
    });
  }

  finish(composed, target);
  const written = probeImage(target);
  assert.deepEqual([written.width, written.height], [width, height], `${name}: wrote ${written.width}x${written.height}`);
  return `${output.file} ${written.width}x${written.height}`;
}

export async function captureStills({ manifest, repoRoot, only }) {
  const workDir = join(repoRoot, "projects/hutch/test-results/media/stills");
  mkdirSync(workDir, { recursive: true });
  const selected = only.length
    ? manifest.outputs.filter((output) => only.includes(basename(output.file)))
    : manifest.outputs;
  assert(selected.length, `no outputs matched ${only.join(", ")}`);
  const outputs = selected.filter((output) => {
    if (!output.source || existsSync(join(repoRoot, output.source))) return true;
    console.log(`${output.file} skipped — ${output.source} has not been recorded yet`);
    return false;
  });
  assert(outputs.length, "every selected output is waiting on a recording");

  const browser = await chromium.launch();
  const captures = {};
  try {
    const names = [...new Set(outputs.map((output) => output.still).filter(Boolean))];
    const needsAccount = names.some((name) => manifest.stills[name].page !== "import");
    const storageState = needsAccount ? await signedInState(browser, manifest.origin) : undefined;
    for (const name of names) {
      captures[name] = await captureStill(browser, manifest, name, manifest.stills[name], workDir, storageState);
    }
    for (const output of outputs) {
      console.log(await composeOutput({ browser, manifest, output, captures, workDir, repoRoot }));
    }
  } finally {
    await browser.close();
  }
}
