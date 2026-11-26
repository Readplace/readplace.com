import { READER_IMAGE_BOXES_SCRIPT } from "./article-body/reader-slot/reader-slot.component";

/** The client bundle that slides the nav up out of view on scroll-down and back
 * on scroll-up (reader-nav.client.ts). */
export const NAV_HIDE_SCRIPT =
	`<script src="/client-dist/reader-nav.client.js" defer></script>` as const;

export function readerScripts(page: string): string {
	return READER_IMAGE_BOXES_SCRIPT + page;
}
