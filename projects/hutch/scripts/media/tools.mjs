import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const VERSION_FLAGS = ["-version", "--version", "-V"];

const MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export function resolveTool(name, installHint) {
  for (const flag of VERSION_FLAGS) {
    try {
      execFileSync(name, [flag], { stdio: "ignore" });
      return name;
    } catch (cause) {
      if (cause.code === "ENOENT") break;
    }
  }
  throw new Error(`${name} not on PATH — ${installHint}`);
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

export function dataUri(file) {
  const mime = MIME_BY_EXTENSION[extname(file).toLowerCase()];
  if (!mime) throw new Error(`no data-uri mime type for ${file}`);
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}
