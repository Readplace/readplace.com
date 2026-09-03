import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
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

const Manifest = z.object({
  origin: z.string(),
  volatile: z.array(z.string()),
  stills: z.record(
    z.string(),
    z.object({ page: z.enum(["readlist", "reader", "import"]), viewport: Point }),
  ),
  linksPage: z.string(),
  outputs: z.array(Output),
});

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const only = [];
  for (let index = 0; index < rest.length; index += 1) {
    assert.equal(rest[index], "--only", `unexpected argument ${rest[index]}`);
    index += 1;
    assert(rest[index], "--only needs a file name");
    only.push(rest[index]);
  }
  return { command, only };
}

async function main() {
  const { command, only } = parseArgs(process.argv.slice(2));
  assert.equal(command, "stills", "usage: media stills [--only <file name>]…");
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(here, "media.json"), "utf8")));
  await captureStills({ manifest, repoRoot, only });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
