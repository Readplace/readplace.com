import {
	newSaveAttemptId,
	type SaveProvenance,
	type ValidateSaveableUrl,
} from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { RefreshIdentifiedArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { SaveArticleAtReadlistTop } from "@packages/save-article";
import type { PendingViewHighlights } from "../../../providers/pending-view-highlights/pending-view-highlights.types";
import type {
	CreateHighlightByQuote,
	CreateHighlightByQuoteOutcome,
} from "../../shared/article-body/highlights/create-highlight-by-quote";

const KEPT = new Set<CreateHighlightByQuoteOutcome["status"]>([
	"created",
	"merged",
	"unchanged",
	"noted",
]);

export interface ClaimedViewHighlights {
	articleId: string | undefined;
	created: number;
	dropped: number;
}

export type ClaimViewHighlights = (input: {
	userId: UserId;
	provenance: SaveProvenance;
	pending: PendingViewHighlights;
}) => Promise<ClaimedViewHighlights>;

export function initClaimViewHighlights(deps: {
	validateNewSaveUrl: ValidateSaveableUrl;
	refreshArticleIfStale: RefreshIdentifiedArticleIfStale;
	saveArticleAtReadlistTop: SaveArticleAtReadlistTop;
	createHighlightByQuote: CreateHighlightByQuote;
}): ClaimViewHighlights {
	const saveForClaim = async (input: {
		userId: UserId;
		provenance: SaveProvenance;
		url: string;
	}): Promise<{ id: string; url: string } | undefined> => {
		const validation = deps.validateNewSaveUrl(input.url);
		if (validation.status === "ERROR") return undefined;
		const freshness = await deps.refreshArticleIfStale({ url: validation.url });
		if (freshness.action === "unresolved") return undefined;
		const { saved } = await deps.saveArticleAtReadlistTop({
			userId: input.userId,
			url: validation.url,
			freshness,
			provenance: input.provenance,
			saveTrigger: "manual",
			saveAttemptId: newSaveAttemptId(),
		});
		return { id: saved.id.value, url: saved.url };
	};

	return async ({ userId, provenance, pending }) => {
		let created = 0;
		let dropped = 0;
		let articleId: string | undefined;
		for (const url of new Set(pending.items.map((item) => item.url))) {
			const items = pending.items.filter((item) => item.url === url);
			const saved = await saveForClaim({ userId, provenance, url });
			if (saved === undefined) {
				dropped += items.length;
				continue;
			}
			if (url === pending.articleUrl) articleId = saved.id;
			for (const item of items) {
				const outcome = await deps.createHighlightByQuote({
					userId,
					articleUrl: saved.url,
					quote: item.exact,
					note: item.note,
					textBefore: item.prefix.trimEnd(),
				});
				if (KEPT.has(outcome.status)) created += 1;
				else dropped += 1;
			}
		}
		return { articleId, created, dropped };
	};
}
