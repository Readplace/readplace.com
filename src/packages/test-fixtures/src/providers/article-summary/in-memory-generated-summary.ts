import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { shownSummary } from "@packages/domain/article";
import type { FindItemOwner } from "@packages/provider-contracts/article-store";
import type {
	FindGeneratedSummary,
	GeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";

export type InMemoryMarkSummaryReady = (params: {
	url: string;
	summary: string;
	excerpt?: string;
}) => Promise<void>;

export type InMemoryMarkSummarySkipped = (params: {
	url: string;
	reason?: string;
}) => Promise<void>;

export type InMemoryMarkSummaryFailed = (params: {
	url: string;
	reason: string;
}) => Promise<void>;

export function initInMemoryGeneratedSummary(deps: { findItemOwner: FindItemOwner }): {
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	markSummaryReady: InMemoryMarkSummaryReady;
	markSummarySkipped: InMemoryMarkSummarySkipped;
	markSummaryFailed: InMemoryMarkSummaryFailed;
	summaryStateOf: (url: string) => GeneratedSummary | undefined;
	forceMarkSummaryPending: (url: string) => void;
} {
	const states = new Map<string, GeneratedSummary>();

	const findGeneratedSummary: FindGeneratedSummary = async ({ url, viewer }) => {
		const id = ArticleResourceUniqueId.parse(url);
		return shownSummary({ url, summary: states.get(id.value), viewer, ownerUserId: await deps.findItemOwner(url) });
	};

	const markSummaryPending: MarkSummaryPending = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		if (current?.status === "ready" || current?.status === "skipped") return;
		states.set(id.value, { status: "pending" });
	};

	const markSummaryReady: InMemoryMarkSummaryReady = async ({ url, summary, excerpt }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const ready: GeneratedSummary = excerpt
			? { status: "ready", summary, excerpt }
			: { status: "ready", summary };
		states.set(id.value, ready);
	};

	const markSummarySkipped: InMemoryMarkSummarySkipped = async ({ url, reason }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const skipped: GeneratedSummary = reason
			? { status: "skipped", reason }
			: { status: "skipped" };
		states.set(id.value, skipped);
	};

	const markSummaryFailed: InMemoryMarkSummaryFailed = async ({ url, reason }) => {
		states.set(ArticleResourceUniqueId.parse(url).value, { status: "failed", reason });
	};

	const summaryStateOf = (url: string): GeneratedSummary | undefined =>
		states.get(ArticleResourceUniqueId.parse(url).value);

	const forceMarkSummaryPending = (url: string): void => {
		states.set(ArticleResourceUniqueId.parse(url).value, { status: "pending" });
	};

	return {
		summaryStateOf,
		forceMarkSummaryPending,
		findGeneratedSummary,
		markSummaryPending,
		markSummaryReady,
		markSummarySkipped,
		markSummaryFailed,
	};
}
