import assert from "node:assert";
import {
	newSaveAttemptId,
	type SaveableUrl,
	type SaveProvenance,
	type ValidateSaveableUrl,
} from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { RefreshIdentifiedArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { SaveArticleAtReadlistTop } from "@packages/save-article";
import type { ClaimDailySaves } from "../readlist/daily-save-allowance";
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

interface ClaimedAllowedHighlights {
	status: "claimed";
	articleId: string | undefined;
	created: number;
	dropped: number;
}

export type ClaimedViewHighlights = ClaimedAllowedHighlights | { status: "daily-save-limit"; retryAfterSeconds: number };

export type ClaimViewHighlights = (input: {
	userId: UserId;
	provenance: SaveProvenance;
	pending: PendingViewHighlights;
}) => Promise<ClaimedViewHighlights>;

export function initClaimViewHighlights(deps: {
	now: () => Date;
	validateNewSaveUrl: ValidateSaveableUrl;
	claimDailySaves: ClaimDailySaves;
	refreshArticleIfStale: RefreshIdentifiedArticleIfStale;
	saveArticleAtReadlistTop: SaveArticleAtReadlistTop;
	createHighlightByQuote: CreateHighlightByQuote;
}): ClaimViewHighlights {
	const saveForClaim = async (input: {
		requestedAt: string;
		userId: UserId;
		provenance: SaveProvenance;
		url: SaveableUrl;
	}): Promise<{ id: string; url: string } | undefined> => {
		const freshness = await deps.refreshArticleIfStale({ url: input.url, requester: { account: input.userId } });
		if (freshness.action === "unresolved") return undefined;
		const { saved } = await deps.saveArticleAtReadlistTop({
			userId: input.userId,
			url: input.url,
			freshness,
			provenance: input.provenance,
			requestedAt: input.requestedAt,
			saveTrigger: "manual",
			saveAttemptId: newSaveAttemptId(),
		});
		return { id: saved.id.value, url: saved.url };
	};

	return async ({ userId, provenance, pending }) => {
		const requestedAt = deps.now().toISOString();
		const saveableUrls = new Map<string, SaveableUrl>();
		for (const url of new Set(pending.items.map((item) => item.url))) {
			const validation = deps.validateNewSaveUrl(url);
			if (validation.status !== "ERROR") saveableUrls.set(url, validation.url);
		}
		const allowance = await deps.claimDailySaves({ userId, urls: [...new Set(saveableUrls.values())] });
		if (allowance.granted.length === 0 && allowance.refused.length > 0) {
			assert(allowance.retryAfterSeconds !== undefined, "a refused daily-save claim carries Retry-After");
			return { status: "daily-save-limit", retryAfterSeconds: allowance.retryAfterSeconds };
		}
		const granted = new Set(allowance.granted);
		let created = 0;
		let dropped = 0;
		let articleId: string | undefined;
		for (const url of new Set(pending.items.map((item) => item.url))) {
			const items = pending.items.filter((item) => item.url === url);
			const saveableUrl = saveableUrls.get(url);
			const saved =
				saveableUrl !== undefined && granted.has(saveableUrl)
					? await saveForClaim({ userId, provenance, url: saveableUrl, requestedAt })
					: undefined;
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
		return { status: "claimed", articleId, created, dropped };
	};
}
