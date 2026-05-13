import { calculateReadTime } from "../../article/estimated-read-time";
import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface SubmitLinkInput {
	url: string;
	userId?: string;
	rawHtml?: string;
	now: string;
}

/**
 * Entry-point transition for save / view / extension flows.
 *
 * - First save: synthesises a hostname-only pending stub so the queue card has
 *   metadata to render before the worker fetches the real content.
 * - Repeat save while a crawl is already in flight: idempotent no-op on the
 *   row, but still re-dispatches the SubmitLinkCommand so a stuck pending
 *   gets re-triggered.
 * - Repeat save on a terminal row (ready / failed / unsupported): leaves the
 *   axes alone (operators use requestRecrawl to flip a terminal row back to
 *   pending) and just re-dispatches.
 */
export function submitLink(
	article: Article | undefined,
	input: SubmitLinkInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const effects: readonly Effect[] = [
		{
			kind: "dispatch-submit-link",
			url: input.url,
			userId: input.userId,
			rawHtml: input.rawHtml,
		},
	];

	if (article === undefined) {
		const next = synthesiseStub(input);
		const writes: readonly AggregateField[] = [
			"metadata",
			"freshness",
			"crawl",
			"summary",
		];
		return { article: next, effects, writes };
	}

	if (article.crawl.kind === "pending") {
		return { article, effects, writes: [] };
	}

	return { article, effects, writes: [] };
}

function synthesiseStub(input: SubmitLinkInput): Article {
	const hostname = new URL(input.url).hostname;
	return {
		url: input.url,
		metadata: {
			title: `Article from ${hostname}`,
			siteName: hostname,
			excerpt: `Saved from ${hostname}.`,
			wordCount: 0,
		},
		freshness: { contentFetchedAt: input.now },
		estimatedReadTime: calculateReadTime(0),
		crawl: { kind: "pending", pendingSince: input.now },
		summary: { kind: "pending", pendingSince: input.now },
		summaryAutoHeal: { attempts: 0 },
	};
}
