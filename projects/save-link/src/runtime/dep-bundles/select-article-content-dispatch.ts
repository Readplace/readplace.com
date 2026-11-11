import { createHash } from "node:crypto";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { SelectArticleContentCommand, type SelectArticleContentDetail } from "@packages/infra-components";
import { type DispatchCommand, initSqsCommandDispatcher } from "@packages/infra-components/runtime";
import { articleMessageGroupId } from "./generate-summary-dispatch";

export type DispatchSelectArticleContent = DispatchCommand<typeof SelectArticleContentCommand>;

export function selectionDeduplicationId(detail: Pick<SelectArticleContentDetail, "sourceKind" | "workId">): string {
	return createHash("sha256").update(`${detail.sourceKind}:${detail.workId}`).digest("hex");
}

export function initSelectArticleContentDispatch(deps: {
	sqsClient: Pick<SQSClient, "send">;
	selectArticleContentQueueUrl: string;
}): DispatchSelectArticleContent {
	return initSqsCommandDispatcher({
		sqsClient: deps.sqsClient,
		queueUrl: deps.selectArticleContentQueueUrl,
		command: SelectArticleContentCommand,
		fifo: {
			messageGroupId: (detail) => articleMessageGroupId(detail.detail),
			deduplicationId: selectionDeduplicationId,
		},
	}).dispatch;
}
