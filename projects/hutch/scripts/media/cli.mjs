import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { desktopTake } from "./desktop-take.mjs";
import { encodeVideo } from "./encode.mjs";
import { captureStills } from "./stills.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

const Point = z.tuple([z.number(), z.number()]);
const Box = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const Callout = z.object({
  around: z.union([z.string(), Box]),
  pad: Point,
  arrowFrom: z.enum(["n", "ne", "e", "se", "s", "sw", "w", "nw"]),
  stroke: z.number(),
  tight: z.boolean().optional(),
});

const Output = z.object({
  file: z.string(),
  still: z.string().optional(),
  source: z.string().optional(),
  size: Point.optional(),
  cropBelow: z.string().optional(),
  callout: Callout.optional(),
  card: z.object({ rect: Box, radius: z.number() }).optional(),
});

const Step = z.object({
  label: z.string(),
  at: Point.optional(),
  key: z.string().optional(),
  still: z.string().optional(),
});

const Video = z.object({
  output: z.object({ video: z.string(), poster: z.string(), width: z.number(), height: z.number() }),
  indicator: z
    .object({ radius: z.number(), stroke: z.number(), leadMs: z.number(), lagMs: z.number() })
    .optional(),
  cut: z.object({
    introMs: z.number(),
    leadMs: z.number(),
    holdMs: z.number(),
    holds: z.record(z.string(), z.number()).optional(),
  }),
  poster: z.object({ after: z.string(), offsetMs: z.number() }),
  desktop: z
    .object({
      browser: z.enum(["chrome", "firefox"]),
      profileDirEnv: z.string(),
      pinnedMarker: z.string(),
      article: z.string(),
      window: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      settleMs: z.number(),
      steps: z.array(Step),
    })
    .optional(),
});

const Manifest = z.object({
  origin: z.string(),
  screenDevice: z.string(),
  volatile: z.array(z.string()),
  stills: z.record(
    z.string(),
    z.object({ page: z.enum(["readlist", "reader", "import"]), viewport: Point }),
  ),
  linksPage: z.string(),
  outputs: z.array(Output),
  videos: z.record(z.string(), Video),
});

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const only = [];
  const flags = {};
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--only" || argument === "--take") {
      index += 1;
      assert(rest[index], `${argument} needs a value`);
      if (argument === "--only") only.push(rest[index]);
      else flags.take = rest[index];
    } else if (argument === "--dry-run") {
      flags.dryRun = true;
    } else {
      assert(!argument.startsWith("--"), `unexpected argument ${argument}`);
      positional.push(argument);
    }
  }
  return { command, only, positional, flags };
}

const USAGE =
  "usage: media <stills [--only <file name>]… | desktop <video> [--dry-run] | encode <video> --take <take.json>>";

async function main() {
  const { command, only, positional, flags } = parseArgs(process.argv.slice(2));
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(here, "media.json"), "utf8")));
  if (command === "stills") return captureStills({ manifest, repoRoot, only });
  if (command === "desktop") {
    assert(positional[0], USAGE);
    return desktopTake({ manifest, repoRoot, name: positional[0], dryRun: flags.dryRun === true });
  }
  if (command === "encode") {
    assert(positional[0] && flags.take, USAGE);
    return encodeVideo({ manifest, repoRoot, name: positional[0], takePath: flags.take });
  }
  assert.fail(USAGE);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
