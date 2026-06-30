import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { LocalTime, LocalTimeMode } from "@packages/web-shell/local-time.format";

const CRAWL_BOOKMARK_TEMPLATE = readFileSync(
	join(__dirname, "crawl-bookmark.template.html"),
	"utf-8",
);

export const CRAWL_BOOKMARK_SCRIPT = `<script src="/client-dist/crawl-bookmark.client.js" defer></script>`;

interface CrawlBookmarkTab {
	key: string;
	state: "selected";
	ariaSelected: "true";
	prefix: string;
	iso: string;
	mode: LocalTimeMode;
	label: string;
}

/**
 * Renders the "Last crawled at …" bookmark, or "" before the first crawl
 * completes (no `lastCrawledAt` yet → no tab). Only the instant sits inside the
 * `<time>` so the local-time client localises just the date; "Last crawled at"
 * stays static text.
 */
export function renderCrawlBookmark(input: { lastCrawledAt?: LocalTime }): string {
	if (!input.lastCrawledAt) return "";
	const tabs: CrawlBookmarkTab[] = [
		{
			key: "canonical",
			state: "selected",
			ariaSelected: "true",
			prefix: "Last crawled at",
			iso: input.lastCrawledAt.iso,
			mode: input.lastCrawledAt.mode,
			label: input.lastCrawledAt.label,
		},
	];
	return render(CRAWL_BOOKMARK_TEMPLATE, { tabs });
}
