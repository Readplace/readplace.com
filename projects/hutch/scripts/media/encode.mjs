import assert from "node:assert";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cwebp, ffmpeg, probeVideo } from "./tools.mjs";

const RING_COLOUR = { r: 255, g: 59, b: 48 };
const RING_FILL_OPACITY = 0.25;

function rawSeconds(take, event) {
  return (event.wallMs - take.recorderStartedAtMs + (take.syncOffsetMs ?? 0)) / 1000;
}

function cutWindows(video, take) {
  const events = [...take.events].sort((left, right) => left.wallMs - right.wallMs);
  assert(events.length, "the take recorded no events");
  const { introMs, leadMs, holdMs, holds = {} } = video.cut;
  const windows = events.map((event, index) => {
    const at = rawSeconds(take, event);
    const lead = index === 0 ? introMs : leadMs;
    return [Math.max(0, at - lead / 1000), at + (holds[event.label] ?? holdMs) / 1000];
  });
  const merged = [windows[0]];
  for (const [start, end] of windows.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function ringInput(indicator, duration) {
  const radius = indicator.radius;
  const stroke = indicator.stroke;
  const size = 2 * (radius + stroke) + 2;
  const centre = (size - 1) / 2;
  const distance = `hypot(X-${centre}\\,Y-${centre})`;
  const alpha = `255*clip(${radius}+${stroke}/2+0.5-${distance},0,1)*if(lt(${distance},${radius}-${stroke}/2),${RING_FILL_OPACITY},1)`;
  return {
    size,
    source: `color=c=black@0:s=${size}x${size}:r=30:d=${duration},format=rgba,geq=r=${RING_COLOUR.r}:g=${RING_COLOUR.g}:b=${RING_COLOUR.b}:a='${alpha}'`,
  };
}

function filterGraph({ video, take, windows, scale, ring }) {
  const [width, height] = [video.output.width, video.output.height];
  const rings = video.indicator
    ? take.events.filter((event) => event.kind === "tap" || event.kind === "long-press")
    : [];
  const steps = [`[0:v]fps=30,scale=${width}:${height}:flags=lanczos[v0]`];
  if (rings.length) {
    steps.push(`[1:v]split=${rings.length}${rings.map((_, index) => `[r${index}]`).join("")}`);
    rings.forEach((event, index) => {
      const at = rawSeconds(take, event);
      const from = at - video.indicator.leadMs / 1000;
      const to = at + (event.durationMs ?? 0) / 1000 + video.indicator.lagMs / 1000;
      const x = Math.round(event.x * scale - ring.size / 2);
      const y = Math.round(event.y * scale - ring.size / 2);
      steps.push(
        `[v${index}][r${index}]overlay=x=${x}:y=${y}:enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'[v${index + 1}]`,
      );
    });
  }
  const select = windows
    .map(([start, end]) => `between(t,${start.toFixed(3)},${end.toFixed(3)})`)
    .join("+");
  steps.push(`[v${rings.length}]select='${select}',setpts=N/FRAME_RATE/TB,format=yuv420p[out]`);
  return steps.join(";");
}

function posterSecond(video, take, windows) {
  const event = take.events.find((candidate) => candidate.label === video.poster.after);
  assert(event, `the take has no event labelled ${video.poster.after}`);
  const at = rawSeconds(take, event) + video.poster.offsetMs / 1000;
  assert(
    windows.some(([start, end]) => at >= start && at <= end),
    "the poster frame falls in a stretch the cut removes",
  );
  return at;
}

export function encodeVideo({ manifest, repoRoot, name, takePath }) {
  const video = manifest.videos[name];
  assert(video, `no video named ${name} in the manifest`);
  const take = JSON.parse(readFileSync(takePath, "utf8"));
  const raw = take.raw;
  const source = probeVideo(raw);
  const scale = video.output.width / source.width;
  assert.equal(
    Math.round(source.height * scale),
    video.output.height,
    `the take is ${source.width}x${source.height}, which does not scale to ${video.output.width}x${video.output.height}`,
  );

  const windows = cutWindows(video, take);
  for (const event of take.events) {
    const at = rawSeconds(take, event);
    const window = windows.find(([start, end]) => at >= start && at <= end);
    assert(window, `the cut drops the ${event.label} event at ${at.toFixed(2)}s`);
    console.log(`${event.label.padEnd(18)} raw ${at.toFixed(2)}s`);
  }

  const ring = video.indicator ? ringInput(video.indicator, source.duration) : undefined;
  const graph = filterGraph({ video, take, windows, scale, ring });
  const outputVideo = join(repoRoot, video.output.video);
  mkdirSync(dirname(outputVideo), { recursive: true });
  ffmpeg([
    "-y",
    "-i",
    raw,
    ...(ring ? ["-f", "lavfi", "-i", ring.source] : []),
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "23",
    "-profile:v",
    "high",
    "-movflags",
    "+faststart",
    "-an",
    outputVideo,
  ]);

  const workDir = dirname(takePath);
  const posterPng = join(workDir, "poster.png");
  ffmpeg([
    "-y",
    "-ss",
    String(posterSecond(video, take, windows)),
    "-i",
    raw,
    "-frames:v",
    "1",
    "-vf",
    `scale=${video.output.width}:${video.output.height}:flags=lanczos`,
    "-pix_fmt",
    "rgb24",
    posterPng,
  ]);
  const outputPoster = join(repoRoot, video.output.poster);
  cwebp([posterPng, "-q", "90", "-m", "6", "-o", outputPoster]);

  ffmpeg(["-y", "-i", outputVideo, "-vf", "fps=2,scale=240:-2,tile=8x8", join(workDir, "contact-sheet.png")]);

  const written = probeVideo(outputVideo);
  assert.equal(written.width, video.output.width, "encoded width");
  assert.equal(written.height, video.output.height, "encoded height");
  assert.equal(written.pixelFormat, "yuv420p", "encoded pixel format");
  assert.equal(written.fps, 30, "encoded frame rate");
  console.log(
    `${video.output.video} ${written.width}x${written.height} ${written.codec}/${written.profile} ${written.duration.toFixed(1)}s`,
  );
  console.log(`${video.output.poster} written; review ${join(workDir, "contact-sheet.png")}`);
}
