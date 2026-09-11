import type {
	GmailHeldMailStore,
	GmailSenderStore,
} from "@packages/domain/gmail";
import { parseForwardableSender } from "@packages/domain/gmail";
import type { InboxAddress, ParsedEmail } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";

export type RouteGmailForwardedEmail = (input: {
	userId: UserId;
	recipientAddress: InboxAddress;
	purpose: "gmail-forwarding" | "gmail-mapped";
	email: ParsedEmail;
	receivedAtMessageId: string;
	receivedAt: string;
	rawEmailS3Key: string;
}) => Promise<InboxAddress | undefined>;

export function initRouteGmailForwardedEmail(deps: {
	senders: GmailSenderStore;
	heldMail: GmailHeldMailStore;
	logger: HutchLogger;
}): RouteGmailForwardedEmail {
	const { senders, heldMail, logger } = deps;

	return async ({
		userId,
		recipientAddress,
		purpose,
		email,
		receivedAtMessageId,
		receivedAt,
		rawEmailS3Key,
	}) => {
		const senderEmail = parseForwardableSender(email.from);
		if (senderEmail === undefined) {
			logger.warn("[route-gmail-forwarded-email] unreadable sender, delivered as addressed", {
				recipientAddress,
			});
			return recipientAddress;
		}

		if (purpose === "gmail-mapped") {
			const existing = await senders.findSender({ userId, senderEmail });
			if (existing !== undefined) {
				await senders.recordSenderSeen({ userId, senderEmail, subject: email.subject });
			}
			return recipientAddress;
		}

		await senders.recordSenderSeen({ userId, senderEmail, subject: email.subject });
		const sender = await senders.findSender({ userId, senderEmail });
		const mappedAddress = sender?.mappedAddress;
		if (mappedAddress !== undefined) return mappedAddress;

		await heldMail.holdMail({
			userId,
			receivedAtMessageId,
			senderEmail,
			subject: email.subject,
			receivedAt,
			rawEmailS3Key,
			recipientAddress,
		});
		logger.info("[route-gmail-forwarded-email] held an unmapped sender", { senderEmail });
		return undefined;
	};
}
