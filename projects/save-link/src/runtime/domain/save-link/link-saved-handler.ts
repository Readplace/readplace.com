import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import type { DispatchCommand } from "@packages/infra-components/runtime";
import type { GenerateSummaryCommand } from "@packages/infra-components";
import { LinkSavedEvent } from "./index";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";

export function initLinkSavedHandler(deps: {
	dispatchGenerateSummary: DispatchCommand<typeof GenerateSummaryCommand>;
	findArticleContent: FindArticleContent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { dispatchGenerateSummary, findArticleContent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = LinkSavedEvent.detailSchema.parse(envelope.detail);

				const content = await findArticleContent(detail.url);
				/* Canonical S3 object written upstream may not be readable yet (S3
				 * eventual consistency). Throw so SQS retries through
				 * maxReceiveCount; on exhaustion the DLQ alarm fires. */
				if (!content) {
					throw new Error(`canonical content not yet readable for url=${detail.url}`);
				}

				await dispatchGenerateSummary({ url: detail.url });

				logger.info("[LinkSaved] dispatched GenerateGlobalSummary", { url: detail.url });
			} catch (error) {
				logger.error("[LinkSaved] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
