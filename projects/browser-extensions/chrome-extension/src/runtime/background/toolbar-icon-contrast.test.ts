import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { compositeSavedIcon, type Rgba } from "./composite-saved-icon";

// Toolbar backgrounds the action icon is actually painted on. Chromium exposes
// no API for the toolbar colour, so the shipped asset has to clear every one of
// them rather than being selected per theme at runtime.
const TOOLBAR_BACKGROUNDS = {
	"chrome light": [241, 243, 244],
	"chrome dark": [41, 42, 45],
	"brave dark": [59, 59, 63],
} as const;

const MIN_CONTRAST = 3;
const MIN_LEGIBLE_INK = 0.3;

const extensionRoot = join(__dirname, "..", "..", "..", "src");

interface Pixels {
	width: number;
	height: number;
	data: Buffer;
}

/** Minimal decoder for 8-bit RGBA non-interlaced PNGs — enough to read ink
 * coverage without pulling in an image dependency. */
function decodePng(bytes: Buffer): Pixels {
	const chunks: Buffer[] = [];
	let width = 0;
	let height = 0;
	let offset = 8;

	while (offset < bytes.length) {
		const length = bytes.readUInt32BE(offset);
		const type = bytes.toString("ascii", offset + 4, offset + 8);
		const body = bytes.subarray(offset + 8, offset + 8 + length);

		if (type === "IHDR") {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			assert.deepEqual(
				{ bitDepth: body[8], colorType: body[9], interlace: body[12] },
				{ bitDepth: 8, colorType: 6, interlace: 0 },
				"decoder only handles 8-bit RGBA non-interlaced PNGs",
			);
		}
		// Encoders may split the pixel stream across several IDATs — the zlib
		// stream only inflates once they are rejoined.
		if (type === "IDAT") chunks.push(body);
		if (type === "IEND") break;

		offset += 12 + length;
	}

	const raw = inflateSync(Buffer.concat(chunks));
	const data = Buffer.alloc(width * height * 4);
	const stride = width * 4;

	assert.equal(
		raw.length,
		height * (stride + 1),
		"IDAT must carry every scanline",
	);

	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));

		for (let x = 0; x < stride; x++) {
			const left = x >= 4 ? data[y * stride + x - 4] : 0;
			const up = y > 0 ? data[(y - 1) * stride + x] : 0;
			const upLeft = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
			data[y * stride + x] = (line[x] + predict(filter, left, up, upLeft)) & 0xff;
		}
	}

	return { width, height, data };
}

function predict(filter: number, a: number, b: number, c: number): number {
	if (filter === 1) return a;
	if (filter === 2) return b;
	if (filter === 3) return Math.floor((a + b) / 2);
	if (filter === 4) return paeth(a, b, c);
	return 0;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

function relativeLuminance(rgb: readonly number[]): number {
	const [r, g, b] = rgb.map((channel) => {
		const v = channel / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: readonly number[], b: readonly number[]): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
		(x, y) => y - x,
	);
	return (hi + 0.05) / (lo + 0.05);
}

/** Share of the icon's ink that stays legible once composited onto `background`.
 * Peak contrast is not enough — a single bright antialiased pixel satisfies it
 * while the glyph itself vanishes. */
function legibleInkRatio(pixels: Pixels, background: readonly number[]): number {
	let ink = 0;
	let legible = 0;

	for (let i = 0; i < pixels.data.length; i += 4) {
		const alpha = pixels.data[i + 3] / 255;
		if (alpha < 0.5) continue;
		ink++;
		const composited = [0, 1, 2].map(
			(channel) =>
				pixels.data[i + channel] * alpha + background[channel] * (1 - alpha),
		);
		if (contrastRatio(composited, background) >= MIN_CONTRAST) legible++;
	}

	assert(ink > 0, "icon must contain opaque pixels");
	return legible / ink;
}

function assertActionIcons(
	value: unknown,
): asserts value is { action: { default_icon: Record<string, string> } } {
	assert(typeof value === "object" && value !== null, "manifest must be an object");
	const action = Reflect.get(value, "action");
	assert(
		typeof action === "object" && action !== null,
		"manifest must declare an action",
	);
	const icons = Reflect.get(action, "default_icon");
	assert(
		typeof icons === "object" && icons !== null,
		"action must declare default_icon",
	);
	assert(
		Object.values(icons).every((path) => typeof path === "string"),
		"every default_icon entry must be a path",
	);
}

function actionIconPaths(): string[] {
	const manifest: unknown = JSON.parse(
		readFileSync(join(extensionRoot, "runtime", "manifest.json"), "utf8"),
	);
	assertActionIcons(manifest);
	return Object.values(manifest.action.default_icon);
}

function readIcon(iconPath: string): Pixels {
	return decodePng(readFileSync(join(extensionRoot, iconPath)));
}

function expectLegibleOnEveryToolbar(pixels: Pixels, label: string): void {
	for (const [toolbar, background] of Object.entries(TOOLBAR_BACKGROUNDS)) {
		const ratio = legibleInkRatio(pixels, background);
		expect({ label, toolbar, legible: ratio >= MIN_LEGIBLE_INK }).toEqual({
			label,
			toolbar,
			legible: true,
		});
	}
}

function toRgba(pixels: Pixels): Rgba {
	return {
		width: pixels.width,
		height: pixels.height,
		data: new Uint8ClampedArray(pixels.data),
	};
}

describe("toolbar icon contrast", () => {
	it.each(actionIconPaths())("%s stays legible on every toolbar", (iconPath) => {
		expectLegibleOnEveryToolbar(readIcon(iconPath), iconPath);
	});

	// The saved icon is synthesised at runtime, so it is the one variant no
	// shipped asset can vouch for — and it is what a reader sees the instant
	// they save, which is when a vanished icon reads as a failed save.
	it.each([16, 32, 48, 64])(
		"the %ipx saved icon stays legible on every toolbar",
		(size) => {
			const saved = compositeSavedIcon({
				glyph: toRgba(readIcon(`icons/dark/icon-${size}.png`)),
				haloed: toRgba(readIcon(`icons/light/icon-${size}.png`)),
			});
			expectLegibleOnEveryToolbar(
				{ width: saved.width, height: saved.height, data: Buffer.from(saved.data) },
				`saved-${size}`,
			);
		},
	);

	it.each([16, 32, 48, 64])(
		"the %ipx saved icon is distinguishable from the unsaved icon",
		(size) => {
			const haloed = toRgba(readIcon(`icons/light/icon-${size}.png`));
			const saved = compositeSavedIcon({
				glyph: toRgba(readIcon(`icons/dark/icon-${size}.png`)),
				haloed,
			});

			let ink = 0;
			let recoloured = 0;
			for (let i = 0; i < haloed.data.length; i += 4) {
				if (haloed.data[i + 3] < 128) continue;
				ink++;
				const shifted = [0, 1, 2].some(
					(channel) =>
						Math.abs(saved.data[i + channel] - haloed.data[i + channel]) > 32,
				);
				if (shifted) recoloured++;
			}

			expect(recoloured / ink).toBeGreaterThan(MIN_LEGIBLE_INK);
		},
	);
});
