import { isAppUrl } from "./is-app-url";
import type { BulkSaveResult } from "../reading-list/reading-list.types";

/** A saveable tab the popup hands to the background for bulk capture: a real
 * http(s) page that isn't Readplace's own. `tabId` lets the background message
 * the tab's content script to capture its DOM; `title` seeds the page entry. */
export type SaveableTab = { url: string; title: string; tabId?: number };

/** The saveable subset of a window's tabs. Tabs with no URL, non-http(s) schemes
 * (chrome://, about:, file:, moz-extension://) and the app's own pages are
 * dropped here — they are client-side skips the bulk route never sees. Duplicate
 * URLs collapse to the first tab seen (the save is idempotent on userId:url
 * server-side), so two tabs on one URL save, count, and capture once. */
export function selectSaveableTabs(
	tabs: readonly { id?: number; url?: string; title?: string; pendingUrl?: string }[],
	appDomains: readonly string[],
): SaveableTab[] {
	const seen = new Set<string>();
	const saveable: SaveableTab[] = [];
	for (const tab of tabs) {
		const url = tab.url || tab.pendingUrl;
		if (typeof url !== "string") continue;
		if (!/^https?:/i.test(url)) continue;
		if (isAppUrl({ tabUrl: url, appDomains })) continue;
		if (seen.has(url)) continue;
		seen.add(url);
		saveable.push({ url, title: tab.title ?? url, tabId: tab.id });
	}
	return saveable;
}

/** Folds the server's bulk-save summary into the popup's title, summary line and
 * an optional "too big" detail line. The tabs filtered out before the request
 * (clientSkipped = tabCount - saveableCount) never reached the server, so they
 * are added to its skipped count; a Failed segment is appended only when the
 * server reports failures; the too-big line lists pages whose captured content
 * was over the per-page cap and so were saved as links only. */
export function summarizeBulkSave(params: {
	result: BulkSaveResult;
	tabCount: number;
	saveableCount: number;
}): { title: string; summary: string; tooBig: string | null } {
	const clientSkipped = params.tabCount - params.saveableCount;
	const skipped = params.result.skipped + clientSkipped;
	let summary = `Saved ${params.result.saved - params.result.alreadySaved}`;
	if (params.result.alreadySaved > 0) summary += ` · Already in queue ${params.result.alreadySaved}`;
	summary += ` · Skipped ${skipped}`;
	if (params.result.failed > 0) summary += ` · Failed ${params.result.failed}`;
	if (params.result.pendingRetry > 0) summary += ` · Retrying ${params.result.pendingRetry}`;
	const tooBig =
		params.result.tooBig.length > 0
			? `Some pages were too large to capture in full (saved as links): ${params.result.tooBig
					.map((page) => `${page.url} (${page.mb} MB)`)
					.join(", ")}`
			: null;
	return {
		title: params.result.unauthorized ? "Not signed in" : "Tabs saved",
		summary,
		tooBig,
	};
}

const MAX_LISTED_FAILED_URLS = 5;

export function buildFailedUrlLines(failedUrls: readonly { url: string }[]): string[] {
	const lines = failedUrls.slice(0, MAX_LISTED_FAILED_URLS).map((entry) => `Couldn't save ${entry.url}`);
	const overflow = failedUrls.length - MAX_LISTED_FAILED_URLS;
	if (overflow > 0) lines.push(`And ${overflow} more.`);
	return lines;
}

/** Set the instant the popup paints the summary above. The perf suite reads it
 * against the popup document's own navigation start, so one sample spans the
 * whole bulk critical path — enumerating the window, capturing every tab, and
 * every chunked request — and none of the WebDriver round trips spent watching
 * it. A bulk save paints exactly one outcome, so a second mark on a document
 * means the sample was taken against a popup that had already run. */
export const SAVE_ALL_RENDERED_MARK = "save-all-rendered";
