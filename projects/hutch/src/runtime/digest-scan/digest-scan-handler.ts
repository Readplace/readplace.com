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
				await Promise.all(users.map((userId) => dispatchSendUserDigest({ userId })));
				logger.info("[DigestScan] dispatched user digests", { users: users.length });
			} catch (error) {
				logger.error("[DigestScan] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
