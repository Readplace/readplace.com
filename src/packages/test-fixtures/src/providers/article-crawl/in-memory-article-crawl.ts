import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { CrawlStage } from "@packages/domain/article";
import type {
	ArticleCrawl,
	AutoHealState,
	FindArticleCrawlStatus,
	FindAutoHealState,
	ForceMarkCrawlPending,
	IncrementCrawlAutoHealAttempt,
	MarkCrawlPending,
	WriteAutoHealAttempt,
} from "./article-crawl.types";
import { initIncrementCrawlAutoHealAttempt } from "./increment-crawl-auto-heal-attempt";

export type InMemoryMarkCrawlReady = (params: { url: string }) => Promise<void>;
export type InMemoryMarkCrawlFailed = (params: {
	url: string;
	reason: string;
}) => Promise<void>;
export type InMemoryMarkCrawlStage = (params: {
	url: string;
	stage: CrawlStage;
}) => Promise<void>;

export function initInMemoryArticleCrawl(): {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	forceMarkCrawlPending: ForceMarkCrawlPending;
	markCrawlReady: InMemoryMarkCrawlReady;
	markCrawlFailed: InMemoryMarkCrawlFailed;
	markCrawlStage: InMemoryMarkCrawlStage;
	incrementCrawlAutoHealAttempt: IncrementCrawlAutoHealAttempt;
} {
	const states = new Map<string, ArticleCrawl>();
	const autoHeal = new Map<string, AutoHealState>();

	const findArticleCrawlStatus: FindArticleCrawlStatus = async (url) => {
		const id = ArticleResourceUniqueId.parse(url);
		return states.get(id.value);
	};

	const markCrawlPending: MarkCrawlPending = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		if (current?.status === "ready") return;
		// Preserve any previously recorded stage so the legacy-stub healing path
		// (markCrawlPending called after the worker may have written a stage) does
		// not reset the bar. Mirrors the DDB markCrawlPending UpdateExpression
		// which only writes crawlStatus and leaves crawlStage untouched.
		const existingStage =
			current?.status === "pending" ? current.stage : undefined;
		states.set(
			id.value,
			existingStage
				? { status: "pending", stage: existingStage }
				: { status: "pending" },
		);
	};

	const forceMarkCrawlPending: ForceMarkCrawlPending = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url);
		states.set(id.value, { status: "pending" });
	};

	const markCrawlReady: InMemoryMarkCrawlReady = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url);
		states.set(id.value, { status: "ready" });
		// Mirror the prod reset path (promoteTierToCanonical clears auto-heal
		// counters when promoting): a successful crawl should not leave a
		// pre-existing cap in place to bite the next failure.
		autoHeal.delete(id.value);
	};

	const markCrawlFailed: InMemoryMarkCrawlFailed = async ({ url, reason }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		if (current?.status === "ready") return;
		states.set(id.value, { status: "failed", reason });
	};

	const markCrawlStage: InMemoryMarkCrawlStage = async ({ url, stage }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		// Stage only meaningful while pending — once a row reaches a terminal
		// state (ready/failed) the worker may still emit a final stage but we
		// must not regress to pending.
		if (current?.status === "ready" || current?.status === "failed") return;
		states.set(id.value, { status: "pending", stage });
	};

	const findAutoHealState: FindAutoHealState = async (url) => {
		const id = ArticleResourceUniqueId.parse(url);
		return autoHeal.get(id.value);
	};

	const writeAutoHealAttempt: WriteAutoHealAttempt = async ({
		url,
		attempts,
		lastAttemptAtIso,
	}) => {
		const id = ArticleResourceUniqueId.parse(url);
		autoHeal.set(id.value, { attempts, lastAttemptAtIso });
	};

	const { incrementCrawlAutoHealAttempt } = initIncrementCrawlAutoHealAttempt({
		findAutoHealState,
		writeAutoHealAttempt,
	});

	return {
		findArticleCrawlStatus,
		markCrawlPending,
		forceMarkCrawlPending,
		markCrawlReady,
		markCrawlFailed,
		markCrawlStage,
		incrementCrawlAutoHealAttempt,
	};
}
