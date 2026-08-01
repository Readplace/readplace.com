export interface Rgba {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8ClampedArray<ArrayBuffer>;
}

export type Tint = readonly [number, number, number];

/** #3D8B6E — the saved marker. Kept as a triple so the tint needs no parsing
 * and the contrast test measures the same value the toolbar renders. */
export const SAVED_TINT: Tint = [61, 139, 110];

export const NEEDS_CAPTURE_TINT: Tint = [200, 112, 42];

/** Recolours the glyph, then lays the haloed original behind it. The halo is the
 * only part that clears a dark toolbar, so it has to keep its white rather than
 * take the tint — which is why the tint is applied to the bare glyph and the
 * haloed variant is composited underneath rather than over. */
export function compositeTintedIcon(source: {
	glyph: Rgba;
	haloed: Rgba;
	tint: Tint;
}): Rgba {
	const { glyph, haloed, tint } = source;
	const data = new Uint8ClampedArray(glyph.data.length);

	for (let i = 0; i < data.length; i += 4) {
		const tintAlpha = glyph.data[i + 3] / 255;
		const haloAlpha = (haloed.data[i + 3] / 255) * (1 - tintAlpha);
		const alpha = tintAlpha + haloAlpha;

		for (let channel = 0; channel < 3; channel++) {
			const blended =
				tint[channel] * tintAlpha + haloed.data[i + channel] * haloAlpha;
			data[i + channel] = alpha === 0 ? 0 : blended / alpha;
		}
		data[i + 3] = alpha * 255;
	}

	return { width: glyph.width, height: glyph.height, data };
}
