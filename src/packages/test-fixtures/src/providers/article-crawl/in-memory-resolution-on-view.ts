import assert from "node:assert";
import { shownSummary } from "@packages/domain/article";
import type { FindItemOwner } from "@packages/provider-contracts/article-store";
import type { ClaimResolutionOnView } from "@packages/provider-contracts/article-resolution-on-view";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { initInMemoryGeneratedSummary } from "../article-summary/in-memory-generated-summary";
import type { initInMemoryArticleCrawl } from "./in-memory-article-crawl";

const SUMMARY_SKIPS_A_VIEW_RESUMES: readonly (string | undefined)[] = ["awaiting-reader", "ai-unavailable"];

function summaryResumesOnView(summary: GeneratedSummary | undefined): boolean {
	if (summary?.status === "failed") return true;
	return summary?.status === "skipped" && SUMMARY_SKIPS_A_VIEW_RESUMES.includes(summary.reason);
}

export function initInMemoryClaimResolutionOnView(deps: {
	crawl: Pick<ReturnType<typeof initInMemoryArticleCrawl>, "crawlStateOf" | "forceMarkCrawlPending" | "resumeMeteredLegs">;
	summary: Pick<ReturnType<typeof initInMemoryGeneratedSummary>, "summaryStateOf" | "forceMarkSummaryPending">;
	findItemOwner: FindItemOwner;
}): ClaimResolutionOnView {
	return async ({ url, axes, viewer }) => {
		const crawl = deps.crawl.crawlStateOf(url);
		if (axes === "crawl-and-summary") {
			if (crawl?.status !== "failed" && crawl?.status !== "unsupported") return { kind: "not-eligible" };
			const crawlWrite = deps.crawl.forceMarkCrawlPending({ url });
			deps.summary.forceMarkSummaryPending(url);
			await crawlWrite;
		} else {
			if (crawl?.status !== "ready" || !summaryResumesOnView(deps.summary.summaryStateOf(url))) return { kind: "not-eligible" };
			deps.summary.forceMarkSummaryPending(url);
			deps.crawl.resumeMeteredLegs(url);
		}
		const claimedCrawl = deps.crawl.crawlStateOf(url);
		assert(claimedCrawl, "a claimed resolution-on-view row must carry a crawl state");
		return {
			kind: "claimed",
			crawl: claimedCrawl,
			summary: shownSummary({ url, summary: deps.summary.summaryStateOf(url), viewer, ownerUserId: await deps.findItemOwner(url) }),
		};
	};
}
