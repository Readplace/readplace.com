import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { z } from "zod";
import type { Logger } from "@packages/logger";
import { initHandleByDetailType, initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import {
	LinkQueueFailedEvent,
	ResolveArticleOnViewCommand,
	SubmitLinkCommand,
} from "@packages/infra-components";
import {
	type LoadArticle,
	type TransitionAndPersist,
	markCrawlExhausted,
	markSummaryExhausted,
} from "@packages/domain/article-aggregate";
import { UserIdSchema } from "@packages/domain/user";

const REASON = "accept-retries-exhausted";

/** Deliberately looser than the command schema, and reading only the two fields
 * the failure fact needs. A record reaches this handler *because* the accept
 * phase could not process it — re-imposing the schema that rejected it would
 * dead-letter the dead letter and leave the read model uncorrected, which is the
 * one outcome this handler exists to prevent. */
const DeadLetteredSubmission = z.object({
	url: z.string(),
	userId: UserIdSchema.optional(),
});

/**
 * Turns a dead-lettered `SubmitLinkCommand` into the fact that the save gave up,
 * so a reader's saved-link read model is not left claiming a queue row that was
 * never written.
 *
 * The fact is weaker than it looks and its consumers must treat it that way: the
 * accept phase writes the reader's queue row *first* and several calls after it
 * can still throw, so a record can exhaust its receives with the article sitting
 * in the queue the whole time. This says "the command gave up", not "nothing was
 * queued" — which is why the read model lets an existing accepted save outrank it.
 *
 * Mutates no article row, deliberately: the row either does not exist or belongs
 * to another saver's in-flight crawl. Publishing the fact is the whole job.
 *
 * A command with no `userId` (the reserved anonymous shapes, which the accept
 * handler already refuses) has no per-user read model to correct. It is logged
 * at error level and left to the DLQ alarm rather than being forced into a fact
 * whose `userId` is the one thing it cannot supply.
 */
function initSubmissionDlqHandler(deps: {
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { publishEvent, logger } = deps;

	return initSqsRecordHandler({
		definition: { detailSchema: DeadLetteredSubmission },
		logger,
		failure: { message: "[SubmitLinkDlq] record failed" },
		malformed: { policy: "retry" },
		handle: async (command, { receiveCount }) => {
			if (command.userId === undefined) {
				logger.error("[SubmitLinkDlq] dead letter with no userId", {
					url: command.url,
					receiveCount,
				});
				return;
			}

			logger.info("[SubmitLinkDlq] publishing save failure", {
				url: command.url,
				receiveCount,
			});
			await publishEvent(LinkQueueFailedEvent, {
				url: command.url,
				userId: command.userId,
				reason: REASON,
				receiveCount,
			});
		},
	});
}

const DeadLetteredResolution = ResolveArticleOnViewCommand.detailSchema.pick({ url: true });

function initResolutionDlqHandler(deps: {
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { loadArticle, transitionAndPersist, logger } = deps;

	return initSqsRecordHandler({
		definition: { detailSchema: DeadLetteredResolution },
		logger,
		failure: { message: "[SubmitLinkDlq] resolve-on-view record failed" },
		malformed: { policy: "retry" },
		handle: async ({ url }, { messageId, receiveCount }) => {
			const reason = { kind: "exhausted-retries", receiveCount } as const;
			const article = await loadArticle(url);
			if (article?.crawl.kind === "pending") {
				await transitionAndPersist(markCrawlExhausted, { url, input: { reason, receiveCount } });
			} else if (article?.summary.kind === "pending") {
				await transitionAndPersist(markSummaryExhausted, { url, input: { reason, receiveCount } });
			}
			logger.error(`[SubmitLinkDlq] resolve-on-view dead-lettered after ${receiveCount} receives`, {
				url,
				messageId,
			});
		},
	});
}

export function initSubmitLinkDlqHandler(deps: {
	publishEvent: PublishEvent;
	loadArticle: LoadArticle;
	transitionAndPersist: TransitionAndPersist;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initHandleByDetailType({
		routes: {
			[SubmitLinkCommand.detailType]: [initSubmissionDlqHandler(deps)],
			[ResolveArticleOnViewCommand.detailType]: [initResolutionDlqHandler(deps)],
		},
		logger: deps.logger,
	});
}
