import assert from "node:assert";
import type { Highlight, HighlightId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type {
	CreateHighlight,
	DeleteAllUserHighlights,
	DeleteArticleHighlights,
	DeleteHighlight,
	ListArticleHighlights,
} from "@packages/provider-contracts/highlights";

export interface InMemoryHighlights {
	listArticleHighlights: ListArticleHighlights;
	createHighlight: CreateHighlight;
	deleteHighlight: DeleteHighlight;
	deleteArticleHighlights: DeleteArticleHighlights;
	deleteAllUserHighlights: DeleteAllUserHighlights;
	setCreateCancelled: (cancelled: boolean) => void;
	bumpAnchorRevision: (params: { userId: UserId; url: string; highlightId: HighlightId }) => void;
}

export function initInMemoryHighlights(): InMemoryHighlights {
	const rows = new Map<string, { userId: UserId; highlight: Highlight }>();
	let createCancelled = false;

	const keyOf = (params: { userId: UserId; url: string; highlightId: string }) =>
		`${params.userId}\u0000${params.url}\u0000${params.highlightId}`;

	const rowsOf = (params: { userId: UserId; url: string }) =>
		[...rows.entries()].filter(
			([, row]) => row.userId === params.userId && row.highlight.highlightOf === params.url,
		);

	const listArticleHighlights: ListArticleHighlights = async (params) =>
		rowsOf(params)
			.map(([, row]) => ({ ...row.highlight }))
			.sort((a, b) => a.orderKey - b.orderKey || a.highlightId.localeCompare(b.highlightId));

	const createHighlight: CreateHighlight = async ({ userId, highlight, replacedIds }) => {
		const url = highlight.highlightOf;
		const key = keyOf({ userId, url, highlightId: highlight.highlightId });
		const replacedKeys = replacedIds.map((highlightId) => keyOf({ userId, url, highlightId }));
		if (createCancelled || rows.has(key) || replacedKeys.some((replaced) => !rows.has(replaced))) {
			return { status: "cancelled" };
		}
		for (const replaced of replacedKeys) rows.delete(replaced);
		rows.set(key, { userId, highlight: { ...highlight } });
		return { status: replacedIds.length === 0 ? "created" : "merged", highlight, replacedIds };
	};

	const deleteHighlight: DeleteHighlight = async (params) => ({ deleted: rows.delete(keyOf(params)) });

	const deleteArticleHighlights: DeleteArticleHighlights = async (params) => {
		for (const [key] of rowsOf(params)) rows.delete(key);
	};

	const deleteAllUserHighlights: DeleteAllUserHighlights = async (userId) => {
		for (const [key, row] of [...rows.entries()]) {
			if (row.userId === userId) rows.delete(key);
		}
	};

	return {
		listArticleHighlights,
		createHighlight,
		deleteHighlight,
		deleteArticleHighlights,
		deleteAllUserHighlights,
		setCreateCancelled: (cancelled) => {
			createCancelled = cancelled;
		},
		bumpAnchorRevision: (params) => {
			const row = rows.get(keyOf(params));
			assert(row, `no highlight ${params.highlightId} to bump`);
			row.highlight = { ...row.highlight, anchorRevision: row.highlight.anchorRevision + 1 };
		},
	};
}
