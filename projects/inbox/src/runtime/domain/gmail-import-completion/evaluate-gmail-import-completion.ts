import { gmailMessageOriginKey } from "@packages/domain/gmail";
import { type EmailImportCompletionStore, type EmailOutputKey, isEmailSavedToAll } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { MarkGmailEmailImportedCommand } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";

export type GmailImportCompletionOutcome = "email-missing" | "not-saved" | "no-gmail-origin" | "mark-requested";

export type EvaluateGmailImportCompletion = (input: {
	userId: UserId;
	receivedAtMessageId: string;
	supplemental?: true;
	savedOutput?: EmailOutputKey;
}) => Promise<GmailImportCompletionOutcome>;

export function initEvaluateGmailImportCompletion(deps: {
	findCompletion: EmailImportCompletionStore["findCompletion"];
	publishEvent: PublishEvent;
}): EvaluateGmailImportCompletion {
	return async ({ userId, receivedAtMessageId, supplemental, savedOutput }) => {
		const completion = await deps.findCompletion({ userId, receivedAtMessageId });
		if (completion === undefined) return "email-missing";
		const followUp = completion.supplementalImport;
		const supplementalSelection = completion.supplementalSelection;
		if (supplemental || (savedOutput !== undefined && supplementalSelection?.outputs.includes(savedOutput))) {
			if (!followUp || !isEmailSavedToAll({ selection: supplementalSelection, savedOutputs: completion.savedOutputs })) {
				return "not-saved";
			}
			await deps.publishEvent(MarkGmailEmailImportedCommand, { userId, receivedAtMessageId, origin: followUp.origin, supplemental: true });
			return "mark-requested";
		}

		if (!isEmailSavedToAll(completion)) return "not-saved";
		// Once a history import accepts new work, its Gmail origin is marked only
		// through that work so an old completion cannot race the new saves.
		const origins = followUp
			? completion.origins.filter((origin) => gmailMessageOriginKey(origin) !== gmailMessageOriginKey(followUp.origin))
			: completion.origins;
		if (origins.length === 0) return "no-gmail-origin";
		for (const origin of origins) {
			await deps.publishEvent(MarkGmailEmailImportedCommand, { userId, receivedAtMessageId, origin });
		}
		return "mark-requested";
	};
}
