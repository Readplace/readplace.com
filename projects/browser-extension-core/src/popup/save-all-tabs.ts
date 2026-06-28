import { isAppUrl } from "./is-app-url";
import type { BulkSaveResult } from "../reading-list/reading-list.types";

/** The saveable subset of a window's tabs: real http(s) pages that aren't
 * Readplace's own. Tabs with no URL, non-http(s) schemes (chrome://, about:,
 * file:, moz-extension://) and the app's own pages are dropped here — they are
 * client-side skips the bulk save-articles route never sees. */
export function selectSaveableTabUrls(
	tabs: readonly { url?: string }[],
	appDomains: readonly string[],
): string[] {
	const saveable = tabs
		.map((tab) => tab.url)
		.filter((url): url is string => typeof url === "string")
		.filter((url) => /^https?:/i.test(url))
		.filter((url) => !isAppUrl({ tabUrl: url, appDomains }));
	/** Dedupe: two tabs open on the same URL save once (the save is idempotent on
	 * userId:url server-side), so sending both would only inflate the reported
	 * Saved count and emit a duplicate save-intent for one article. */
	return [...new Set(saveable)];
}

/** Folds the server's bulk-save summary into the popup's title + summary line.
 * The tabs filtered out before the request (clientSkipped = tabCount -
 * saveableCount) never reached the server, so they are added to its skipped
 * count; a Failed segment is appended only when the server reports failures. */
export function summarizeBulkSave(params: {
	result: BulkSaveResult;
	tabCount: number;
	saveableCount: number;
}): { title: string; summary: string } {
	const clientSkipped = params.tabCount - params.saveableCount;
	const skipped = params.result.skipped + clientSkipped;
	let summary = `Saved ${params.result.saved} · Skipped ${skipped}`;
	if (params.result.failed > 0) summary += ` · Failed ${params.result.failed}`;
	return { title: "Tabs saved", summary };
}
