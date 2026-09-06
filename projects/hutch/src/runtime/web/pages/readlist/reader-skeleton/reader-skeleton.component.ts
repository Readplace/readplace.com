import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { CspNonce } from "@packages/web-shell";
import { ARTICLE_FRAME_STYLES } from "../../../shared/article-body/article-frame.styles";
import { CRAWL_BOOKMARK_SCRIPT } from "../../../shared/article-body/crawl-bookmark/crawl-bookmark.component";
import { PROGRESS_BAR_SCRIPT } from "../../../shared/article-body/progress-bar.component";
import { READLIST_PICKER_SCRIPT } from "../../../shared/article-body/reader-actions/reader-actions.component";
import { SUMMARY_TOGGLE_SCRIPT } from "../../../shared/article-body/summary-slot/summary-slot.component";
import { NEXT_READ_SCRIPT } from "../../../shared/next-read/next-read.component";
import { SHARE_BALLOON_SCRIPT } from "../../../shared/share-balloon/share-balloon.component";
import { READER_OPEN_SCRIPT } from "../../../shared/reader-open/reader-open-script";
import { READER_EXIT_CONFIRM_SCRIPT } from "../../reader/reader-exit-confirm.component";
import { READER_ONLY_STYLES } from "../../reader/reader.styles";

const TEMPLATE = readFileSync(join(__dirname, "reader-skeleton.template.html"), "utf-8");
const SKELETON_ONLY_STYLES = readFileSync(join(__dirname, "reader-skeleton.styles.css"), "utf-8");

const SKELETON_STYLES = ARTICLE_FRAME_STYLES + READER_ONLY_STYLES + SKELETON_ONLY_STYLES;

export const VIEW_BACK_LINK = {
	topHref: "/queue?utm_source=reader&utm_medium=internal&utm_content=back-top",
	label: "Back to readlist",
} as const;

export const READER_PAGE_SCRIPTS =
	SHARE_BALLOON_SCRIPT +
	NEXT_READ_SCRIPT +
	PROGRESS_BAR_SCRIPT +
	SUMMARY_TOGGLE_SCRIPT +
	CRAWL_BOOKMARK_SCRIPT +
	READLIST_PICKER_SCRIPT +
	READER_EXIT_CONFIRM_SCRIPT +
	READER_OPEN_SCRIPT;

export function renderReaderSkeleton(options: { cspNonce: CspNonce }): string {
	return render(TEMPLATE, {
		cspNonce: options.cspNonce,
		styles: SKELETON_STYLES,
		backHref: VIEW_BACK_LINK.topHref,
		backLabel: VIEW_BACK_LINK.label,
	});
}
