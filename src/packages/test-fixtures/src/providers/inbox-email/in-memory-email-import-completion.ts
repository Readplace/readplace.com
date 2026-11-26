import assert from "node:assert";
import type { GmailMessageOrigin } from "@packages/domain/gmail";
import {
	type EmailImportCompletionStore,
	type EmailOutputKey,
	type EmailOutputSelection,
	type InboxEmailStore,
	missingEmailDeliveryMode,
	type SupplementalEmailImport,
	uniqueGmailOrigins,
	amendEmailSelection,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";

interface CompletionAttributes {
	supplementalImport?: SupplementalEmailImport;
	supplementalSelection?: EmailOutputSelection;
	selection: EmailOutputSelection | undefined;
	savedOutputs: Set<EmailOutputKey>;
	origins: GmailMessageOrigin[];
}

export function initInMemoryEmailImportCompletion(deps: {
	getEmail: InboxEmailStore["getEmail"];
	listEmailsByUserId: InboxEmailStore["listEmailsByUserId"];
}): EmailImportCompletionStore {
	const attributes = new Map<string, CompletionAttributes>();
	const existing = async (input: { userId: UserId; receivedAtMessageId: string }): Promise<CompletionAttributes | undefined> => {
		if ((await deps.getEmail(input)) === undefined) return undefined;
		const key = `${input.userId}#${input.receivedAtMessageId}`;
		const current = attributes.get(key) ?? { selection: undefined, savedOutputs: new Set<EmailOutputKey>(), origins: [] };
		attributes.set(key, current);
		return current;
	};

	return {
		claimSupplementalImport: async ({ userId, receivedAtMessageId, requested, work }) => {
			const key = { userId, receivedAtMessageId };
			const email = await deps.getEmail(key);
			const current = await existing(key);
			if (email?.status !== "received" || current === undefined) return undefined;
			if (current.supplementalImport !== undefined) {
				return current.supplementalImport.rawEmailS3Key === work.rawEmailS3Key ? current.supplementalImport : undefined;
			}
			const deliveryMode = missingEmailDeliveryMode({ requested, accepted: email.gmailDeliveryMode, selection: current.selection });
			if (deliveryMode === undefined) return undefined;
			current.supplementalImport = { ...work, deliveryMode };
			return current.supplementalImport;
		},
		addGmailOrigins: async (input) => {
			if (input.origins.length === 0) return;
			const current = await existing(input);
			assert(current, "Gmail origins are added to an existing email row");
			current.origins = uniqueGmailOrigins([...current.origins, ...input.origins]);
		},
		selectOutputs: async (input) => {
			const current = await existing(input);
			assert(current, "a selection is stored on an existing email row");
			if (input.supplemental) {
				current.supplementalSelection ??= input.selection;
				return current.supplementalSelection;
			}
			current.selection ??= input.selection;
			return current.selection;
		},
		amendSelection: async (input) => {
			const current = await existing(input);
			assert(current?.selection, "matching and continuations follow output selection");
			current.selection = amendEmailSelection(current.selection, input.change);
			return current.selection;
		},
		acknowledgeOutput: async (input) => {
			const current = await existing(input);
			current?.savedOutputs.add(input.output);
		},
		findCompletion: async (input) => {
			const current = await existing(input);
			if (current === undefined) return undefined;
			return { ...current, savedOutputs: new Set(current.savedOutputs), origins: [...current.origins] };
		},
		listCompletionsBefore: async ({ userId, before, limit }) => {
			const page = await deps.listEmailsByUserId({
				userId,
				cursor: { direction: "older", receivedAtMessageId: before },
				pageSize: limit,
			});
			const emails = [];
			for (const email of page.emails) {
				const current = await existing(email);
				assert(current, "a listed email row exists");
				emails.push({
					receivedAtMessageId: email.receivedAtMessageId,
					messageId: email.messageId,
					senderEmail: email.senderEmail,
					status: email.status,
					gmailDestinationAddresses: email.gmailDestinationAddresses,
					gmailDeliveryMode: email.gmailDeliveryMode,
					selection: current.selection,
					savedOutputs: new Set(current.savedOutputs),
					origins: [...current.origins],
				});
			}
			return { emails, exhausted: !page.hasOlder };
		},
	};
}
