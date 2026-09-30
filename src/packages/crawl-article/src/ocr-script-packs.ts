/** Packs measured end-to-end against a scan-degraded page per script. The list
 * stops well short of the 37 tessdata ships because OSD is the limit rather
 * than the packs: it can name 17 scripts, and for anything else it answers
 * confidently and wrongly, so a Georgian page comes back as Arabic. Shipping a
 * pack nothing can route to is weight behind a door with no handle. */
export const OCR_SCRIPT_PACKS = [
	"Arabic",
	"Bengali",
	"Cyrillic",
	"Devanagari",
	"Greek",
	"HanS",
	"Hangul",
	"Hebrew",
	"Japanese",
	"Kannada",
	"Latin",
	"Malayalam",
	"Tamil",
	"Telugu",
	"Thai",
] as const;

export type OcrScriptPack = (typeof OCR_SCRIPT_PACKS)[number];
