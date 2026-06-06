import { randomBytes } from "node:crypto";
import { HighlightIdSchema } from "@packages/domain/highlight";
import type {
	CreateHighlight,
	DeleteHighlight,
	FindHighlightsByArticle,
	Highlight,
	HighlightId,
} from "./highlights-store.types";

export function initInMemoryHighlightsStore(deps: { now: () => Date }): {
	createHighlight: CreateHighlight;
	findHighlightsByArticle: FindHighlightsByArticle;
	deleteHighlight: DeleteHighlight;
} {
	const highlights = new Map<HighlightId, Highlight>();

	const createHighlight: CreateHighlight = async (params) => {
		const id = HighlightIdSchema.parse(randomBytes(16).toString("hex"));
		const highlight: Highlight = {
			id,
			userId: params.userId,
			articleId: params.articleId,
			quote: params.quote,
			note: params.note,
			createdAt: deps.now(),
		};
		highlights.set(id, highlight);
		return highlight;
	};

	const findHighlightsByArticle: FindHighlightsByArticle = async ({ userId, articleId }) => {
		return Array.from(highlights.values())
			.filter((h) => h.userId === userId && h.articleId.value === articleId.value)
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
	};

	const deleteHighlight: DeleteHighlight = async ({ userId, articleId, id }) => {
		const existing = highlights.get(id);
		if (!existing) return false;
		if (existing.userId !== userId) return false;
		if (existing.articleId.value !== articleId.value) return false;
		highlights.delete(id);
		return true;
	};

	return { createHighlight, findHighlightsByArticle, deleteHighlight };
}
