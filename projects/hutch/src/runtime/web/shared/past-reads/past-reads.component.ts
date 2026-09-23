import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { PastReads } from "@packages/provider-contracts/related-articles";
import { render, toRelativePhrase, withInternalTracking } from "@packages/web-shell";
import type { LocalTime } from "@packages/web-shell/local-time.format";

const PAST_READS_TEMPLATE = readFileSync(
	join(__dirname, "past-reads.template.html"),
	"utf-8",
);

const READY_CLASS = "past-reads--ready";
const HIDDEN_CLASS = "past-reads--hidden";

/** The internal-click `utm_content` for a topic-read row, distinct from the
 * end-of-article Next-read card so the dashboard can tell the two surfaces
 * apart. */
const TOPIC_READ_CLICK_CONTENT = "topic-read";

export interface PastReadsSectionInput {
	/** The independent past-reads selection for the current article; `undefined`
	 * is treated as pending (the owner reader always supplies it). */
	pastReads?: PastReads;
	/** Present only while the result is still pending, so the section polls until
	 * it settles and then stops. */
	pollUrl?: string;
	/** POST endpoint that requests (re)computation. Owner reader only. */
	computeUrl?: string;
	sourceArticleId: string;
	/** Anchors the relative "last read" phrase, exactly as Next read anchors its
	 * saved/read line. */
	now: Date;
	readerPathForReadlist: (articleId: string, readlist?: ReadlistSlug) => string;
}

interface PastReadRow {
	id: string;
	href: string;
	title: string;
	siteName: string;
	reason: string;
	accessibleLabel: string;
	/** Mirrors Next read's dated line; absent for a match whose read row carries
	 * no timestamp, so the row omits it rather than inventing one. */
	readDated?: { lead: string; time: LocalTime };
}

function readDatedOf(
	readAt: Date | undefined,
	now: Date,
): { lead: string; time: LocalTime } | undefined {
	if (readAt === undefined) return undefined;
	return { lead: "You read this", time: toRelativePhrase({ iso: readAt.toISOString(), now }) };
}

function rowsOf(input: PastReadsSectionInput): PastReadRow[] {
	const pastReads = input.pastReads;
	if (pastReads?.status !== "ready") return [];
	return pastReads.items.map((item) => {
		const readDated = readDatedOf(item.readAt, input.now);
		return {
			id: item.id.value,
			href: withInternalTracking(
				input.readerPathForReadlist(item.id.value, item.readlist),
				{
					source: "reader",
					content: TOPIC_READ_CLICK_CONTENT,
					term: input.sourceArticleId,
				},
			),
			title: item.title,
			siteName: item.siteName,
			reason: item.reason,
			accessibleLabel: `${item.title} — ${item.siteName}`,
			...(readDated !== undefined ? { readDated } : {}),
		};
	});
}

interface PastReadsPreview {
	title: string;
	siteName: string;
}

function previewOf(rows: PastReadRow[]): PastReadsPreview | undefined {
	const first = rows.at(0);
	return first === undefined ? undefined : { title: first.title, siteName: first.siteName };
}

export function renderPastReadsSection(input: PastReadsSectionInput): string {
	const rows = rowsOf(input);
	const status = input.pastReads?.status ?? "pending";
	const hasRows = rows.length > 0;
	return render(PAST_READS_TEMPLATE, {
		status,
		stateClass: hasRows ? READY_CLASS : HIDDEN_CLASS,
		preview: previewOf(rows),
		rows,
		pollUrl: status === "pending" ? input.pollUrl : undefined,
		computeUrl: input.computeUrl,
		sourceArticleId: input.sourceArticleId,
		// The no-JS fallback only appears when there is nothing to show, so a
		// reader with results never sees a stray "find" button beneath them.
		showNoscriptFallback: input.computeUrl !== undefined && !hasRows,
	});
}
