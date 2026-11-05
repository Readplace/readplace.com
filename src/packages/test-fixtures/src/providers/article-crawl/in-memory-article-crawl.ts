import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
	ForceMarkCrawlPending,
	InMemoryMarkCrawlFailed,
	InMemoryMarkCrawlReady,
	InMemoryMarkCrawlStage,
	InMemoryMarkCrawlUnsupported,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";

export type {
	InMemoryMarkCrawlFailed,
	InMemoryMarkCrawlReady,
	InMemoryMarkCrawlStage,
	InMemoryMarkCrawlUnsupported,
};

export function initInMemoryArticleCrawl(): {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	forceMarkCrawlPending: ForceMarkCrawlPending;
	markCrawlReady: InMemoryMarkCrawlReady;
	markCrawlFailed: InMemoryMarkCrawlFailed;
	markCrawlUnsupported: InMemoryMarkCrawlUnsupported;
	markCrawlStage: InMemoryMarkCrawlStage;
	isMeteredLegsDeferred: (url: string) => boolean;
	crawlStateOf: (url: string) => ArticleCrawl | undefined;
	resumeMeteredLegs: (url: string) => void;
	stampResolutionOnViewClaim: (params: { url: string; claimedAt: string }) => void;
} {
	const states = new Map<string, ArticleCrawl>();
	const meteredLegsDeferred = new Set<string>();
	const outcomeRevisions = new Map<string, number>();
	const resolutionOnViewClaims = new Map<string, string>();

	const withClaimStamp = (key: string, crawl: ArticleCrawl | undefined): ArticleCrawl | undefined => {
		const claimedAt = resolutionOnViewClaims.get(key);
		if (crawl === undefined || claimedAt === undefined) return crawl;
		return { ...crawl, resolutionOnViewClaimedAt: claimedAt };
	};

	function bumpOutcomeRevision(key: string): number {
		const next = (outcomeRevisions.get(key) ?? 0) + 1;
		outcomeRevisions.set(key, next);
		return next;
	}

	const findArticleCrawlStatus: FindArticleCrawlStatus = async (url) => {
		const id = ArticleResourceUniqueId.parse(url);
		return withClaimStamp(id.value, states.get(id.value));
	};

	const markCrawlPending: MarkCrawlPending = async ({ url, meteredLegs }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		if (meteredLegs === "deferred") {
			if (current?.status === "pending" || current?.status === "ready") {
				return { kind: "refused", crawlStatus: current.status, carriedMarker: meteredLegsDeferred.has(id.value) };
			}
			meteredLegsDeferred.add(id.value);
			states.set(id.value, { status: "pending" });
			return { kind: "marked" };
		}
		const carriedMarker = meteredLegsDeferred.has(id.value);
		meteredLegsDeferred.delete(id.value);
		if (current?.status === "ready") return { kind: "refused", crawlStatus: "ready", carriedMarker };
		// Preserve any previously recorded stage when re-marking pending so the
		// progress indicator does not reset.
		const existingStage =
			current?.status === "pending" ? current.stage : undefined;
		states.set(
			id.value,
			existingStage
				? { status: "pending", stage: existingStage }
				: { status: "pending" },
		);
		return { kind: "marked" };
	};

	const forceMarkCrawlPending: ForceMarkCrawlPending = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url);
		meteredLegsDeferred.delete(id.value);
		states.set(id.value, { status: "pending" });
	};

	const markCrawlReady: InMemoryMarkCrawlReady = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url);
		bumpOutcomeRevision(id.value);
		states.set(id.value, { status: "ready" });
	};

	const markCrawlFailed: InMemoryMarkCrawlFailed = async ({ url, reason }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		if (current?.status === "ready") return;
		states.set(id.value, { status: "failed", reason, outcomeRevision: bumpOutcomeRevision(id.value) });
	};

	const markCrawlUnsupported: InMemoryMarkCrawlUnsupported = async ({ url, reason }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		if (current?.status === "ready") return;
		bumpOutcomeRevision(id.value);
		states.set(id.value, { status: "unsupported", reason });
	};

	const markCrawlStage: InMemoryMarkCrawlStage = async ({ url, stage }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		// Stage only meaningful while pending — once a row reaches a terminal
		// state (ready/failed/unsupported) the worker may still emit a final
		// stage but we must not regress to pending.
		if (
			current?.status === "ready" ||
			current?.status === "failed" ||
			current?.status === "unsupported"
		)
			return;
		states.set(id.value, { status: "pending", stage });
	};

	const isMeteredLegsDeferred = (url: string): boolean =>
		meteredLegsDeferred.has(ArticleResourceUniqueId.parse(url).value);

	const crawlStateOf = (url: string): ArticleCrawl | undefined => {
		const key = ArticleResourceUniqueId.parse(url).value;
		return withClaimStamp(key, states.get(key));
	};

	const resumeMeteredLegs = (url: string): void => {
		meteredLegsDeferred.delete(ArticleResourceUniqueId.parse(url).value);
	};

	const stampResolutionOnViewClaim = ({ url, claimedAt }: { url: string; claimedAt: string }): void => {
		resolutionOnViewClaims.set(ArticleResourceUniqueId.parse(url).value, claimedAt);
	};

	return {
		stampResolutionOnViewClaim,
		isMeteredLegsDeferred,
		crawlStateOf,
		resumeMeteredLegs,
		findArticleCrawlStatus,
		markCrawlPending,
		forceMarkCrawlPending,
		markCrawlReady,
		markCrawlFailed,
		markCrawlUnsupported,
		markCrawlStage,
	};
}
