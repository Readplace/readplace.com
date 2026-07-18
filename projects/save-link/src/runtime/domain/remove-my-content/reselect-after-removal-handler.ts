import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import { ReselectAfterRemovalEvent } from "@packages/hutch-infra-components";
import { initSelectMostCompleteContentHandler } from "../select-content/select-most-complete-content-handler";

/**
 * Runs the ordinary tier-selection core over the sources that survive a
 * removal, by normalizing each record into the shape that core parses:
 *
 * 1. No `userId`, so a canonical flip publishes only the content-changed and
 *    crawl-completed facts — never a "saved!" notification at the remover.
 * 2. `tier-1` as the nominal fresh tier: a post-removal tie can only involve
 *    tier-1 (a removal that leaves two sources always leaves the crawler's
 *    copy), and the selector's tie-break needs a member of the candidate set.
 * 3. No `extractedAt`: nothing was freshly extracted; the selector anchors any
 *    new version snapshot to its own clock.
 */
export function initReselectAfterRemovalHandler(deps: {
	selectDeps: Parameters<typeof initSelectMostCompleteContentHandler>[0];
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const selectCore = initSelectMostCompleteContentHandler(deps.selectDeps);

	return async (event, context, callback): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		const normalized: SQSRecord[] = [];

		for (const record of event.Records) {
			try {
				const envelope = JSON.parse(record.body);
				const detail = ReselectAfterRemovalEvent.detailSchema.parse(envelope.detail);
				normalized.push({
					...record,
					body: JSON.stringify({ detail: { url: detail.url, tier: "tier-1" } }),
				});
			} catch (error) {
				deps.logger.error("[ReselectAfterRemoval] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		const response = await selectCore({ Records: normalized }, context, callback);
		assert(response, "the selection core always resolves with a batch response");
		return {
			batchItemFailures: [...batchItemFailures, ...response.batchItemFailures],
		};
	};
}
