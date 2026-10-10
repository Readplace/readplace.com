import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ArticleTopic } from "@packages/domain/article";
import type {
	FindGeneratedSummary,
	GeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";
import type { FindArticleTopics } from "../article-store/article-store.types";

export type InMemoryMarkSummaryReady = (params: {
	url: string;
	summary: string;
	excerpt?: string;
	topics: readonly ArticleTopic[];
}) => Promise<void>;

export type InMemoryMarkSummarySkipped = (params: {
	url: string;
	reason?: string;
}) => Promise<void>;

export function initInMemoryGeneratedSummary(): {
	findGeneratedSummary: FindGeneratedSummary;
	findTopics: FindArticleTopics;
	markSummaryPending: MarkSummaryPending;
	markSummaryReady: InMemoryMarkSummaryReady;
	markSummarySkipped: InMemoryMarkSummarySkipped;
} {
	const states = new Map<string, GeneratedSummary>();

	const findGeneratedSummary: FindGeneratedSummary = async (url) => {
		const id = ArticleResourceUniqueId.parse(url);
		return states.get(id.value);
	};

	const findTopics: FindArticleTopics = async (url) => {
		const current = states.get(ArticleResourceUniqueId.parse(url).value);
		return current?.status === "ready" ? current.topics : [];
	};

	const markSummaryPending: MarkSummaryPending = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		if (current?.status === "ready" || current?.status === "skipped") return;
		states.set(id.value, { status: "pending" });
	};

	const markSummaryReady: InMemoryMarkSummaryReady = async ({ url, summary, excerpt, topics }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const ready: GeneratedSummary = excerpt
			? { status: "ready", summary, excerpt, topics }
			: { status: "ready", summary, topics };
		states.set(id.value, ready);
	};

	const markSummarySkipped: InMemoryMarkSummarySkipped = async ({ url, reason }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const skipped: GeneratedSummary = reason
			? { status: "skipped", reason }
			: { status: "skipped" };
		states.set(id.value, skipped);
	};

	return {
		findGeneratedSummary,
		findTopics,
		markSummaryPending,
		markSummaryReady,
		markSummarySkipped,
	};
}
