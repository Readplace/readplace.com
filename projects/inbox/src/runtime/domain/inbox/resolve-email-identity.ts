import assert from "node:assert";
import { type ForwardableSender, parseForwardableSender } from "@packages/domain/gmail";
import {
	type EmailIdentityKey,
	type EmailIdentityStore,
	type IngestionAttempt,
	type InboxEmailStore,
	type MessageId,
	messageIdentityKey,
	type NormalizedMessageId,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";

type EmailIdentityResolution =
	| { proceed: true; receivedAtMessageId: string }
	| { proceed: false; reason: "already-ingested" };

export type ResolveEmailIdentity = (input: {
	userId: UserId;
	sender: ForwardableSender;
	messageId: MessageId;
	normalizedMessageId: NormalizedMessageId;
	proposedReceivedAtMessageId: string;
	attempt: IngestionAttempt;
}) => Promise<EmailIdentityResolution>;

export function initResolveEmailIdentity(deps: {
	identities: EmailIdentityStore;
	findReceivedByMessageId: InboxEmailStore["findReceivedByMessageId"];
	getEmail: InboxEmailStore["getEmail"];
	now: () => Date;
}): ResolveEmailIdentity {
	const { identities, findReceivedByMessageId, getEmail, now } = deps;

	const adoptPreClaimRow = async (input: {
		userId: UserId;
		sender: ForwardableSender;
		messageId: MessageId;
		key: EmailIdentityKey;
	}): Promise<boolean> => {
		const rows = await findReceivedByMessageId({ userId: input.userId, messageId: input.messageId });
		const row = rows.find((candidate) => parseForwardableSender(candidate.senderEmail) === input.sender);
		if (row === undefined) return false;
		await identities.claim({
			key: input.key,
			userId: input.userId,
			receivedAtMessageId: row.receivedAtMessageId,
			attempt: { origin: "pre-claim-row" },
			now: now(),
		});
		return true;
	};

	return async ({ userId, sender, messageId, normalizedMessageId, proposedReceivedAtMessageId, attempt }) => {
		const key = messageIdentityKey({ userId, sender, messageId: normalizedMessageId });
		const existing = await identities.find(key);
		if (existing === undefined && (await adoptPreClaimRow({ userId, sender, messageId, key }))) {
			return { proceed: false, reason: "already-ingested" };
		}

		const result = await identities.claim({
			key,
			userId,
			receivedAtMessageId: proposedReceivedAtMessageId,
			attempt,
			now: now(),
		});
		if (result.status !== "claimed-elsewhere") {
			return { proceed: true, receivedAtMessageId: result.claim.receivedAtMessageId };
		}

		const row = await getEmail({ userId, receivedAtMessageId: result.claim.receivedAtMessageId });
		if (row !== undefined) return { proceed: false, reason: "already-ingested" };

		const tookOver = await identities.takeOver({ previous: result.claim, attempt, now: now() });
		assert(tookOver, "another ingestion attempt took over this email identity first");
		return { proceed: true, receivedAtMessageId: result.claim.receivedAtMessageId };
	};
}
