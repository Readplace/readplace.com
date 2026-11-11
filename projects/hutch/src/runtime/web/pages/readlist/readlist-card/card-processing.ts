import {
	type CrawlRemainingEstimate,
	DEFAULT_CRAWL_STAGE,
	crawlProgressPct,
	estimateCrawlRemaining,
	isNonArticleHost,
	type SavedArticle,
} from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { cardKindOf } from "./card-kind-label";
import { type ContentState, contentStateOf } from "./content-state";
import { isCardTerminal } from "./is-card-terminal";

export type CardPhase =
	| { kind: "processing"; pollCursor: number; estimate?: CrawlRemainingEstimate }
	| { kind: "stale" }
	| { kind: "terminal" };

export interface CardProcessing {
	label: string;
	phase: CardPhase;
	contentState: ContentState;
}

function crawlEstimateOf(params: { crawl: ArticleCrawl | undefined; now: Date }): CrawlRemainingEstimate | undefined {
	const { crawl } = params;
	if (crawl?.status !== "pending") return undefined;
	return estimateCrawlRemaining({
		startedAt: crawl.startedAt,
		now: params.now,
		pct: crawlProgressPct({ stage: crawl.stage ?? DEFAULT_CRAWL_STAGE, parts: crawl.parts }),
	});
}

function cardPhaseOf(params: {
	article: SavedArticle;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	now: Date;
	pollCount: number;
	maxPolls: number;
}): CardPhase {
	const { article, crawl, summary, now, pollCount, maxPolls } = params;
	if (isNonArticleHost(article.url) || isCardTerminal(crawl, summary)) return { kind: "terminal" };
	if (pollCount > maxPolls) return { kind: "stale" };
	const estimate = crawlEstimateOf({ crawl, now });
	return estimate === undefined
		? { kind: "processing", pollCursor: pollCount }
		: { kind: "processing", pollCursor: pollCount, estimate };
}

export function cardProcessingOf(params: {
	article: SavedArticle;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
	now: Date;
	pollCount: number;
	maxPolls: number;
}): CardProcessing {
	const cardKind = cardKindOf(params.article);
	return {
		label: cardKind === undefined ? "Processing" : `Preparing your ${cardKind.kind.noun}…`,
		phase: cardPhaseOf(params),
		contentState: contentStateOf({ url: params.article.url, crawl: params.crawl, summary: params.summary }),
	};
}
