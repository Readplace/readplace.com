import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export function resolveTool(name, installHint) {
  try {
    execFileSync("/usr/bin/which", [name], { stdio: "ignore" });
    return name;
  } catch (cause) {
    throw new Error(`${name} not on PATH — ${installHint}`, { cause });
  }
}

export function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (cause) {
    const detail = typeof cause.stderr === "string" ? cause.stderr.trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`, { cause });
  }
}

export function ffmpeg(args) {
  return run(resolveTool("ffmpeg", "brew install ffmpeg"), ["-hide_banner", "-loglevel", "error", ...args]);
}

export function ffprobe(args) {
  return run(resolveTool("ffprobe", "brew install ffmpeg"), ["-v", "error", ...args]);
}

export function cwebp(args) {
  return run(resolveTool("cwebp", "brew install webp"), ["-quiet", ...args]);
}

export function probeImage(file) {
  const [width, height] = ffprobe([
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    file,
  ])
    .trim()
    .split("x")
    .map(Number);
  return { width, height };
}

export function probeVideo(file) {
  const parsed = JSON.parse(
    ffprobe([
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,profile,width,height,r_frame_rate,pix_fmt:format=duration",
      "-of",
      "json",
      file,
    ]),
  );
  const stream = parsed.streams[0];
  const [numerator, denominator] = stream.r_frame_rate.split("/").map(Number);
  return {
    codec: stream.codec_name,
    profile: stream.profile,
    width: stream.width,
    height: stream.height,
    pixelFormat: stream.pix_fmt,
    fps: numerator / denominator,
    duration: Number(parsed.format.duration),
  };
}

export function dataUri(file) {
  const mime = MIME_BY_EXTENSION[extname(file).toLowerCase()];
  if (!mime) throw new Error(`no data-uri mime type for ${file}`);
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}
