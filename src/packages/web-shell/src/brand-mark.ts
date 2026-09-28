/**
 * The Readplace mark as one self-contained inline SVG: navy tile, white
 * ampersand, amber dot resting on the ampersand's palm terminal. The glyph is
 * fixed `<path>` geometry (Noto Serif Bold outlines, OFL-licensed, with the
 * palm/floor edits from the 2026 mark review) so the mark renders identically
 * on every machine — never reintroduce a `<text>` element, whose shape would
 * depend on the viewer's installed fonts. The white keyline (`stroke` +
 * `stroke-opacity`) is load-bearing, not decoration — it alpha-composites
 * against whatever sits behind the mark, keeping the navy tile visible on
 * dark/navy surfaces (blog header, extension popup, navy hero, favicon tab
 * strip) that a CSS layer can't reach. Do not remove it or change the navy
 * fill; both are guarded by tests.
 *
 * `className` present ⇒ the mark is inline site chrome sitting next to the
 * wordmark, so it is emitted decorative (aria-hidden). Absent ⇒ a standalone
 * asset (icon.svg, favicon) referenced as an image.
 */

const AMPERSAND_PATH =
	"M204.28 400Q159.02 400 134.54 383.62Q110.07 363.57 110.07 326.4Q110.07 304.69 119.27 290.89Q128.47 277.09 143.19 268.26Q157.91 259.42 174.84 252.8Q160.12 235.87 153.5 221.89Q146.87 207.9 146.87 190.98Q146.87 164.11 165.09 148.84Q183.3 133.57 220.84 133.57Q245.86 133.57 261.32 140.74Q276.78 147.92 283.95 159.7Q291.13 171.47 291.13 185.82Q291.13 208.27 277.51 222.62Q263.9 236.98 235.56 250.22L290.39 308.74Q293.34 298.43 294.62 285Q295.91 271.57 295.91 259.42V243.23H314C325 243.23 337 230.15 344 230.15C348 230.15 350 231.2 353 231.2C356 231.2 359 229.95 362.5 229.95C369.2 229.95 374.6 235.4 374.6 242C374.6 246.6 371.9 250.6 367.6 251.8C356.85 254.8 344.24 265.44 338.78 269.91Q332.71 274.88 329.77 286.29Q326.82 296.59 322.78 308Q318.73 319.41 313.21 331.55L350.01 369.82Q355.9 376.45 363.81 378.47Q371.72 380.5 381.29 380.5H384.6V400H311.74L284.14 371.3Q271.62 384.54 251.75 394.11Q231.88 400 204.28 400ZM220.1 233.66Q235.19 224.83 242.18 213.98Q249.18 203.12 249.18 186.19Q249.18 172.21 242.55 163.93Q235.93 155.65 222.68 155.65Q209.8 155.65 202.81 163.74Q195.82 171.84 195.82 186.56Q195.82 199.07 202.07 209.93Q208.33 220.78 220.1 233.66ZM214.95 378.29Q232.62 378.29 246.05 370.93Q259.48 363.57 267.94 353.26L190.66 270.83Q177.78 280.03 171.9 293.46Q166.01 306.9 166.01 325.66Q166.01 350.69 179.44 364.49Q192.87 378.29 214.95 378.29Z";

const SMALL_AMPERSAND_PATH =
	"M207.77 405.2Q157.08 405.2 129.66 386.85Q102.26 364.4 102.26 322.77Q102.26 298.45 112.56 283Q122.87 267.54 139.35 257.65Q155.84 247.75 174.8 240.34Q158.31 221.37 150.9 205.72Q143.47 190.05 143.47 171.1Q143.47 141 163.88 123.9Q184.28 106.8 226.32 106.8Q254.34 106.8 271.66 114.83Q288.97 122.87 297 136.06Q305.05 149.25 305.05 165.32Q305.05 190.46 289.79 206.53Q274.55 222.62 242.81 237.45L304.22 302.99Q307.52 291.44 308.95 276.4Q310.4 261.36 310.4 247.75V229.62H330.66C342.98 229.62 356.42 214.97 364.26 214.97C368.74 214.97 370.98 216.14 374.34 216.14C377.7 216.14 381.06 214.74 384.98 214.74C392.48 214.74 398.53 220.85 398.53 228.24C398.53 233.39 395.51 237.87 390.69 239.22C378.65 242.58 364.53 254.49 358.41 259.5Q351.62 265.07 348.32 277.84Q345.02 289.38 340.49 302.16Q335.96 314.94 329.78 328.54L370.99 371.4Q377.59 378.82 386.45 381.09Q395.31 383.36 406.02 383.36H409.73V405.2H328.13L297.22 373.06Q283.19 387.88 260.94 398.6Q238.69 405.2 207.77 405.2ZM225.49 218.9Q242.39 209.01 250.22 196.86Q258.06 184.69 258.06 165.73Q258.06 150.08 250.64 140.8Q243.22 131.53 228.38 131.53Q213.96 131.53 206.13 140.59Q198.3 149.66 198.3 166.15Q198.3 180.16 205.3 192.32Q212.31 204.47 225.49 218.9ZM219.72 380.88Q239.51 380.88 254.56 372.64Q269.6 364.4 279.07 352.85L192.52 260.53Q178.09 270.83 171.51 285.88Q164.91 300.93 164.91 321.94Q164.91 349.97 179.95 365.43Q194.99 380.88 219.72 380.88Z";

const KEYLINED_TILE =
	'<rect x="15" y="15" width="482" height="482" rx="102" fill="#2B3A55" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="20"/>';

export function brandMarkSvg(opts: { className?: string } = {}): string {
	const decorative = opts.className
		? ` class="${opts.className}" aria-hidden="true" focusable="false"`
		: "";
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${decorative}>${KEYLINED_TILE}<path d="${AMPERSAND_PATH}" fill="#FFFFFF"/><circle cx="353" cy="182" r="44" fill="#C8923C"/></svg>`;
}

export function brandMarkSmallSvg(): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${KEYLINED_TILE}<path d="${SMALL_AMPERSAND_PATH}" fill="#FFFFFF"/></svg>`;
}
