import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	markSummaryExhausted,
	type TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { GenerateSummaryCommand } from "./index";

interface GenerateSummaryDlqHandlerDeps {
	transitionAndPersist: TransitionAndPersist;
	logger: HutchLogger;
}

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initGenerateSummaryDlqHandler(deps: GenerateSummaryDlqHandlerDeps): Handler<SQSEvent, SQSBatchResponse> {
	const { transitionAndPersist, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const command = GenerateSummaryCommand.detailSchema.parse(envelope.detail);
				const receiveCount = Number(record.attributes.ApproximateReceiveCount);

				logger.info("[GenerateSummaryDlq] marking summary exhausted", {
					url: command.url,
					receiveCount,
				});

				await transitionAndPersist(markSummaryExhausted, {
					url: command.url,
					input: {
						reason: { kind: "exhausted-retries", receiveCount },
						receiveCount,
					},
				});
			} catch (error) {
				logger.error("[GenerateSummaryDlq] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
