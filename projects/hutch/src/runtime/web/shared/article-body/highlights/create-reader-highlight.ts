import assert from "node:assert";
import type { CandidateId } from "@packages/article-state-types";
import { type Highlight, HighlightIdSchema, joinNotesNewestFirst } from "@packages/domain/article";
import {
	anchorHighlight,
	cutRange,
	describeRange,
	HIGHLIGHT_MAX_EXACT_LENGTH,
	mergeRanges,
} from "@packages/domain/article/highlight";
import type { UserId } from "@packages/domain/user";
import type {
	CreateHighlight,
	CreateHighlightOutcome,
	ListArticleHighlights,
	UpdateHighlightNote,
} from "@packages/provider-contracts/highlights";

export type CreateReaderHighlightOutcome =
	| CreateHighlightOutcome
	| { status: "unchanged" | "noted"; highlight: Highlight }
	| { status: "passage-changed" }
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

function joinedNotes(params: { note?: string; rows: readonly Highlight[] }) {
	const newestFirst = [...params.rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	return joinNotesNewestFirst([params.note, ...newestFirst.map((row) => row.note)]);
}

export function initCreateReaderHighlight(deps: {
	listArticleHighlights: ListArticleHighlights;
	createHighlight: CreateHighlight;
	updateHighlightNote: UpdateHighlightNote;
	newHighlightId: () => string;
	now: () => Date;
}): CreateReaderHighlight {
	return async (params) => {
		const { text, contentHash, candidateId, userId, url } = params;
		if (params.exact === "" || text.slice(params.start, params.end) !== params.exact) {
			return { status: "passage-changed" };
		}

		const rows = await deps.listArticleHighlights({ userId, url });
		const anchored = rows.flatMap((row) => {
			const anchor = anchorHighlight({ text, contentHash, highlight: row });
			return anchor.anchorState === "orphaned" ? [] : [{ start: anchor.start, end: anchor.end, row }];
		});
		const { merged, parts, covering } = mergeRanges({
			range: { start: params.start, end: params.end },
			existing: anchored,
			maxLength: HIGHLIGHT_MAX_EXACT_LENGTH,
			canMerge: (candidates) =>
				joinedNotes({ note: params.note, rows: candidates.map(({ row }) => row) }).ok,
		});
		const now = deps.now();

		if (parts.length === 0) {
			const last = covering[covering.length - 1].row;
			if (params.note === undefined) return { status: "unchanged", highlight: last };
			const joined = joinedNotes({ note: params.note, rows: [last] });
			if (!joined.ok) return { status: "notes-too-long" };
			const { updated } = await deps.updateHighlightNote({
				userId,
				url,
				highlightId: last.highlightId,
				note: joined.note,
				updatedAt: now,
			});
			if (!updated) return { status: "cancelled" };
			return { status: "noted", highlight: { ...last, note: joined.note, updatedAt: now } };
		}

		const joined = joinedNotes({ note: params.note, rows: merged.map(({ row }) => row) });
		assert(joined.ok, "mergeRanges merges only rows whose notes join within the cap");
		const pieces = parts.flatMap((part) => cutRange({ text, range: part, maxLength: HIGHLIGHT_MAX_EXACT_LENGTH }));
		const highlights = pieces.map((piece, index): Highlight => {
			const described = describeRange({ text, start: piece.start, end: piece.end });
			const note = index === pieces.length - 1 ? joined.note : undefined;
			return {
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
		});
		return deps.createHighlight({
			userId,
			highlights,
			replacedIds: merged.map(({ row }) => row.highlightId),
		});
	};
}
