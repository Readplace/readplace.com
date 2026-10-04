import type { InboxEmailStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { type EmailReceivedDetail, EmailReceivedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";

export type ResumeAcceptedGmailEmail = (input: {
	userId: UserId;
	receivedAtMessageId: string;
	rawEmailS3Key: string;
	origin: EmailReceivedDetail["origin"];
}) => Promise<boolean>;

export function initResumeAcceptedGmailEmail(deps: {
	getEmail: InboxEmailStore["getEmail"];
	publishEvent: PublishEvent;
}): ResumeAcceptedGmailEmail {
	return async ({ userId, receivedAtMessageId, rawEmailS3Key, origin }) => {
		const email = await deps.getEmail({ userId, receivedAtMessageId });
		if (email?.status !== "received" || email.gmailDestinationAddresses === undefined || email.rawEmailS3Key !== rawEmailS3Key) return false;
		await deps.publishEvent(EmailReceivedEvent, {
			userId,
			receivedAtMessageId,
			recipientAddress: email.recipientAddress,
			origin,
			routing: { kind: "gmail", destinationAddresses: email.gmailDestinationAddresses },
		});
		return true;
	};
}
