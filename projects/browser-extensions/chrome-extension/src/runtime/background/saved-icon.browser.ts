import browser from "webextension-polyfill";
import { compositeSavedIcon, type Rgba } from "./composite-saved-icon";

const ICON_SIZES = [16, 32, 48, 64] as const;

// Cannot use node:assert in browser bundles — this minimal assert
// narrows the asserts-value for runtime invariants.
function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function readIcon(path: string, size: number): Promise<Rgba> {
	const response = await fetch(browser.runtime.getURL(path));
	const bitmap = await createImageBitmap(await response.blob());
	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext("2d");
	assert(ctx, "OffscreenCanvas must provide a 2d context");
	ctx.drawImage(bitmap, 0, 0, size, size);
	return ctx.getImageData(0, 0, size, size);
}

async function tintIcon(size: number): Promise<ImageData> {
	const [glyph, haloed] = await Promise.all([
		readIcon(`icons/dark/icon-${size}.png`, size),
		readIcon(`icons/light/icon-${size}.png`, size),
	]);
	const { data } = compositeSavedIcon({ glyph, haloed });
	return new ImageData(data, size, size);
}

let pending: Promise<Record<number, ImageData>> | null = null;

async function tintEverySize(): Promise<Record<number, ImageData>> {
	const entries = await Promise.all(
		ICON_SIZES.map(async (size) => [size, await tintIcon(size)] as const),
	);
	return Object.fromEntries(entries);
}

export function getSavedIconData(): Promise<Record<number, ImageData>> {
	// Cache the promise, not its value: the four tints are kicked off once even
	// when saves land back-to-back before the first has resolved.
	pending ??= tintEverySize();
	return pending;
}
