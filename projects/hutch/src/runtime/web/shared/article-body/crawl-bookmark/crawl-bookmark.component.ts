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
 * so a viewer with no removal rights sees no "Me" badges and no remove forms.
 * `authoredMinuteIds` names the version snapshots this viewer authored — matched
 * against each tab's minute id (`LocalTime.iso`) to decide the per-tab controls. */
export interface CrawlBookmarkRemoval {
	authoredMinuteIds: string[];
	removeVersionUrl: string;
}

interface CrawlBookmarkBadge {
	key: "state" | "me";
	label: "Current" | "Best" | "Me";
	className: string;
}

interface CrawlBookmarkTab {
	key: string;
	state: "current" | "disabled";
	iso: string;
	mode: LocalTimeMode;
	label: string;
	badges: CrawlBookmarkBadge[];
	ariaDisabled: "true" | "false";
	removeVersion?: { url: string; minuteId: string };
}

const ME_BADGE: CrawlBookmarkBadge = { key: "me", label: "Me", className: "chip chip--badge" };

export function renderCrawlBookmark(input: {
	versions: LocalTime[];
	removal?: CrawlBookmarkRemoval;
}): string {
	if (input.versions.length === 0) return "";
	const { removal } = input;
	const stateBadge: CrawlBookmarkBadge = {
		key: "state",
		label: input.versions.length > 1 ? "Best" : "Current",
		className: "chip chip--badge chip--accent",
	};
	const tabs: CrawlBookmarkTab[] = input.versions.map((version, index) => {
		const authoredByViewer =
			removal?.authoredMinuteIds.includes(version.iso) ?? false;
		const base: CrawlBookmarkTab = {
			key: index === 0 ? "canonical" : version.iso,
			state: index === 0 ? "current" : "disabled",
			iso: version.iso,
			mode: version.mode,
			label: version.label,
			badges: [...(index === 0 ? [stateBadge] : []), ...(authoredByViewer ? [ME_BADGE] : [])],
			ariaDisabled: index === 0 ? "false" : "true",
		};
		return authoredByViewer && removal !== undefined
			? { ...base, removeVersion: { url: removal.removeVersionUrl, minuteId: version.iso } }
			: base;
	});
	return render(CRAWL_BOOKMARK_TEMPLATE, { tabs });
}
