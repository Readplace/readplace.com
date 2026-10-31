import type { ForwardableSender, GmailAccountEmail, GmailMessageUpdateStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

export type DiscardPendingGmailUpdatesForSender = (input: {
	userId: UserId;
	accountEmail: GmailAccountEmail;
	senderEmail: ForwardableSender;
}) => Promise<number>;

export function initDiscardPendingGmailUpdatesForSender(deps: {
	listPendingByAccount: GmailMessageUpdateStore["listPendingByAccount"];
	discardPending: GmailMessageUpdateStore["discardPending"];
}): DiscardPendingGmailUpdatesForSender {
	return async ({ userId, accountEmail, senderEmail }) => {
		const pending = await deps.listPendingByAccount({ userId, accountEmail });
		let discarded = 0;
		for (const update of pending.filter((candidate) => candidate.origin.senderEmail === senderEmail)) {
			if ((await deps.discardPending({ userId, origin: update.origin })) === "discarded") discarded += 1;
		}
		return discarded;
	};
}
