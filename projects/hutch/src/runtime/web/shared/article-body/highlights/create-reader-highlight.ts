import type { CandidateId } from "@packages/article-state-types";
import { type Highlight, HighlightIdSchema, joinNotes } from "@packages/domain/article";
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
	| { status: "too-long" }
	| { status: "notes-too-long" };

export type CreateReaderHighlight = (params: {
	text: string;
	contentHash: string;
	candidateId?: CandidateId;
	userId: UserId;
	url: string;
	exact: string;
	start: number;
	end: number;
	note?: string;
}) => Promise<CreateReaderHighlightOutcome>;

export function initCreateReaderHighlight(deps: {
	listArticleHighlights: ListArticleHighlights;
	createHighlight: CreateHighlight;
	newHighlightId: () => string;
	now: () => Date;
}): CreateReaderHighlight {
	return async (params) => {
		const { text, contentHash, candidateId, userId, url } = params;
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
				: [{ highlightId: row.highlightId, start: anchor.start, end: anchor.end, row }];
		});
		const { range, merged } = mergeRanges({
			range: { start: params.start, end: params.end },
			existing: anchored,
		});
		const described = describeRange({ text, start: range.start, end: range.end });
		if (described.exact.length > HIGHLIGHT_MAX_EXACT_LENGTH) {
			return { status: "too-long" };
		}
		let note = params.note;
		const newestFirst = [...merged].sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime());
		for (const { row } of newestFirst) {
			const joined = joinNotes({ newer: note, older: row.note });
			if (!joined.ok) return { status: "notes-too-long" };
			note = joined.note;
		}

		const now = deps.now();
		const highlight: Highlight = {
			...described,
			highlightId: HighlightIdSchema.parse(deps.newHighlightId()),
			highlightOf: url,
			anchoredContentHash: contentHash,
			...(candidateId === undefined ? {} : { anchoredCandidateId: candidateId }),
			anchorState: "anchored",
			orderKey: described.start,
			createdAt: now,
			updatedAt: now,
			anchorRevision: 0,
			...(note === undefined ? {} : { note }),
		};
		return deps.createHighlight({
			userId,
			highlight,
			replacedIds: merged.map((row) => row.highlightId),
		});
	};
}
