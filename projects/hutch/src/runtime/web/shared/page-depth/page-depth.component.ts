import { PAGE_DEPTH_EVENT_PATH } from "./page-depth-tracking";

export const PAGE_DEPTH_SCRIPT = `<script src="/client-dist/page-depth.client.js" defer></script>`;

/**
 * The marker the client reads its beacon URL off. Rendering it is what opts a
 * page into depth reporting, so a page that does not want measuring simply does
 * not emit it.
 */
export function renderPageDepthBeacon(): string {
	return `<div hidden data-page-depth-beacon="${PAGE_DEPTH_EVENT_PATH}"></div>`;
}
