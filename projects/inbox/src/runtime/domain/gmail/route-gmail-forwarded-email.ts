import {
	type GmailDeliveryMode,
	type GmailHeldMailStore,
	type GmailSenderStore,
	LEGACY_DELIVERY_MODE,
	parseForwardableSender,
	resolveGmailDeliveryMode,
} from "@packages/domain/gmail";
import type { InboxAddress, ParsedEmail } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";

export interface GmailDelivery {
	destinationAddresses: [InboxAddress, ...InboxAddress[]];
	deliveryMode: GmailDeliveryMode;
}

export type RouteGmailForwardedEmail = (input: {
	userId: UserId;
	recipientAddress: InboxAddress;
	purpose: "gmail-forwarding" | "gmail-mapped";
	email: ParsedEmail;
	receivedAtMessageId: string;
	receivedAt: string;
	rawEmailS3Key: string;
}) => Promise<GmailDelivery | undefined>;

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
			logger.warn(
				"[route-gmail-forwarded-email] unreadable sender, delivered as addressed",
				{
					userId,
				},
			);
			return { destinationAddresses: [recipientAddress], deliveryMode: LEGACY_DELIVERY_MODE };
		}

		if (purpose === "gmail-mapped") {
			const existing = await senders.findSender({ userId, senderEmail });
			if (existing === undefined) {
				return { destinationAddresses: [recipientAddress], deliveryMode: LEGACY_DELIVERY_MODE };
			}
			await senders.recordSenderSeen({
				userId,
				senderEmail,
				subject: email.subject,
			});
			return {
				destinationAddresses: existing.mappedAddresses ?? [recipientAddress],
				deliveryMode: resolveGmailDeliveryMode(existing),
			};
		}

		await senders.recordSenderSeen({
			userId,
			senderEmail,
			subject: email.subject,
		});
		const sender = await senders.findSender({ userId, senderEmail });
		if (sender?.mappedAddresses !== undefined) {
			return { destinationAddresses: sender.mappedAddresses, deliveryMode: resolveGmailDeliveryMode(sender) };
		}

		await heldMail.holdMail({
			userId,
			receivedAtMessageId,
			senderEmail,
			subject: email.subject,
			receivedAt,
			rawEmailS3Key,
			recipientAddress,
		});
		logger.info("[route-gmail-forwarded-email] held an unmapped sender", {
			userId,
		});
		return undefined;
	};
}
