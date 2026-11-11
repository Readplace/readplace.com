import { createHash } from "node:crypto";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { GenerateSummaryCommand } from "@packages/infra-components";
import { type DispatchCommand, initSqsCommandDispatcher } from "@packages/infra-components/runtime";

export type DispatchGenerateSummary = DispatchCommand<typeof GenerateSummaryCommand>;

export function articleMessageGroupId(detail: { url: string }): string {
	return createHash("sha256").update(ArticleResourceUniqueId.parse(detail.url).value).digest("hex");
}

export function initGenerateSummaryDispatch(deps: {
	sqsClient: Pick<SQSClient, "send">;
	generateSummaryQueueUrl: string;
}): DispatchGenerateSummary {
	return initSqsCommandDispatcher({
		sqsClient: deps.sqsClient,
		queueUrl: deps.generateSummaryQueueUrl,
		command: GenerateSummaryCommand,
		fifo: { messageGroupId: articleMessageGroupId },
	}).dispatch;
}
