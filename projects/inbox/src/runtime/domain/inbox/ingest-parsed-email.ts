import assert from "node:assert";
import {
	type InboxAddress,
	InboxAddressSchema,
	type InboxEmailStore,
	type ParsedEmail,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import {
	type EmailReceivedDetail,
	EmailReceivedEvent,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DownloadedEmailImage } from "./download-email-images";
import type { StoreEmailBody } from "./store-email-body";

export type IngestParsedEmail = (input: {
	userId: UserId;
	destination: InboxAddress;
	email: ParsedEmail;
	receivedAt: string;
	rawEmailS3Key: string;
	receivedAtMessageId: string;
	downloadedImages: DownloadedEmailImage[];
	origin: EmailReceivedDetail["origin"];
	routing: EmailReceivedDetail["routing"];
}) => Promise<"stored" | "duplicate" | "unparsed">;

export function initIngestParsedEmail(deps: {
	storeBody: StoreEmailBody;
	putEmail: InboxEmailStore["putEmail"];
	getEmail: InboxEmailStore["getEmail"];
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): IngestParsedEmail {
	const { storeBody, putEmail, getEmail, publishEvent, logger } = deps;

	return async ({
		userId,
		destination,
		email,
		receivedAt,
		rawEmailS3Key,
		receivedAtMessageId,
		downloadedImages,
		origin,
		routing,
	}) => {
		const gmailDestinationAddresses:
			| [InboxAddress, ...InboxAddress[]]
			| undefined =
			routing.kind === "gmail"
				? [
						InboxAddressSchema.parse(routing.destinationAddresses[0]),
						...routing.destinationAddresses
							.slice(1)
							.map((address) => InboxAddressSchema.parse(address)),
					]
				: undefined;
		const row = {
			userId,
			receivedAtMessageId,
			messageId: email.messageId,
			recipientAddress: destination,
			senderEmail: email.from,
			subject: email.subject,
			receivedAt,
			rawEmailS3Key,
			linkCounts: undefined,
			...(gmailDestinationAddresses === undefined
				? {}
				: { gmailDestinationAddresses }),
		};
		const bodyS3Key = await storeBody({
			userId,
			receivedAtMessageId,
			html: email.html,
			inlineImages: email.inlineImages,
			downloadedImages,
		});
		if (bodyS3Key === undefined) {
			await putEmail({ ...row, status: "unparsed", bodyS3Key: undefined });
			logger.warn("[ingest-parsed-email] empty body after sanitize", {
				receivedAtMessageId,
			});
			return "unparsed";
		}
		const outcome = await putEmail({ ...row, status: "received", bodyS3Key });
		const accepted =
			outcome === "stored"
				? row
				: await getEmail({ userId, receivedAtMessageId });
		assert(accepted, "duplicate accepted email row is present");
		const acceptedRouting: EmailReceivedDetail["routing"] =
			accepted.gmailDestinationAddresses === undefined
				? routing
				: {
						kind: "gmail",
						destinationAddresses: accepted.gmailDestinationAddresses,
					};
		await publishEvent(EmailReceivedEvent, {
			userId,
			receivedAtMessageId,
			recipientAddress: accepted.recipientAddress,
			origin,
			routing: acceptedRouting,
		});
		logger.info("[ingest-parsed-email] stored", {
			receivedAtMessageId,
			outcome,
			origin,
		});
		return outcome;
	};
}
