/** The client bundle that slides the nav up out of view on scroll-down and back
 * on scroll-up (reader-nav.client.ts). Injected per page — see {@link ReaderScripts}. */
export const NAV_HIDE_SCRIPT =
	`<script src="/client-dist/reader-nav.client.js" defer></script>` as const;

/** Opt a reader view out of nav-hide while still satisfying the required `navHide`
 * dependency below — pass this instead of dropping the field. */
export const NAV_HIDE_DISABLED = "" as const;

/** Every reader view (public `/view`, owner `/queue/:id/view`, admin recrawl)
 * assembles its page scripts through this shared shape. `navHide` is required, so
 * a new reader must choose {@link NAV_HIDE_SCRIPT} (slide the nav away on scroll)
 * or {@link NAV_HIDE_DISABLED} (keep it static) rather than silently shipping a
 * static nav by forgetting the script. */
export interface ReaderScripts {
	readonly navHide: typeof NAV_HIDE_SCRIPT | typeof NAV_HIDE_DISABLED;
	readonly page: string;
}

export function readerScripts({ navHide, page }: ReaderScripts): string {
	return navHide + page;
}
