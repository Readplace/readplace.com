/**
 * The Readplace mark as one self-contained inline SVG: navy tile, white
 * ampersand, amber dot. The white keyline (`stroke` + `stroke-opacity`) is
 * load-bearing, not decoration — it alpha-composites against whatever sits
 * behind the mark, keeping the navy tile visible on dark/navy surfaces (blog
 * header, extension popup, navy hero, favicon tab strip) that a CSS layer can't
 * reach. Do not remove it or change the navy fill; both are guarded by tests.
 *
 * `className` present ⇒ the mark is inline site chrome sitting next to the
 * wordmark, so it is emitted decorative (aria-hidden). Absent ⇒ a standalone
 * asset (icon.svg, favicon) referenced as an image.
 */
export function brandMarkSvg(opts: { fontFamily: string; className?: string }): string {
	const decorative = opts.className
		? ` class="${opts.className}" aria-hidden="true" focusable="false"`
		: "";
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${decorative}><rect x="15" y="15" width="482" height="482" rx="102" fill="#2B3A55" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="20"/><text x="240" y="400" text-anchor="middle" font-family="${opts.fontFamily}" font-size="368" font-weight="700" fill="#FFFFFF">&amp;</text><circle cx="331" cy="166" r="44" fill="#C8923C"/></svg>`;
}
