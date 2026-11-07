import assert from "node:assert";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { reanchorArticleHighlights, viewerFor } from "@packages/domain/article";
import {
	CanonicalContentChangedEvent,
	HighlightsReanchoredEvent,
} from "@packages/infra-components";
import {
	initSqsRecordHandler,
	type PublishEvent,
} from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type {
	ListHighlightsOfArticle,
	WriteHighlightAnchor,
} from "@packages/provider-contracts/highlights";
import {
	HIGHLIGHTS_REANCHORED_EVENT,
	type HighlightsReanchoredLine,
} from "../observability/events";
import { prepareReaderContent } from "../web/shared/article-body/reader-slot/reader-content";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../web/shared/article-body/reader-slot/section-pages";

export function initReanchorHighlightsHandler(deps: {
	listHighlightsOfArticle: ListHighlightsOfArticle;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
	readArticleContent: ReadArticleContent;
	writeHighlightAnchor: WriteHighlightAnchor;
	publishEvent: PublishEvent;
	appOrigin: string;
	metricLog: Logger.Typed<HighlightsReanchoredLine>;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { logger, metricLog } = deps;

	return initSqsRecordHandler({
		definition: CanonicalContentChangedEvent,
		logger,
		failure: { message: "[reanchor-highlights] record failed" },
		malformed: { policy: "retry" },
		handle: async ({ url }) => {
			const rows = await deps.listHighlightsOfArticle(url);
			if (rows.length === 0) return;

			const snapshot = await deps.readCanonicalSnapshot(url);
			if (snapshot === undefined) {
				logger.info("[reanchor-highlights] no canonical snapshot, skipped", { url });
				return;
			}
			const stored = await deps.readArticleContent({
				url,
				viewer: viewerFor(rows[0].userId),
			});
			if (stored.kind === "not-an-article") return;
			assert(stored.kind === "article", `canonical body missing for url=${url}`);
			const reread = await deps.readCanonicalSnapshot(url);
			assert(
				reread?.canonicalContentHash === snapshot.canonicalContentHash &&
					reread.canonicalCandidateId === snapshot.canonicalCandidateId,
				`canonical content changed while re-anchoring url=${url}`,
			);

			const { text } = prepareReaderContent({
				content: stored.body,
				appOrigin: deps.appOrigin,
				url,
				section: {
					requested: undefined,
					readerPath: "",
					thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES,
				},
			});
			const { writes } = reanchorArticleHighlights({
				text,
				contentHash: snapshot.canonicalContentHash,
				candidateId: snapshot.canonicalCandidateId,
				highlights: rows.map((row) => ({ ...row.highlight, userId: row.userId })),
			});

			const counts = { anchored: 0, moved: 0, orphaned: 0, skipped: 0 };
			for (const write of writes) {
				const { outcome } = await deps.writeHighlightAnchor({
					userId: write.highlight.userId,
					url: write.highlight.highlightOf,
					highlightId: write.highlight.highlightId,
					expectedRevision: write.expectedRevision,
					anchor: write.anchor,
				});
				assert(
					outcome !== "stale",
					`highlight ${write.highlight.highlightId} changed while re-anchoring url=${url}`,
				);
				if (outcome === "deleted") counts.skipped++;
				else counts[write.anchor.anchorState]++;
			}

			metricLog.info({ event: HIGHLIGHTS_REANCHORED_EVENT, url, ...counts });
			await deps.publishEvent(HighlightsReanchoredEvent, {
				url,
				anchored: counts.anchored,
				moved: counts.moved,
				orphaned: counts.orphaned,
			});
		},
	});
}
