import type { TierName } from "@packages/hutch-infra-components";

export type PickedTier = TierName | "none";
export type CrawlStatus = "ready" | "failed" | "pending" | "absent";
export type TierStatus = "success" | "failed" | "not_attempted";

export type TierSnapshot = {
	tier0Status: TierStatus;
	tier1Status: TierStatus;
	pickedTier: PickedTier;
};

export type ReadTierSnapshot = (params: { url: string }) => Promise<TierSnapshot>;

export type CheckTier0SourceExists = (params: { url: string }) => Promise<boolean>;
export type ReadArticleCrawlState = (params: { url: string }) => Promise<{
	crawlStatus: CrawlStatus;
	canonicalSourceTier: PickedTier;
}>;

/** Tier 0's failure path leaves no DynamoDB or S3 marker (the worker throws before
 * `putSourceContent`), so the snapshot can only distinguish "captured" from "not captured".
 * Tier 1 owns `crawlStatus`, which carries an explicit `failed` terminal — the snapshot
 * surfaces that distinction so the dashboard's `otherTierStatus` is accurate when one
 * tier reports a failure while the other has already failed. */
function tier1StatusFromCrawlStatus(crawlStatus: CrawlStatus): TierStatus {
	if (crawlStatus === "ready") return "success";
	if (crawlStatus === "failed") return "failed";
	return "not_attempted";
}

export function initReadTierSnapshot(deps: {
	checkTier0SourceExists: CheckTier0SourceExists;
	readArticleCrawlState: ReadArticleCrawlState;
}): { readTierSnapshot: ReadTierSnapshot } {
	const readTierSnapshot: ReadTierSnapshot = async ({ url }) => {
		const [tier0SourceExists, state] = await Promise.all([
			deps.checkTier0SourceExists({ url }),
			deps.readArticleCrawlState({ url }),
		]);
		return {
			tier0Status: tier0SourceExists ? "success" : "not_attempted",
			tier1Status: tier1StatusFromCrawlStatus(state.crawlStatus),
			pickedTier: state.canonicalSourceTier,
		};
	};
	return { readTierSnapshot };
}
