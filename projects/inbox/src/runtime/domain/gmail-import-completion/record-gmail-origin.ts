import type { GmailMessageOrigin } from "@packages/domain/gmail";
import type { EmailImportCompletionStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { EvaluateGmailImportCompletion } from "./evaluate-gmail-import-completion";

export type RecordDuplicateGmailOrigin = (input: {
	userId: UserId;
	receivedAtMessageId: string;
	origin: GmailMessageOrigin | undefined;
}) => Promise<void>;

export function initRecordDuplicateGmailOrigin(deps: {
	addGmailOrigins: EmailImportCompletionStore["addGmailOrigins"];
	evaluate: EvaluateGmailImportCompletion;
}): RecordDuplicateGmailOrigin {
	return async ({ userId, receivedAtMessageId, origin }) => {
		if (origin === undefined) return;
		await deps.addGmailOrigins({ userId, receivedAtMessageId, origins: [origin] });
		await deps.evaluate({ userId, receivedAtMessageId });
	};
}
