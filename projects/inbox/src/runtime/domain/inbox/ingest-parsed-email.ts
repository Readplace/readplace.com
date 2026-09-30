import { type EmailReceivedDetail, EmailReceivedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { InboxAddress, InboxEmailStore, ParsedEmail } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
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
}) => Promise<"stored" | "duplicate" | "unparsed">;

export function initIngestParsedEmail(deps: {
	storeBody: StoreEmailBody;
	putEmail: InboxEmailStore["putEmail"];
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): IngestParsedEmail {
	const { storeBody, putEmail, publishEvent, logger } = deps;

	return async ({ userId, destination, email, receivedAt, rawEmailS3Key, receivedAtMessageId, downloadedImages, origin }) => {
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
			logger.warn("[ingest-parsed-email] empty body after sanitize", { receivedAtMessageId });
			return "unparsed";
		}
		const outcome = await putEmail({ ...row, status: "received", bodyS3Key });
		await publishEvent(EmailReceivedEvent, {
			userId,
			receivedAtMessageId,
			recipientAddress: destination,
			origin,
		});
		logger.info("[ingest-parsed-email] stored", { receivedAtMessageId, outcome, origin });
		return outcome;
	};
}
