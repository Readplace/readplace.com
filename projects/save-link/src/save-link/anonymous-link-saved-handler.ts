import type { SQSBatchItemFailure, SQSBatchResponse, SQSHandler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DispatchCommand } from "@packages/hutch-infra-components/runtime";
import { AnonymousLinkSavedEvent } from "@packages/hutch-infra-components";
import type { GenerateSummaryCommand } from "@packages/hutch-infra-components";
import type { FindArticleContent } from "./find-article-content";

export function initAnonymousLinkSavedHandler(deps: {
	dispatchGenerateSummary: DispatchCommand<typeof GenerateSummaryCommand>;
	findArticleContent: FindArticleContent;
	logger: HutchLogger;
}): SQSHandler {
	const { dispatchGenerateSummary, findArticleContent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = AnonymousLinkSavedEvent.detailSchema.parse(envelope.detail);

				logger.info("[AnonymousLinkSaved] processing", { url: detail.url });

				const content = await findArticleContent(detail.url);
				if (!content) {
					logger.info("[AnonymousLinkSaved] no content available, skipping summary", { url: detail.url });
					continue;
				}

				await dispatchGenerateSummary({ url: detail.url });

				logger.info("[AnonymousLinkSaved] dispatched GenerateGlobalSummary", { url: detail.url });
			} catch (error) {
				logger.error("[AnonymousLinkSaved] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
