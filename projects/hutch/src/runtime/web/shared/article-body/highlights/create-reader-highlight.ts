import { type Highlight, HighlightIdSchema } from "@packages/domain/article";
import {
	anchorHighlight,
	describeRange,
	HIGHLIGHT_MAX_EXACT_LENGTH,
	mergeRanges,
} from "@packages/domain/article/highlight";
import type { UserId } from "@packages/domain/user";
import type {
	CreateHighlight,
	CreateHighlightOutcome,
	ListArticleHighlights,
} from "@packages/provider-contracts/highlights";

export type CreateReaderHighlightOutcome =
	| CreateHighlightOutcome
	| { status: "passage-changed" }
	| { status: "too-long" };

export type CreateReaderHighlight = (params: {
	text: string;
	contentHash: string;
	userId: UserId;
	url: string;
	exact: string;
	start: number;
	end: number;
}) => Promise<CreateReaderHighlightOutcome>;

export function initCreateReaderHighlight(deps: {
	listArticleHighlights: ListArticleHighlights;
	createHighlight: CreateHighlight;
	newHighlightId: () => string;
	now: () => Date;
}): CreateReaderHighlight {
	return async (params) => {
		const { text, contentHash, userId, url } = params;
		if (params.exact.length > HIGHLIGHT_MAX_EXACT_LENGTH) {
			return { status: "too-long" };
		}
		if (params.exact === "" || text.slice(params.start, params.end) !== params.exact) {
			return { status: "passage-changed" };
		}

		const rows = await deps.listArticleHighlights({ userId, url });
		const anchored = rows.flatMap((row) => {
			const anchor = anchorHighlight({ text, contentHash, highlight: row });
			return anchor.anchorState === "orphaned"
				? []
				: [{ highlightId: row.highlightId, start: anchor.start, end: anchor.end }];
		});
		const { range, merged } = mergeRanges({
			range: { start: params.start, end: params.end },
			existing: anchored,
		});
		const described = describeRange({ text, start: range.start, end: range.end });
		if (described.exact.length > HIGHLIGHT_MAX_EXACT_LENGTH) {
			return { status: "too-long" };
		}

		const now = deps.now();
		const highlight: Highlight = {
			...described,
			highlightId: HighlightIdSchema.parse(deps.newHighlightId()),
			highlightOf: url,
			anchoredContentHash: contentHash,
			anchorState: "anchored",
			orderKey: described.start,
			createdAt: now,
			updatedAt: now,
			anchorRevision: 0,
		};
		return deps.createHighlight({
			userId,
			highlight,
			replacedIds: merged.map((row) => row.highlightId),
		});
	};
}
