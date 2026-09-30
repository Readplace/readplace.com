import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	GmailAccountEmailSchema,
	type GmailHistoryImportStore,
	GmailHistoryImportJobIdSchema,
	GmailMessageIdSchema,
	ForwardableSenderSchema,
	parseForwardableSender,
} from "@packages/domain/gmail";
import {
	InboxAddressSchema,
	type InboxAddressStore,
	normalizeMessageId,
	type ParseEmailResult,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import {
	type GmailHistoryImportMessageFetchedDetail,
	GmailHistoryImportMessageFetchedEvent,
	type GmailHistoryImportMessageIngestedDetail,
	GmailHistoryImportMessageIngestedEvent,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DownloadEmailImages } from "./download-email-images";
import type { IngestParsedEmail } from "./ingest-parsed-email";
import type { ResolveEmailIdentity } from "./resolve-email-identity";

type IngestionOutcome = Pick<GmailHistoryImportMessageIngestedDetail, "outcome" | "receivedAtMessageId">;

export function initIngestGmailImportHandler(deps: {
	readRawEmail: (s3Key: string) => Promise<Buffer | undefined>;
	parseEmail: (input: { raw: Buffer; receivedAt: string }) => Promise<ParseEmailResult>;
	findByAddress: InboxAddressStore["findByAddress"];
	findImportJob: GmailHistoryImportStore["findJob"];
	downloadEmailImages: DownloadEmailImages;
	resolveIdentity: ResolveEmailIdentity;
	ingest: IngestParsedEmail;
	publishEvent: PublishEvent;
	maxEmailBytes: number;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { readRawEmail, parseEmail, findByAddress, findImportJob, downloadEmailImages, resolveIdentity, ingest, publishEvent, logger } = deps;

	const ingestFetchedMessage = async (detail: GmailHistoryImportMessageFetchedDetail): Promise<IngestionOutcome> => {
		const userId = UserIdSchema.parse(detail.userId);
		const jobId = GmailHistoryImportJobIdSchema.parse(detail.jobId);
		const job = await findImportJob({ userId, jobId });
		if (job?.state !== "running" || job.generation !== detail.generation) {
			return { outcome: "cancelled", receivedAtMessageId: undefined };
		}

		const raw = await readRawEmail(detail.rawEmailS3Key);
		assert(raw !== undefined, "an imported raw email is written before its fetched event is published");
		assert(raw.byteLength <= deps.maxEmailBytes, `imported email ${detail.rawEmailS3Key} exceeds the inbox size cap`);
		const parsed = await parseEmail({ raw, receivedAt: detail.internalDate });
		assert(parsed.ok, `imported email ${detail.rawEmailS3Key} is unparseable`);

		const sender = parseForwardableSender(parsed.email.from);
		if (sender !== ForwardableSenderSchema.parse(detail.senderEmail)) {
			return { outcome: "skipped-sender-mismatch", receivedAtMessageId: undefined };
		}
		const normalizedMessageId = normalizeMessageId(parsed.email.messageId);
		if (normalizedMessageId === undefined) {
			return { outcome: "skipped-no-message-id", receivedAtMessageId: undefined };
		}

		const destinationAddress = InboxAddressSchema.parse(detail.destinationAddress);
		const destination = await findByAddress(destinationAddress);
		if (destination === undefined || destination.disabledAt !== undefined || destination.userId !== userId) {
			return { outcome: "cancelled", receivedAtMessageId: undefined };
		}

		const resolution = await resolveIdentity({
			userId,
			sender,
			messageId: parsed.email.messageId,
			normalizedMessageId,
			proposedReceivedAtMessageId: `${detail.internalDate}#${parsed.email.messageId}`,
			attempt: {
				origin: "gmail-import",
				jobId,
				accountEmail: GmailAccountEmailSchema.parse(detail.accountEmail),
				gmailMessageId: GmailMessageIdSchema.parse(detail.gmailMessageId),
			},
		});
		if (!resolution.proceed) return { outcome: "already-imported", receivedAtMessageId: undefined };

		await ingest({
			userId,
			destination: destinationAddress,
			email: parsed.email,
			receivedAt: detail.internalDate,
			rawEmailS3Key: detail.rawEmailS3Key,
			receivedAtMessageId: resolution.receivedAtMessageId,
			downloadedImages: await downloadEmailImages({ html: parsed.email.html }),
			origin: "gmail-import",
		});
		return { outcome: "imported", receivedAtMessageId: resolution.receivedAtMessageId };
	};

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const detail = GmailHistoryImportMessageFetchedEvent.detailSchema.parse(JSON.parse(record.body).detail);
				const { outcome, receivedAtMessageId } = await ingestFetchedMessage(detail);
				await publishEvent(GmailHistoryImportMessageIngestedEvent, {
					userId: detail.userId,
					jobId: detail.jobId,
					generation: detail.generation,
					gmailMessageId: detail.gmailMessageId,
					outcome,
					receivedAtMessageId,
				});
				logger.info("[ingest-gmail-import] ingested", { jobId: detail.jobId, outcome });
			} catch (error) {
				logger.error("[ingest-gmail-import] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
