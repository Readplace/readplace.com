import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	FindGeneratedSummary,
	ForceMarkSummaryPending,
	GeneratedSummary,
	MarkSummaryPending,
} from "./article-summary.types";

export type InMemoryMarkSummaryReady = (params: {
	url: string;
	summary: string;
	excerpt?: string;
}) => Promise<void>;

export type InMemoryMarkSummarySkipped = (params: {
	url: string;
	reason?: string;
}) => Promise<void>;

export function initInMemoryGeneratedSummary(): {
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	forceMarkSummaryPending: ForceMarkSummaryPending;
	markSummaryReady: InMemoryMarkSummaryReady;
	markSummarySkipped: InMemoryMarkSummarySkipped;
} {
	const states = new Map<string, GeneratedSummary>();

	const findGeneratedSummary: FindGeneratedSummary = async (url) => {
		const id = ArticleResourceUniqueId.parse(url);
		return states.get(id.value);
	};

	const markSummaryPending: MarkSummaryPending = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url);
		const current = states.get(id.value);
		if (current?.status === "ready" || current?.status === "skipped") return;
		states.set(id.value, { status: "pending" });
	};

	const forceMarkSummaryPending: ForceMarkSummaryPending = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url);
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

	return {
		findGeneratedSummary,
		markSummaryPending,
		forceMarkSummaryPending,
		markSummaryReady,
		markSummarySkipped,
	};
}
