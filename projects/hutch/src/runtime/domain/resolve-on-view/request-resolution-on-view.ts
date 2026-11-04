import { newSaveAttemptId, type ShownSummary, type Viewer } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ArticleCrawl, FindArticleCrawlStatus } from "@packages/provider-contracts/article-crawl";
import type { ClaimResolutionOnView, ResolutionAxes } from "@packages/provider-contracts/article-resolution-on-view";
import type { FindGeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { PublishResolveArticleOnView, ResolveOnViewSurface } from "@packages/provider-contracts/events";
import { type ResolutionOnViewNeed, needsResolutionOnView } from "./needs-resolution-on-view";

export interface ResolvedOnView {
	crawl: ArticleCrawl | undefined;
	summary: ShownSummary | undefined;
}

export type RequestResolutionOnView = (params: {
	surface: ResolveOnViewSurface;
	viewer: Viewer;
	viewerCanCapture: boolean;
	articles: readonly { url: string; crawl: ArticleCrawl | undefined; summary: ShownSummary | undefined }[];
}) => Promise<ReadonlyMap<string, ResolvedOnView>>;

function axesOf(need: ResolutionOnViewNeed): ResolutionAxes[] {
	return need === "crawl-and-summary" || need === "summary" ? [need] : [];
}

export function initRequestResolutionOnView(deps: {
	claimResolutionOnView: ClaimResolutionOnView;
	publishResolveArticleOnView: PublishResolveArticleOnView;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	findGeneratedSummary: FindGeneratedSummary;
	logger: HutchLogger;
}): RequestResolutionOnView {
	const publish = async (params: { url: string; axes: ResolutionAxes; surface: ResolveOnViewSurface }) => {
		try {
			await deps.publishResolveArticleOnView({ ...params, saveAttemptId: newSaveAttemptId() });
		} catch (error) {
			deps.logger.error("[ResolveOnView] publish failed", { url: params.url, axes: params.axes, surface: params.surface, error });
		}
	};

	return async ({ surface, viewer, viewerCanCapture, articles }) => {
		const needs = articles.map((article) => ({ url: article.url, need: needsResolutionOnView({ ...article, viewerCanCapture }) }));
		const eligible = needs.flatMap(({ url, need }) => axesOf(need).map((axes) => ({ url, axes })));
		const outcomes = await Promise.all(
			eligible.map(async ({ url, axes }) => {
				const claim = await deps.claimResolutionOnView({ url, axes, viewer });
				if (claim.kind === "claimed") {
					await publish({ url, axes, surface });
					return { url, claimed: true, state: { crawl: claim.crawl, summary: claim.summary } };
				}
				const [crawl, summary] = await Promise.all([deps.findArticleCrawlStatus(url), deps.findGeneratedSummary({ url, viewer })]);
				return { url, claimed: false, state: { crawl, summary } };
			}),
		);
		const claimed = outcomes.filter((outcome) => outcome.claimed).length;
		deps.logger.info("[ResolveOnView] requested", {
			surface,
			viewerCanCapture,
			seen: articles.length,
			eligible: eligible.length,
			deviceFirst: needs.filter(({ need }) => need === "device-first").length,
			claimed,
			lostRace: outcomes.length - claimed,
		});
		return new Map(outcomes.map(({ url, state }) => [url, state]));
	};
}

export function overlayResolution(
	crawlByUrl: ReadonlyMap<string, ArticleCrawl | undefined>,
	summaryByUrl: ReadonlyMap<string, ShownSummary | undefined>,
	resolved: ReadonlyMap<string, ResolvedOnView>,
): { crawlByUrl: ReadonlyMap<string, ArticleCrawl | undefined>; summaryByUrl: ReadonlyMap<string, ShownSummary | undefined> } {
	const crawls = new Map(crawlByUrl);
	const summaries = new Map(summaryByUrl);
	resolved.forEach((state, url) => {
		crawls.set(url, state.crawl);
		summaries.set(url, state.summary);
	});
	return { crawlByUrl: crawls, summaryByUrl: summaries };
}
