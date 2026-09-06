export interface Rgb {
	red: number;
	green: number;
	blue: number;
}

const NORMAL_TEXT_MINIMUM = 4.5;
const LARGE_TEXT_MINIMUM = 3;
export const NON_TEXT_MINIMUM = 3;
const LARGE_TEXT_PX = 24;
const BOLD_LARGE_TEXT_PX = 18.66;
const BOLD_WEIGHT = 700;

const SRGB_LINEAR_CUTOFF = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_EXPONENT = 2.4;
const CONTRAST_FLARE = 0.05;
const RED_LUMINANCE = 0.2126;
const GREEN_LUMINANCE = 0.7152;
const BLUE_LUMINANCE = 0.0722;

function channelLuminance(value: number): number {
	const channel = value / 255;
	return channel <= SRGB_LINEAR_CUTOFF
		? channel / SRGB_LINEAR_DIVISOR
		: ((channel + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_EXPONENT;
}

function relativeLuminance(colour: Rgb): number {
	return (
		RED_LUMINANCE * channelLuminance(colour.red) +
		GREEN_LUMINANCE * channelLuminance(colour.green) +
		BLUE_LUMINANCE * channelLuminance(colour.blue)
	);
}

export function contrastRatio(pair: { ink: Rgb; surface: Rgb }): number {
	const inkLuminance = relativeLuminance(pair.ink);
	const surfaceLuminance = relativeLuminance(pair.surface);
	const lighter = Math.max(inkLuminance, surfaceLuminance);
	const darker = Math.min(inkLuminance, surfaceLuminance);
	return (lighter + CONTRAST_FLARE) / (darker + CONTRAST_FLARE);
}

export function textMinimum(text: { fontSizePx: number; fontWeight: number }): number {
	const boldSizeCredit = text.fontWeight >= BOLD_WEIGHT ? LARGE_TEXT_PX - BOLD_LARGE_TEXT_PX : 0;
	const isLargeText = text.fontSizePx + boldSizeCredit >= LARGE_TEXT_PX;
	return isLargeText ? LARGE_TEXT_MINIMUM : NORMAL_TEXT_MINIMUM;
}

/** CSS `filter: grayscale(1)` is `feColorMatrix type="saturate" values="0"`
 * evaluated in sRGB, so it weights the gamma-encoded channels — not the
 * linearised ones WCAG's relative luminance uses. The two disagree by up to
 * 0.7:1, in both directions, so clearing a minimum in colour does not clear it
 * once the panel drops hue. */
function greyscale(colour: Rgb): Rgb {
	const ink =
		RED_LUMINANCE * colour.red + GREEN_LUMINANCE * colour.green + BLUE_LUMINANCE * colour.blue;
	return { red: ink, green: ink, blue: ink };
}

export const LENSES = {
	colour: (colour: Rgb): Rgb => colour,
	greyscale,
} as const;
