import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import {
	markSummaryPending,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { CanonicalContentChangedEvent } from "@packages/infra-components";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { FindArticleContent } from "./article-content.types";

export function initCanonicalContentChangedHandler(deps: {
	findArticleContent: FindArticleContent;
	transitionAndPersist: TransitionAndPersist;
	now: () => Date;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { findArticleContent, transitionAndPersist, now, logger } = deps;

	return initSqsRecordHandler({
		definition: CanonicalContentChangedEvent,
		logger,
		failure: { message: "[CanonicalContentChanged] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const content = await findArticleContent(detail.url);
			/* Canonical S3 object written upstream may not be readable yet (S3
			 * eventual consistency). Throw so SQS retries through
			 * maxReceiveCount; on exhaustion the DLQ alarm fires. */
			if (!content) {
				throw new Error(`canonical content not yet readable for url=${detail.url}`);
			}

			await transitionAndPersist(markSummaryPending, {
				url: detail.url,
				input: { now: now().toISOString() },
			});

			logger.info("[CanonicalContentChanged] re-primed summary", { url: detail.url });
		},
	});
}
