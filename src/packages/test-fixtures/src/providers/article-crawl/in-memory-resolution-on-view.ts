import assert from "node:assert";
import { resolutionOnViewCoolDownCutoff, shownSummary } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
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

const coolingDown = (crawl: ArticleCrawl, now: Date): boolean =>
	crawl.resolutionOnViewClaimedAt !== undefined && crawl.resolutionOnViewClaimedAt >= resolutionOnViewCoolDownCutoff(now);

export function initInMemoryClaimResolutionOnView(deps: {
	crawl: Pick<ReturnType<typeof initInMemoryArticleCrawl>, "crawlStateOf" | "forceMarkCrawlPending" | "resumeMeteredLegs" | "stampResolutionOnViewClaim">;
	summary: Pick<ReturnType<typeof initInMemoryGeneratedSummary>, "summaryStateOf" | "forceMarkSummaryPending">;
	findItemOwner: FindItemOwner;
	now: () => Date;
}): ClaimResolutionOnView {
	return async ({ url, axes, viewer }) => {
		const now = deps.now();
		const crawl = deps.crawl.crawlStateOf(url);
		if (axes === "crawl-and-summary") {
			if (crawl?.status !== "failed" && crawl?.status !== "unsupported") return { kind: "not-eligible" };
			if (coolingDown(crawl, now)) return { kind: "not-eligible" };
			const crawlWrite = deps.crawl.forceMarkCrawlPending({ url });
			deps.summary.forceMarkSummaryPending(url);
			await crawlWrite;
		} else {
			if (crawl?.status !== "ready" || !summaryResumesOnView(deps.summary.summaryStateOf(url))) return { kind: "not-eligible" };
			if (coolingDown(crawl, now)) return { kind: "not-eligible" };
			deps.summary.forceMarkSummaryPending(url);
			deps.crawl.resumeMeteredLegs(url);
		}
		deps.crawl.stampResolutionOnViewClaim({ url, claimedAt: now.toISOString() });
		const claimedCrawl = deps.crawl.crawlStateOf(url);
		assert(claimedCrawl, "a claimed resolution-on-view row must carry a crawl state");
		return {
			kind: "claimed",
			crawl: claimedCrawl,
			summary: shownSummary({ url, summary: deps.summary.summaryStateOf(url), viewer, ownerUserId: await deps.findItemOwner(url) }),
		};
	};
}
