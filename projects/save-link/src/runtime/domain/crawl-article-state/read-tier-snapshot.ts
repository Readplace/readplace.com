import type { TierName } from "@packages/hutch-infra-components";
import type { CrawlStatus as PersistedCrawlStatus } from "@packages/article-state-types";

export type PickedTier = TierName | "none";
export type CrawlStatus = PersistedCrawlStatus | "absent";
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
	return TIER_1_STATUSES[crawlStatus];
}

const TIER_1_STATUSES = {
	ready: "success",
	failed: "failed",
	pending: "not_attempted",
	unsupported: "not_attempted",
	absent: "not_attempted",
} satisfies Record<CrawlStatus, TierStatus>;

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
