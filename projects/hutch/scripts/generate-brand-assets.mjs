/**
 * Regenerates every raster brand asset from the vector sources of truth:
 * brandMarkSvg (@packages/web-shell), favicon.svg (the dotless small-size
 * variant), and the path-based lockup masters in ../brand/. All output is
 * deterministic — the sources contain no <text> elements, so no installed
 * font can change a single pixel.
 *
 * Run after compiling web-shell:
 *   pnpm nx run @packages/web-shell:compile && node scripts/generate-brand-assets.mjs
 *
 * Requires rsvg-convert (provided by the devbox toolchain).
 *
 * Size policy (BRAND_GUIDELINES.md): the amber dot ships only at >= 33px;
 * below that the dotless small-size glyph ships instead.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brandMarkSvg } from "@packages/web-shell";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const staticAssets = join(here, "..", "static-assets");
const brandDir = join(here, "..", "brand");

const RSVG_CANDIDATES = [
	"rsvg-convert",
	join(repoRoot, ".devbox", "nix", "profile", "default", "bin", "rsvg-convert"),
];
const rsvg = RSVG_CANDIDATES.find((candidate) => {
	try {
		execFileSync(candidate, ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
});
if (!rsvg) {
	throw new Error("rsvg-convert not found — install devbox tooling first");
}

const NAVY = "#2B3A55";
const AMBER = "#C8923C";

// ---- pull the canonical geometry out of the two guarded vector sources ----

const tileMark = brandMarkSvg();
const glyphPath = tileMark.match(/<path d="([^"]+)" fill="#FFFFFF"\/>/)?.[1];
const dot = tileMark.match(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/);
if (!glyphPath || !dot) {
	throw new Error("brandMarkSvg no longer matches the expected path+circle structure");
}
const [, dotCx, dotCy, dotR] = dot.map(Number);

const faviconSvg = readFileSync(join(staticAssets, "favicon.svg"), "utf-8");
const smallGlyphPath = faviconSvg.match(/<path d="([^"]+)" fill="#FFFFFF"\/>/)?.[1];
if (!smallGlyphPath) {
	throw new Error("favicon.svg no longer matches the expected small-glyph structure");
}

// Combined glyph+dot visual bounds in the 512 tile space (from the geometry spec)
const BB = { left: 110.07, right: dotCx + dotR, top: 133.57, bottom: 400 };

const DOT_SVG = `<circle cx="${dotCx}" cy="${dotCy}" r="${dotR}" fill="${AMBER}"/>`;

const smallTile = faviconSvg;

function fullBleed() {
	const cx = (BB.left + BB.right) / 2;
	const cy = (BB.top + BB.bottom) / 2;
	const shift = { x: 256 - cx, y: 256 - cy };
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${NAVY}"/><g transform="translate(${shift.x.toFixed(1)} ${shift.y.toFixed(1)})"><path d="${glyphPath}" fill="#FFFFFF"/>${DOT_SVG}</g></svg>`;
}

function glyphOnly(opts) {
	const right = opts.withDot ? BB.right : 384.6;
	const width = right - BB.left;
	const height = BB.bottom - BB.top;
	const scale = (512 * 0.9) / Math.max(width, height);
	const tx = (512 - width * scale) / 2 - BB.left * scale;
	const ty = (512 - height * scale) / 2 - BB.top * scale;
	const halo = opts.halo
		? `<path d="${glyphPath}" fill="none" stroke="#FFFFFF" stroke-width="26" stroke-linejoin="round"/>`
		: "";
	const dotPart = opts.withDot ? DOT_SVG : "";
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale.toFixed(4)})">${halo}<path d="${glyphPath}" fill="${NAVY}"/>${dotPart}</g></svg>`;
}

function render(svg, size, outPath, heightOverride) {
	const args = ["--width", String(size), "--height", String(heightOverride ?? size), "--output", outPath, "/dev/stdin"];
	execFileSync(rsvg, args, { input: svg });
	console.log("wrote", outPath);
}

function renderFile(svgPath, width, height, outPath) {
	execFileSync(rsvg, ["--width", String(width), "--height", String(height), "--output", outPath, svgPath]);
	console.log("wrote", outPath);
}

// PNG-entry ICO container (valid for modern Windows at 16-256px)
function writeIco(pngPaths, outPath) {
	const images = pngPaths.map((p) => readFileSync(p));
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	const entries = [];
	let offset = 6 + 16 * images.length;
	images.forEach((data, i) => {
		const size = [16, 32, 48][i];
		const entry = Buffer.alloc(16);
		entry.writeUInt8(size === 256 ? 0 : size, 0);
		entry.writeUInt8(size === 256 ? 0 : size, 1);
		entry.writeUInt8(0, 2);
		entry.writeUInt8(0, 3);
		entry.writeUInt16LE(1, 4);
		entry.writeUInt16LE(32, 6);
		entry.writeUInt32LE(data.length, 8);
		entry.writeUInt32LE(offset, 12);
		entries.push(entry);
		offset += data.length;
	});
	writeFileSync(outPath, Buffer.concat([header, ...entries, ...images]));
	console.log("wrote", outPath);
}

// ---- web favicons -----------------------------------------------------------

render(smallTile, 16, join(staticAssets, "favicon-16x16.png"));
render(smallTile, 32, join(staticAssets, "favicon-32x32.png"));
render(tileMark, 48, join(staticAssets, "favicon-48x48.png"));
render(tileMark, 96, join(staticAssets, "favicon-96x96.png"));
writeIco(
	[
		join(staticAssets, "favicon-16x16.png"),
		join(staticAssets, "favicon-32x32.png"),
		join(staticAssets, "favicon-48x48.png"),
	],
	join(staticAssets, "favicon.ico"),
);

// ---- apple touch icons (opaque full-bleed squares; iOS applies its own mask) --

const appleSizes = [57, 60, 72, 76, 114, 120, 144, 152, 167, 180];
const fullBleedSvg = fullBleed();
for (const size of appleSizes) {
	render(fullBleedSvg, size, join(staticAssets, `apple-touch-icon-${size}x${size}.png`));
}
render(fullBleedSvg, 180, join(staticAssets, "apple-touch-icon.png"));

// ---- android chrome ----------------------------------------------------------

for (const size of [48, 72, 96, 144, 192, 512]) {
	render(tileMark, size, join(staticAssets, `android-chrome-${size}x${size}.png`));
}
for (const size of [192, 512]) {
	render(fullBleedSvg, size, join(staticAssets, `android-chrome-maskable-${size}x${size}.png`));
}

// ---- windows tiles -----------------------------------------------------------

for (const size of [70, 150]) {
	render(fullBleedSvg, size, join(staticAssets, `mstile-${size}x${size}.png`));
}
render(fullBleedSvg, 310, join(staticAssets, "mstile-310x310.png"));
renderFile(join(brandDir, "mstile-wide.svg"), 310, 150, join(staticAssets, "mstile-310x150.png"));

// ---- social cards ------------------------------------------------------------

renderFile(join(brandDir, "og-image.svg"), 1200, 630, join(staticAssets, "og-image-1200x630.png"));
renderFile(join(brandDir, "twitter-card.svg"), 1200, 600, join(staticAssets, "twitter-card-1200x600.png"));

// ---- extension icons (glyph-only; light = white halo for dark toolbars) -------

const extensionRoots = [
	join(repoRoot, "projects", "extensions", "chrome-extension", "src", "icons"),
	join(repoRoot, "projects", "extensions", "firefox-extension", "src", "icons"),
];
for (const root of extensionRoots) {
	for (const theme of ["light", "dark"]) {
		const dir = join(root, theme);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		for (const size of [16, 32, 48, 64, 96, 128]) {
			const svg = glyphOnly({ halo: theme === "light", withDot: size >= 33 });
			render(svg, size, join(dir, `icon-${size}.png`));
		}
	}
}

console.log("done");
