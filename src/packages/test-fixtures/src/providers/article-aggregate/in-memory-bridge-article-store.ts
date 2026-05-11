import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	AggregateConcurrencyError,
	type Article,
	type ArticleStore,
	type CrawlState,
	type Minutes,
	type SummaryState,
} from "@packages/domain/article";
import type { FindArticleByUrl } from "../article-store/article-store.types";
import type { ArticleMetadata } from "@packages/domain/article";

/**
 * Read-side projections the bridge calls. Independent of the writer side so
 * the test app can pass each provider its own fixture instance.
 */
export interface BridgeReaders {
	findArticleByUrl: FindArticleByUrl;
	findArticleCrawlStatus: (
		url: string,
	) => Promise<
		| { status: "pending"; stage?: string }
		| { status: "ready" }
		| { status: "failed"; reason: string }
		| { status: "unsupported"; reason: string }
		| undefined
	>;
	findGeneratedSummary: (
		url: string,
	) => Promise<
		| { status: "pending"; stage?: string }
		| { status: "ready"; summary: string; excerpt?: string }
		| { status: "failed"; reason: string }
		| { status: "skipped"; reason?: string }
		| undefined
	>;
}

/**
 * Write-side delegates. The bridge calls these when the aggregate's save
 * needs to update each substate. Writers for `summary=ready/failed/skipped`
 * are optional — a test fixture only needs to provide them when it uses
 * the bridge against a transition that can produce those summary states.
 * Phase-1's /admin/recrawl path only produces `summary=pending`, so the
 * default test app omits the rest; Phase-2 DLQ handlers will set them.
 */
export interface BridgeWriters {
	forceMarkCrawlPending: (params: { url: string }) => Promise<void>;
	markCrawlReady: (params: { url: string }) => Promise<void>;
	markCrawlFailed: (params: {
		url: string;
		reason: string;
	}) => Promise<void>;
	markCrawlUnsupported: (params: {
		url: string;
		reason: string;
	}) => Promise<void>;
	forceMarkSummaryPending: (params: { url: string }) => Promise<void>;
	markSummaryReady?: (params: {
		url: string;
		summary: string;
		excerpt: string;
	}) => void;
	markSummaryFailed?: (params: { url: string; reason: string }) => Promise<void>;
	markSummarySkipped?: (params: {
		url: string;
		reason?: string;
	}) => Promise<void>;
	writeMetadata: (params: {
		url: string;
		metadata: ArticleMetadata;
		estimatedReadTime: Minutes;
	}) => Promise<void>;
}

export interface AggregateBridgeStore extends ArticleStore {
	/**
	 * Returns the current bridge-tracked version for a URL. Tests can assert
	 * the version bumped after a save without reaching into private state.
	 */
	peekVersion: (url: string) => number;
}

/**
 * In-memory aggregate adapter that delegates to the existing per-state
 * test-fixture providers (`articleStore`, `articleCrawl`, `summary`). This
 * is the bridge that lets `/admin/recrawl` and other aggregate-callers run
 * in the test app while existing route tests keep asserting against the
 * legacy fixture methods (e.g. `harness.summary.findGeneratedSummary(...)`
 * still returns the correct projection because the bridge wrote to it).
 *
 * Version tracking lives in the bridge alone — the underlying legacy
 * fixtures don't model version. This is sufficient for test scenarios
 * because the test app is single-writer per invocation; production uses
 * `initDynamoDbArticleStore` which has real row-level CAS on disk.
 */
export function initBridgeArticleStore(deps: {
	readers: BridgeReaders;
	writers: BridgeWriters;
}): AggregateBridgeStore {
	const versions = new Map<string, number>();

	function canonical(url: string): string {
		return ArticleResourceUniqueId.parse(url).value;
	}

	async function load(url: string): Promise<Article | undefined> {
		const article = await deps.readers.findArticleByUrl(url);
		if (!article) return undefined;
		const crawlProjection = await deps.readers.findArticleCrawlStatus(url);
		const summaryProjection = await deps.readers.findGeneratedSummary(url);

		const crawl: CrawlState = crawlProjection
			? toCrawl(crawlProjection)
			: { status: "pending" };
		const summary: SummaryState = summaryProjection
			? toSummary(summaryProjection)
			: { status: "pending" };

		return {
			url: article.url,
			version: versions.get(canonical(article.url)) ?? 0,
			crawl,
			summary,
			metadata: article.metadata,
			estimatedReadTime: article.estimatedReadTime,
		};
	}

	async function save(params: {
		article: Article;
		expectedVersion: number;
	}): Promise<void> {
		const key = canonical(params.article.url);
		const onDisk = versions.get(key) ?? 0;
		if (onDisk !== params.expectedVersion) {
			throw new AggregateConcurrencyError({
				url: params.article.url,
				expectedVersion: params.expectedVersion,
			});
		}
		await writeCrawl(deps.writers, params.article);
		await writeSummary(deps.writers, params.article);
		await deps.writers.writeMetadata({
			url: params.article.url,
			metadata: params.article.metadata,
			estimatedReadTime: params.article.estimatedReadTime,
		});
		versions.set(key, params.expectedVersion + 1);
	}

	return {
		load,
		save,
		peekVersion: (url) => versions.get(canonical(url)) ?? 0,
	};
}

function toCrawl(
	projection: NonNullable<
		Awaited<ReturnType<BridgeReaders["findArticleCrawlStatus"]>>
	>,
): CrawlState {
	if (projection.status === "failed") {
		return {
			status: "failed",
			reason: projection.reason,
			failedAt: "",
		};
	}
	if (projection.status === "unsupported") {
		return {
			status: "unsupported",
			reason: projection.reason,
			failedAt: "",
		};
	}
	if (projection.status === "ready") return { status: "ready" };
	return { status: "pending" };
}

function toSummary(
	projection: NonNullable<
		Awaited<ReturnType<BridgeReaders["findGeneratedSummary"]>>
	>,
): SummaryState {
	if (projection.status === "failed") {
		return { status: "failed", reason: projection.reason };
	}
	if (projection.status === "skipped") {
		return projection.reason
			? { status: "skipped", reason: projection.reason }
			: { status: "skipped" };
	}
	if (projection.status === "ready") {
		// The legacy summary fixture doesn't track inputTokens/outputTokens;
		// project them as zero. Aggregate transitions for /admin/recrawl
		// only RESET the summary (never produce a ready state), so the
		// missing counts only surface on read and never round-trip back
		// through the writer side in the test scenarios that use this bridge.
		const ready: SummaryState = {
			status: "ready",
			summary: projection.summary,
			inputTokens: 0,
			outputTokens: 0,
		};
		if (projection.excerpt) ready.excerpt = projection.excerpt;
		return ready;
	}
	return { status: "pending" };
}

async function writeCrawl(
	writers: BridgeWriters,
	article: Article,
): Promise<void> {
	if (article.crawl.status === "pending") {
		await writers.forceMarkCrawlPending({ url: article.url });
		return;
	}
	if (article.crawl.status === "ready") {
		await writers.markCrawlReady({ url: article.url });
		return;
	}
	if (article.crawl.status === "failed") {
		await writers.markCrawlFailed({
			url: article.url,
			reason: article.crawl.reason,
		});
		return;
	}
	await writers.markCrawlUnsupported({
		url: article.url,
		reason: article.crawl.reason,
	});
}

async function writeSummary(
	writers: BridgeWriters,
	article: Article,
): Promise<void> {
	if (article.summary.status === "pending") {
		await writers.forceMarkSummaryPending({ url: article.url });
		return;
	}
	if (article.summary.status === "ready") {
		assert(
			writers.markSummaryReady,
			"bridge: markSummaryReady writer required when transition produces summary=ready",
		);
		writers.markSummaryReady({
			url: article.url,
			summary: article.summary.summary,
			excerpt: article.summary.excerpt ?? "",
		});
		return;
	}
	if (article.summary.status === "failed") {
		assert(
			writers.markSummaryFailed,
			"bridge: markSummaryFailed writer required when transition produces summary=failed",
		);
		await writers.markSummaryFailed({
			url: article.url,
			reason: article.summary.reason,
		});
		return;
	}
	assert(
		writers.markSummarySkipped,
		"bridge: markSummarySkipped writer required when transition produces summary=skipped",
	);
	await writers.markSummarySkipped({
		url: article.url,
		reason: article.summary.reason,
	});
}
