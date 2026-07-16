import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { LocalTime, LocalTimeMode } from "@packages/web-shell/local-time.format";

const CRAWL_BOOKMARK_TEMPLATE = readFileSync(
	join(__dirname, "crawl-bookmark.template.html"),
	"utf-8",
);

export const CRAWL_BOOKMARK_SCRIPT = `<script src="/client-dist/crawl-bookmark.client.js" defer></script>`;

/** Owner-only removal controls for the reader bookmark. Present only on the
 * authenticated owner reader (never the public `/view` or the iOS WKWebView),
 * so a viewer with no removal rights sees no "me" badges and no remove forms.
 * `authoredMinuteIds` names the version snapshots this viewer authored — matched
 * against each tab's minute id (`LocalTime.iso`) to decide the per-tab controls. */
export interface CrawlBookmarkRemoval {
	authoredMinuteIds: string[];
	removeVersionUrl: string;
	removeCopyUrl: string;
}

interface CrawlBookmarkTab {
	key: string;
	state: "current" | "disabled";
	iso: string;
	mode: LocalTimeMode;
	label: string;
	badgeLabel: "current" | "best" | "";
	ariaDisabled: "true" | "false";
	authoredByViewer: boolean;
	removeVersion?: { url: string; minuteId: string };
}

export function renderCrawlBookmark(input: {
	versions: LocalTime[];
	removal?: CrawlBookmarkRemoval;
}): string {
	if (input.versions.length === 0) return "";
	const { removal } = input;
	const newestBadge = input.versions.length > 1 ? "best" : "current";
	const tabs: CrawlBookmarkTab[] = input.versions.map((version, index) => {
		const authoredByViewer =
			removal?.authoredMinuteIds.includes(version.iso) ?? false;
		const base: CrawlBookmarkTab = {
			key: index === 0 ? "canonical" : version.iso,
			state: index === 0 ? "current" : "disabled",
			iso: version.iso,
			mode: version.mode,
			label: version.label,
			badgeLabel: index === 0 ? newestBadge : "",
			ariaDisabled: index === 0 ? "false" : "true",
			authoredByViewer,
		};
		return authoredByViewer && removal !== undefined
			? { ...base, removeVersion: { url: removal.removeVersionUrl, minuteId: version.iso } }
			: base;
	});
	const removeCopy =
		removal !== undefined && tabs.some((tab) => tab.authoredByViewer)
			? { url: removal.removeCopyUrl }
			: undefined;
	return render(CRAWL_BOOKMARK_TEMPLATE, { tabs, removeCopy });
}
