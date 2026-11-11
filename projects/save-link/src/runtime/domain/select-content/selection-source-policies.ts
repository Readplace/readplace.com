import { SaveAttemptIdSchema } from "@packages/domain/article";
import { RecrawlContentExtractedEvent, RefreshContentExtractedEvent, ReselectAfterRemovalEvent, type SelectionSourceKind, TierContentExtractedEvent } from "@packages/infra-components";
import type { SelectionSourcePolicy } from "./select-content-work";

export const SELECTION_SOURCE_POLICIES: { readonly [K in SelectionSourceKind]: SelectionSourcePolicy & { sourceKind: K } } = {
	"tier-content-extracted": {
		sourceKind: "tier-content-extracted",
		tag: "SelectContent",
		feature: "select-most-complete-content",
		onExhaustion: "mark-crawl-exhausted",
		toCommand: (detail, workId) => ({ sourceKind: "tier-content-extracted", workId, detail: TierContentExtractedEvent.detailSchema.parse(detail) }),
		toRequest: (detail) => {
			const parsed = TierContentExtractedEvent.detailSchema.parse(detail);
			return { ...parsed, mode: "save" };
		},
	},
	"recrawl-content-extracted": {
		sourceKind: "recrawl-content-extracted",
		tag: "RecrawlContentExtracted",
		feature: "recrawl-content-extracted",
		onExhaustion: "mark-crawl-exhausted",
		toCommand: (detail, workId) => ({ sourceKind: "recrawl-content-extracted", workId, detail: RecrawlContentExtractedEvent.detailSchema.parse(detail) }),
		toRequest: (detail) => {
			const parsed = RecrawlContentExtractedEvent.detailSchema.parse(detail);
			return { ...parsed, mode: "recrawl" };
		},
	},
	"refresh-content-extracted": {
		sourceKind: "refresh-content-extracted",
		tag: "RefreshContentExtracted",
		feature: "refresh-content-extracted",
		onExhaustion: "keep-row",
		toCommand: (detail, workId) => ({ sourceKind: "refresh-content-extracted", workId, detail: RefreshContentExtractedEvent.detailSchema.parse(detail) }),
		toRequest: (detail) => {
			const parsed = RefreshContentExtractedEvent.detailSchema.parse(detail);
			return { ...parsed, extractedAt: parsed.contentFetchedAt, refresh: parsed, mode: "refresh" };
		},
	},
	"reselect-after-removal": {
		sourceKind: "reselect-after-removal",
		tag: "ReselectAfterRemoval",
		feature: "reselect-after-removal",
		onExhaustion: "mark-crawl-exhausted",
		toCommand: (detail, workId) => ({ sourceKind: "reselect-after-removal", workId, detail: ReselectAfterRemovalEvent.detailSchema.parse(detail) }),
		toRequest: (detail, workId) => ({
			url: ReselectAfterRemovalEvent.detailSchema.parse(detail).url,
			saveAttemptId: SaveAttemptIdSchema.parse(workId),
			mode: "save",
		}),
	},
};
