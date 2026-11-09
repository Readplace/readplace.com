import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { SelectArticleContentCommand, type SelectArticleContentDetail } from "@packages/infra-components";
import { initSelectContentWorkUnderLease, type SelectionRecordDependencies, selectRecord } from "./select-content-work";
import { SELECTION_SOURCE_POLICIES } from "./selection-source-policies";
import { SELECT_CONTENT_TIMEOUTS } from "./timeouts";

export function initSelectArticleContentHandler(deps: SelectionRecordDependencies): Handler<SQSEvent, SQSBatchResponse> {
	const selectContent = initSelectContentWorkUnderLease(deps, { judgeClaimTtlMs: SELECT_CONTENT_TIMEOUTS.processingJudgeClaimSeconds * 1000, heldClaim: "raise-ownership-anomaly" });
	return async (event, context) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			const receiveCount = Number(record.attributes.ApproximateReceiveCount);
			let command: SelectArticleContentDetail;
			try {
				command = SelectArticleContentCommand.detailSchema.parse(JSON.parse(record.body).detail);
			} catch (error) {
				deps.logger.error("[SelectArticleContent] record failed", { messageId: record.messageId, receiveCount, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
				continue;
			}
			const policy = SELECTION_SOURCE_POLICIES[command.sourceKind];
			const logFields = { sourceKind: command.sourceKind, workId: command.workId, messageId: record.messageId, receiveCount };
			deps.logger.info("[SelectArticleContent] processing", logFields);
			const failure = await selectRecord({
				deps,
				selectContent,
				policy,
				toRequest: () => policy.toRequest(command.detail, command.workId),
				record,
				remainingTimeMs: () => context.getRemainingTimeInMillis(),
				logFields,
			});
			if (failure !== undefined) batchItemFailures.push(failure);
		}
		return { batchItemFailures };
	};
}
