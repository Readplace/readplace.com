import { type EmailImportCompletionStore, isEmailSavedToAll } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { MarkGmailEmailImportedCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";

export type GmailImportCompletionOutcome = "email-missing" | "not-saved" | "no-gmail-origin" | "mark-requested";

export type EvaluateGmailImportCompletion = (input: {
	userId: UserId;
	receivedAtMessageId: string;
}) => Promise<GmailImportCompletionOutcome>;

export function initEvaluateGmailImportCompletion(deps: {
	findCompletion: EmailImportCompletionStore["findCompletion"];
	publishEvent: PublishEvent;
}): EvaluateGmailImportCompletion {
	return async ({ userId, receivedAtMessageId }) => {
		const completion = await deps.findCompletion({ userId, receivedAtMessageId });
		if (completion === undefined) return "email-missing";
		if (!isEmailSavedToAll(completion)) return "not-saved";
		if (completion.origins.length === 0) return "no-gmail-origin";
		for (const origin of completion.origins) {
			await deps.publishEvent(MarkGmailEmailImportedCommand, { userId, receivedAtMessageId, origin });
		}
		return "mark-requested";
	};
}
