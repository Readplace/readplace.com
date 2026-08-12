import { isAppUrl } from "./is-app-url";
import type { BulkSaveResult } from "../reading-list/reading-list.types";

/** A saveable tab the popup hands to the background for bulk capture: a real
 * http(s) page that isn't Readplace's own. `tabId` lets the background message
 * the tab's content script to capture its DOM; `title` seeds the page entry. */
export type SaveableTab = { url: string; title: string; tabId?: number };

/** Mirrors the server's unsupported_scheme wording so a chrome:// tab dropped
 * here and one the server refused collapse into one reason bullet. */
const SKIP_REASON_NOT_A_WEB_PAGE = "Only http and https URLs can be saved";
const SKIP_REASON_APP_PAGE = "Readplace's own pages aren't saved";
const SKIP_REASON_DUPLICATE = "Already open in another tab";

/** The saveable subset of a window's tabs, with a deduplicated first-seen list
 * of why the rest were left behind. Tabs with no URL, non-http(s) schemes
 * (chrome://, about:, file:, moz-extension://) and the app's own pages are
 * dropped here — they are client-side skips the bulk route never sees. Duplicate
 * URLs collapse to the first tab seen (the save is idempotent on userId:url
 * server-side), so two tabs on one URL save, count, and capture once. */
export function classifyTabs(
	tabs: readonly { id?: number; url?: string; title?: string; pendingUrl?: string }[],
	appDomains: readonly string[],
): { saveable: SaveableTab[]; skipReasons: string[] } {
	const seen = new Set<string>();
	const saveable: SaveableTab[] = [];
	const skipReasons = new Set<string>();
	for (const tab of tabs) {
		const url = tab.url || tab.pendingUrl;
		if (typeof url !== "string" || !/^https?:/i.test(url)) {
			skipReasons.add(SKIP_REASON_NOT_A_WEB_PAGE);
			continue;
		}
		if (isAppUrl({ tabUrl: url, appDomains })) {
			skipReasons.add(SKIP_REASON_APP_PAGE);
			continue;
		}
		if (seen.has(url)) {
			skipReasons.add(SKIP_REASON_DUPLICATE);
			continue;
		}
		seen.add(url);
		saveable.push({ url, title: tab.title ?? url, tabId: tab.id });
	}
	return { saveable, skipReasons: [...skipReasons] };
}

export function saveAllTabsLabel(tabCount: number): string {
	return `Save ${tabCount} ${tabCount === 1 ? "tab" : "tabs"}`;
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
const MAX_LISTED_SKIP_REASONS = 5;

/** Failures stay per-URL so the reader knows which tabs to retry; skips
 * collapse to their distinct reasons, because a skipped tab isn't coming back
 * and the only actionable fact is why its kind was left behind. */
export function buildSaveAllDetailLines(result: {
	failedUrls: readonly { url: string }[];
	skippedUrls: readonly { url: string; code: string; message?: string }[];
	clientSkipReasons: readonly string[];
}): string[] {
	const failedLines = result.failedUrls.map((entry) => `Couldn't save ${entry.url}`);
	const lines = failedLines.slice(0, MAX_LISTED_FAILED_URLS);
	const moreFailed = failedLines.length - lines.length;
	if (moreFailed > 0) lines.push(`And ${moreFailed} more failed.`);

	const reasons = new Set<string>(result.clientSkipReasons);
	for (const entry of result.skippedUrls) {
		if (entry.message !== undefined) reasons.add(entry.message);
	}
	lines.push(...[...reasons].slice(0, MAX_LISTED_SKIP_REASONS).map((reason) => `• ${reason}`));
	if (reasons.size > MAX_LISTED_SKIP_REASONS) lines.push("… and others");
	return lines;
}

/** Set the instant the popup paints the summary above. The perf suite reads it
 * against the popup document's own navigation start, so one sample spans the
 * whole bulk critical path — enumerating the window, capturing every tab, and
 * every chunked request — and none of the WebDriver round trips spent watching
 * it. A bulk save paints exactly one outcome, so a second mark on a document
 * means the sample was taken against a popup that had already run. */
export const SAVE_ALL_RENDERED_MARK = "save-all-rendered";
