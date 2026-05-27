import type {
	Article,
	ArticleFreshness,
	ArticleMetadata,
} from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";

export interface RefreshContentInput {
	metadata: ArticleMetadata;
	freshness: ArticleFreshness;
	estimatedReadTime: number;
	now: string;
	/** Hash of the new canonical readable text. Compared against the row's
	 * existing `freshness.canonicalContentHash` to gate summary regeneration. */
	canonicalContentHash: string;
}

/* `writes` excludes "crawl" by default — a concurrent inline crawl writer
 * must not be clobbered by the refresh aggregate save when the crawl is
 * still in flight. The summary axis is only written + regenerated when the
 * canonical content hash actually changed (lazy backfill: a row without a
 * prior hash is treated as changed).
 *
 * Exception: when the existing crawl is in the terminal "failed" state, the
 * refresh has just delivered fresh content that proves the row is recoverable.
 * Promote crawl to "ready" so the /view route stops rendering the failed UI.
 * A failed row has no in-flight writer to race with, so this write is safe. */
export function refreshContent(
	article: Article,
	input: RefreshContentInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	const previousHash = article.freshness.canonicalContentHash;
	const contentChanged =
		previousHash === undefined || previousHash !== input.canonicalContentHash;

	const nextFreshness: Article["freshness"] = {
		...input.freshness,
		canonicalContentHash: input.canonicalContentHash,
	};

	const writes: AggregateField[] = ["metadata", "freshness"];
	const effects: Effect[] = [];

	let nextSummary: Article["summary"];
	if (contentChanged) {
		nextSummary = { kind: "pending", pendingSince: input.now };
		writes.push("summary");
		effects.push({ kind: "generate-summary", url: article.url });
	} else {
		nextSummary = article.summary;
	}

	let nextCrawl: Article["crawl"] = article.crawl;
	if (article.crawl.kind === "failed") {
		nextCrawl = { kind: "ready" };
		writes.push("crawl");
	}

	const next: Article = {
		...article,
		metadata: input.metadata,
		freshness: nextFreshness,
		estimatedReadTime: input.estimatedReadTime,
		summary: nextSummary,
		crawl: nextCrawl,
	};

	return { article: next, effects, writes };
}
