import assert from "node:assert";
import type { GmailMessageOrigin } from "@packages/domain/gmail";
import {
	type EmailImportCompletionStore,
	type EmailOutputKey,
	type EmailOutputSelection,
	type InboxEmailStore,
	uniqueGmailOrigins,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";

interface CompletionAttributes {
	selection: EmailOutputSelection | undefined;
	savedOutputs: Set<EmailOutputKey>;
	origins: GmailMessageOrigin[];
}

export function initInMemoryEmailImportCompletion(deps: {
	getEmail: InboxEmailStore["getEmail"];
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
		addGmailOrigins: async (input) => {
			if (input.origins.length === 0) return;
			const current = await existing(input);
			assert(current, "Gmail origins are added to an existing email row");
			current.origins = uniqueGmailOrigins([...current.origins, ...input.origins]);
		},
		selectOutputs: async (input) => {
			const current = await existing(input);
			assert(current, "a selection is stored on an existing email row");
			current.selection ??= input.selection;
			return current.selection;
		},
		acknowledgeOutput: async (input) => {
			const current = await existing(input);
			current?.savedOutputs.add(input.output);
		},
		findCompletion: async (input) => {
			const current = await existing(input);
			if (current === undefined) return undefined;
			return { selection: current.selection, savedOutputs: new Set(current.savedOutputs), origins: [...current.origins] };
		},
	};
}
