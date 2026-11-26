import assert from "node:assert";
import { createHash } from "node:crypto";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { emailMatchBatch, linkOutputKey, outputLinkOrdinal, type EmailImportCompletionStore, type InboxEmailLinkStore, type InboxEmailStore, type InboxReadlistOutcome } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { EmailOutputsSelectedEvent, SubmitLinkCommand } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";

export function initDeliverIssueMatches(deps: {
	findCompletion: EmailImportCompletionStore["findCompletion"];
	amendSelection: EmailImportCompletionStore["amendSelection"];
	getEmail: InboxEmailStore["getEmail"];
	getLink: InboxEmailLinkStore["getLink"];
	publishEvent: PublishEvent;
}) {
	return async ({ userId, receivedAtMessageId, outcome }: { userId: UserId; receivedAtMessageId: string; outcome: InboxReadlistOutcome }) => {
		const key = { userId, receivedAtMessageId };
		const batch = emailMatchBatch(outcome.readlist, outcome.startIndex ?? 0);
		const completion = await deps.findCompletion(key);
		if (completion?.selection?.matches?.[batch] === undefined) return;
		const outputs = outcome.fit.filter(({ verdict }) => verdict === "keep").map(({ ordinal }) => linkOutputKey(ordinal));
		const selection = await deps.amendSelection({ ...key, change: { kind: "match", batch, outputs } });
		const assigned = selection.matches?.[batch];
		assert(assigned, "a resolved preference batch owns its selected outputs");
		const outstanding = assigned.filter((output) => !completion.savedOutputs.has(output));
		if (outstanding.length > 0) {
			const email = await deps.getEmail(key);
			assert(email, "a matched output belongs to a stored email");
			for (const outputKey of outstanding) {
				const ordinal = outputLinkOrdinal(outputKey);
				assert(ordinal, "a preference match selects an article link");
				const link = await deps.getLink({ ...key, ordinal });
				assert(link, "a matching article has an extracted link");
				const attempt = createHash("sha256").update(JSON.stringify([userId, receivedAtMessageId, outputKey])).digest("hex");
				await deps.publishEvent(SubmitLinkCommand, {
					userId, url: link.url, provenance: { kind: "email", senderEmail: email.senderEmail },
					readlist: DEFAULT_READLIST_SLUG, requestedAt: email.receivedAt, saveTrigger: "automatic", saveAttemptId: SaveAttemptIdSchema.parse(attempt),
					emailOutput: { receivedAtMessageId, outputKey },
				});
			}
		}
		await deps.publishEvent(EmailOutputsSelectedEvent, { ...key, outputCount: selection.outputs.length });
	};
}
