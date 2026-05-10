import assert from "node:assert";
import type { SQSBatchItemFailure, SQSBatchResponse, SQSHandler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import {
	GenerateSummaryCommand,
	SummaryGeneratedEvent,
} from "./index";
import type { SummarizeArticle } from "./article-summary.types";
import type { FindArticleContent } from "../save-link/find-article-content";

interface GenerateSummaryHandlerDeps {
	summarizeArticle: SummarizeArticle;
	findArticleContent: FindArticleContent;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initGenerateSummaryHandler(deps: GenerateSummaryHandlerDeps): SQSHandler {
	const { summarizeArticle, findArticleContent, publishEvent, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const command = GenerateSummaryCommand.detailSchema.parse(envelope.detail);

				const article = await findArticleContent(command.url);
				assert(article, `Article content not found: ${command.url}`);

				const result = await summarizeArticle({
					url: command.url,
					textContent: article.content,
				});

				if (!result) {
					logger.info("[GenerateGlobalSummary] already summarized or skipped", { url: command.url });
					continue;
				}

				await publishEvent({
					source: SummaryGeneratedEvent.source,
					detailType: SummaryGeneratedEvent.detailType,
					detail: JSON.stringify({
						url: command.url,
						inputTokens: result.inputTokens,
						outputTokens: result.outputTokens,
					}),
				});

				logger.info("[GenerateGlobalSummary] completed", {
					url: command.url,
					inputTokens: result.inputTokens,
					outputTokens: result.outputTokens,
				});
			} catch (error) {
				logger.error("[GenerateGlobalSummary] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
