import { randomBytes } from "node:crypto";
import { HighlightIdSchema } from "@packages/domain/highlight";
import type { Highlight, HighlightStore } from "@packages/domain/highlight";

function keyFor(userId: string, articleId: string): string {
	return `${userId}#${articleId}`;
}

export function initInMemoryHighlight(deps: { now: () => Date }): HighlightStore {
	const byArticle = new Map<string, Highlight[]>();

	return {
		saveHighlight: async ({ userId, articleId, anchor, note }) => {
			const id = HighlightIdSchema.parse(randomBytes(16).toString("hex"));
			const highlight: Highlight = {
				id,
				userId,
				articleId,
				anchor,
				note,
				createdAt: deps.now().toISOString(),
			};
			const key = keyFor(userId, articleId);
			const list = byArticle.get(key) ?? [];
			list.push(highlight);
			byArticle.set(key, list);
			return highlight;
		},
		findHighlightsByArticle: async ({ userId, articleId }) => {
			const list = byArticle.get(keyFor(userId, articleId)) ?? [];
			return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		},
		updateHighlightNote: async ({ id, userId, articleId, note }) => {
			const list = byArticle.get(keyFor(userId, articleId));
			if (!list) return;
			const index = list.findIndex((highlight) => highlight.id === id);
			if (index < 0) return;
			const trimmed = note.trim();
			list[index] = {
				...list[index],
				note: trimmed === "" ? undefined : trimmed,
			};
		},
		deleteHighlight: async ({ id, userId, articleId }) => {
			const list = byArticle.get(keyFor(userId, articleId));
			if (!list) return;
			const index = list.findIndex((highlight) => highlight.id === id);
			if (index >= 0) list.splice(index, 1);
		},
	};
}
