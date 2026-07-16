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
	state: "current" | "disabled";
	iso: string;
	mode: LocalTimeMode;
	label: string;
	badgeLabel: "current" | "best" | "";
	ariaDisabled: "true" | "false";
}

export function renderCrawlBookmark(input: { versions: LocalTime[] }): string {
	if (input.versions.length === 0) return "";
	const currentBadge = input.versions.length > 1 ? "best" : "current";
	const tabs: CrawlBookmarkTab[] = input.versions.map((version, index) =>
		index === 0
			? {
					key: "canonical",
					state: "current",
					iso: version.iso,
					mode: version.mode,
					label: version.label,
					badgeLabel: currentBadge,
					ariaDisabled: "false",
				}
			: {
					key: version.iso,
					state: "disabled",
					iso: version.iso,
					mode: version.mode,
					label: version.label,
					badgeLabel: "",
					ariaDisabled: "true",
				},
	);
	return render(CRAWL_BOOKMARK_TEMPLATE, { tabs });
}
