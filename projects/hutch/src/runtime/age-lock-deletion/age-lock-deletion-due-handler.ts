import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { initSqsRecordHandler } from "@packages/infra-components/runtime";
import { AgeLockDeletionDueCommand } from "@packages/infra-components";
import type { UserId } from "@packages/domain/user";
import type { Logger } from "@packages/logger";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type { DeleteAccount } from "../domain/account/delete-account";

export interface AgeLockDeletionDueHandlerDependencies {
	findUserById: FindUserById;
	deleteAccount: DeleteAccount;
	logger: Logger;
}

type AgeLockDeletionOutcome = "user-missing" | "already-deleted" | "not-locked" | "deleted";

async function processCommand(
	userId: UserId,
	deps: AgeLockDeletionDueHandlerDependencies,
): Promise<AgeLockDeletionOutcome> {
	const user = await deps.findUserById(userId);
	if (!user) return "user-missing";
	if (user.deletedAt !== undefined) return "already-deleted";
	if (user.ageLockedAt === undefined) return "not-locked";
	await deps.deleteAccount(userId);
	return "deleted";
}

export function initAgeLockDeletionDueHandler(
	deps: AgeLockDeletionDueHandlerDependencies,
): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: AgeLockDeletionDueCommand,
		logger: deps.logger,
		failure: { message: "[age-lock-deletion] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const outcome = await processCommand(detail.userId, deps);
			deps.logger.info("[age-lock-deletion] completed", { userId: detail.userId, outcome });
		},
	});
}
