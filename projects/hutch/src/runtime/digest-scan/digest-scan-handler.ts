import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";
import type { SendUserDigestCommand } from "@packages/hutch-infra-components";
import type { DispatchCommand } from "@packages/hutch-infra-components/runtime";
import type { ScanPendingDigestUsers } from "@packages/provider-contracts/digest-queue";

export interface DigestScanDeps {
	scanPendingDigestUsers: ScanPendingDigestUsers;
	dispatchSendUserDigest: DispatchCommand<typeof SendUserDigestCommand>;
	logger: HutchLogger;
}

/** Driven by the `rate(6 hours)` scheduler tick (one SQS record per fire). Each
 * record triggers a full scan of the sparse digest-queue table and fans out one
 * `SendUserDigestCommand` per distinct user with a pending article. The record
 * body is an opaque trigger — no payload is parsed. */
export function initDigestScanHandler(deps: DigestScanDeps): Handler<SQSEvent, SQSBatchResponse> {
	const { scanPendingDigestUsers, dispatchSendUserDigest, logger } = deps;

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const users = await scanPendingDigestUsers();
				/* Settle each dispatch independently. A single SendMessage rejection
				 * must not fail the whole tick: a redrive re-scans and re-fans-out to
				 * *every* user (wasteful, and can DLQ the scan). A user whose dispatch
				 * fails keeps their queued rows and is picked up on the next 6h tick. */
				const settled = await Promise.allSettled(
					users.map((userId) => dispatchSendUserDigest({ userId })),
				);
				const rejected = settled.filter(
					(result): result is PromiseRejectedResult => result.status === "rejected",
				);
				if (rejected.length > 0) {
					logger.error("[DigestScan] user-digest dispatches failed; next tick will retry", {
						failed: rejected.length,
						total: users.length,
						errors: rejected.map((result) => result.reason),
					});
				}
				logger.info("[DigestScan] dispatched user digests", {
					users: users.length,
					failed: rejected.length,
				});
			} catch (error) {
				logger.error("[DigestScan] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
