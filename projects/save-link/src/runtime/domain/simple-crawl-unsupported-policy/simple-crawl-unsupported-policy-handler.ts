import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import {
	SimpleCrawlUnsupportedEvent,
	ComprehensiveCrawlCommand,
	RenderCrawlCommand,
} from "@packages/infra-components";

/* c8 ignore next -- V8 block coverage phantom on typed-parameter destructuring, see bcoe/c8#319 */
export function initSimpleCrawlUnsupportedPolicyHandler(deps: {
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;
	const logPrefix = "[SimpleCrawlUnsupportedPolicy]";

	return initSqsRecordHandler({
		definition: SimpleCrawlUnsupportedEvent,
		logger,
		failure: { message: `${logPrefix} record failed` },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const { unsupportedReason } = detail;
			const needsRender = unsupportedReason === "javascript-required" || unsupportedReason === "blocked";
			const forwarded = {
				url: detail.url,
				userId: detail.userId,
				trigger: detail.trigger,
				previousBodyHash: detail.previousBodyHash,
				saveAttemptId: detail.saveAttemptId,
				candidates: detail.candidates,
			};
			if (needsRender) await publishEvent(RenderCrawlCommand, { ...forwarded, unsupportedReason, finalUrl: detail.finalUrl });
			else await publishEvent(ComprehensiveCrawlCommand, forwarded);
			const command = needsRender ? RenderCrawlCommand : ComprehensiveCrawlCommand;

			logger.info(`${logPrefix} dispatched ${command.detailType}`, {
				url: detail.url,
				unsupportedReason,
				trigger: detail.trigger,
			});
		},
	});
}
