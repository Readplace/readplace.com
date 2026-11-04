import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { type DispatchCommand, initSqsRecordHandler } from "@packages/infra-components/runtime";
import type { GenerateSummaryCommand } from "@packages/infra-components";
import { LinkSavedEvent } from "./index";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";

export function initLinkSavedHandler(deps: {
	dispatchGenerateSummary: DispatchCommand<typeof GenerateSummaryCommand>;
	findArticleContent: FindArticleContent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { dispatchGenerateSummary, findArticleContent, logger } = deps;

	return initSqsRecordHandler({
		definition: LinkSavedEvent,
		logger,
		failure: { message: "[LinkSaved] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const content = await findArticleContent(detail.url);
			/* Canonical S3 object written upstream may not be readable yet (S3
			 * eventual consistency). Throw so SQS retries through
			 * maxReceiveCount; on exhaustion the DLQ alarm fires. */
			if (!content) {
				throw new Error(`canonical content not yet readable for url=${detail.url}`);
			}

			await dispatchGenerateSummary({ url: detail.url });

			logger.info("[LinkSaved] dispatched GenerateGlobalSummary", { url: detail.url });
		},
	});
}
