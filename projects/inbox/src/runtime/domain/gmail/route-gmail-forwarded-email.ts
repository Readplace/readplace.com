import {
	type GmailConnectionStore,
	type GmailDeliveryMode,
	type GmailHeldMailStore,
	type GmailMappingStore,
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
	connections: Pick<GmailConnectionStore, "findConnectionByUserId">;
	mappings: Pick<GmailMappingStore, "findMapping">;
	senders: Pick<GmailSenderStore, "recordSenderSeen">;
	heldMail: GmailHeldMailStore;
	logger: HutchLogger;
}): RouteGmailForwardedEmail {
	const { connections, mappings, senders, heldMail, logger } = deps;

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

		const findConnectedMapping = async () => {
			const accountEmail = (await connections.findConnectionByUserId(userId))?.accountEmail;
			return accountEmail === undefined ? undefined : mappings.findMapping({ userId, accountEmail, senderEmail });
		};

		if (purpose === "gmail-mapped") {
			const existing = await findConnectedMapping();
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
		const mapping = await findConnectedMapping();
		if (mapping?.mappedAddresses !== undefined) {
			return { destinationAddresses: mapping.mappedAddresses, deliveryMode: resolveGmailDeliveryMode(mapping) };
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
