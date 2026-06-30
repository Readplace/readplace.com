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
