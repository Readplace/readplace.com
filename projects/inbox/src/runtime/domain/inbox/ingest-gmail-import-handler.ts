import assert from "node:assert";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailMessageOrigin,
	type GmailHistoryImportJob,
	GmailHistoryImportJobIdSchema,
	type GmailHistoryImportStore,
	GmailMessageIdSchema,
	parseForwardableSender,
} from "@packages/domain/gmail";
import {
	InboxAddressSchema,
	type InboxAddressStore,
	normalizeMessageId,
	type ParseEmailResult,
} from "@packages/domain/inbox";
import {
	type GmailHistoryImportMessageFetchedDetail,
	GmailHistoryImportMessageFetchedEvent,
	type GmailHistoryImportMessageIngestedDetail,
	GmailHistoryImportMessageIngestedEvent,
} from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { RecordDuplicateGmailOrigin } from "../gmail-import-completion/record-gmail-origin";
import type { DownloadEmailImages } from "./download-email-images";
import type { IngestParsedEmail } from "./ingest-parsed-email";
import type { ResumeAcceptedGmailEmail } from "./resume-accepted-gmail-email";
import type { ResolveEmailIdentity } from "./resolve-email-identity";

type IngestionOutcome = Pick<
	GmailHistoryImportMessageIngestedDetail,
	"outcome" | "receivedAtMessageId"
>;

export function initIngestGmailImportHandler(deps: {
	readRawEmail: (s3Key: string) => Promise<Buffer | undefined>;
	deleteRawEmail: (s3Key: string) => Promise<void>;
	parseEmail: (input: {
		raw: Buffer;
		receivedAt: string;
	}) => Promise<ParseEmailResult>;
	findByAddress: InboxAddressStore["findByAddress"];
	findImportJob: GmailHistoryImportStore["findJob"];
	downloadEmailImages: DownloadEmailImages;
	resolveIdentity: ResolveEmailIdentity;
	ingest: IngestParsedEmail;
	resumeAcceptedGmailEmail: ResumeAcceptedGmailEmail;
	recordDuplicateGmailOrigin: RecordDuplicateGmailOrigin;
	publishEvent: PublishEvent;
	maxEmailBytes: number;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const {
		readRawEmail,
		deleteRawEmail,
		parseEmail,
		findByAddress,
		findImportJob,
		downloadEmailImages,
		resolveIdentity,
		ingest,
		resumeAcceptedGmailEmail,
		recordDuplicateGmailOrigin,
		publishEvent,
		logger,
	} = deps;

	const decideFetchedMessage = async (input: {
		detail: GmailHistoryImportMessageFetchedDetail;
		job: GmailHistoryImportJob;
		raw: Buffer | undefined;
	}): Promise<IngestionOutcome & { rawDisposable: boolean }> => {
		const { detail, job, raw } = input;
		const { userId, jobId } = job;

		const destinations = new Set(detail.destinationAddresses);
		const currentRun = job.state === "running" && job.generation === detail.generation;
		const currentSelection = destinations.size === new Set(job.destinationAddresses).size && job.destinationAddresses.every((address) => destinations.has(address));
		const mayIngest = currentRun && currentSelection;

		if (raw === undefined && !mayIngest) return { outcome: "cancelled", receivedAtMessageId: undefined, rawDisposable: false };
		assert(
			raw !== undefined,
			"an imported raw email is written before its fetched event is published",
		);
		if (raw.byteLength > deps.maxEmailBytes && !mayIngest) return { outcome: "cancelled", receivedAtMessageId: undefined, rawDisposable: true };
		assert(
			raw.byteLength <= deps.maxEmailBytes,
			`imported email ${detail.rawEmailS3Key} exceeds the inbox size cap`,
		);
		const parsed = await parseEmail({ raw, receivedAt: detail.internalDate });
		if (!parsed.ok && !mayIngest) return { outcome: "cancelled", receivedAtMessageId: undefined, rawDisposable: true };
		assert(parsed.ok, `imported email ${detail.rawEmailS3Key} is unparseable`);

		const sender = parseForwardableSender(parsed.email.from);
		if (sender !== ForwardableSenderSchema.parse(detail.senderEmail)) {
			return {
				outcome: mayIngest ? "skipped-sender-mismatch" : "cancelled",
				receivedAtMessageId: undefined,
				rawDisposable: true,
			};
		}
		const normalizedMessageId = normalizeMessageId(parsed.email.messageId);
		if (normalizedMessageId === undefined) {
			return {
				outcome: mayIngest ? "skipped-no-message-id" : "cancelled",
				receivedAtMessageId: undefined,
				rawDisposable: true,
			};
		}

		const gmailOrigin: GmailMessageOrigin = {
			kind: "history",
			accountEmail: GmailAccountEmailSchema.parse(detail.accountEmail),
			gmailMessageId: GmailMessageIdSchema.parse(detail.gmailMessageId),
			senderEmail: sender,
		};
		const proposedReceivedAtMessageId = `${detail.internalDate}#${parsed.email.messageId}`;
		if (await resumeAcceptedGmailEmail({ userId, receivedAtMessageId: proposedReceivedAtMessageId, rawEmailS3Key: detail.rawEmailS3Key, origin: "gmail-import", gmailOrigin })) {
			return { outcome: "imported", receivedAtMessageId: proposedReceivedAtMessageId, rawDisposable: false };
		}
		if (!mayIngest) return { outcome: "cancelled", receivedAtMessageId: undefined, rawDisposable: false };

		const [destinationAddress, ...additionalAddresses] =
			detail.destinationAddresses.map((address) =>
				InboxAddressSchema.parse(address),
			);
		assert(destinationAddress, "Gmail destinations are nonempty");
		for (const address of [destinationAddress, ...additionalAddresses]) {
			const destination = await findByAddress(address);
			if (
				destination === undefined ||
				destination.disabledAt !== undefined ||
				destination.userId !== userId
			) {
				return { outcome: "cancelled", receivedAtMessageId: undefined, rawDisposable: false };
			}
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
				accountEmail: gmailOrigin.accountEmail,
				gmailMessageId: gmailOrigin.gmailMessageId,
			},
		});
		if (!resolution.proceed) {
			await recordDuplicateGmailOrigin({ userId, receivedAtMessageId: resolution.receivedAtMessageId, origin: gmailOrigin });
			return { outcome: "already-imported", receivedAtMessageId: undefined, rawDisposable: true };
		}

		await ingest({
			userId,
			destination: destinationAddress,
			email: parsed.email,
			receivedAt: detail.internalDate,
			rawEmailS3Key: detail.rawEmailS3Key,
			receivedAtMessageId: resolution.receivedAtMessageId,
			downloadedImages: await downloadEmailImages({ html: parsed.email.html }),
			origin: "gmail-import",
			routing: {
				kind: "gmail",
				destinationAddresses: [destinationAddress, ...additionalAddresses],
				deliveryMode: detail.deliveryMode,
			},
			gmailOrigin,
		});
		return {
			outcome: "imported",
			receivedAtMessageId: resolution.receivedAtMessageId,
			rawDisposable: false,
		};
	};

	const ingestFetchedMessage = async (
		detail: GmailHistoryImportMessageFetchedDetail,
	): Promise<IngestionOutcome & { rawDisposable: boolean }> => {
		const job = await findImportJob({ userId: detail.userId, jobId: GmailHistoryImportJobIdSchema.parse(detail.jobId) });
		if (job === undefined) return { outcome: "cancelled", receivedAtMessageId: undefined, rawDisposable: false };
		const raw = await readRawEmail(detail.rawEmailS3Key);
		const decided = await decideFetchedMessage({ detail, job, raw });
		return { ...decided, rawDisposable: decided.rawDisposable && job.generation === detail.generation };
	};

	return initSqsRecordHandler({
		definition: GmailHistoryImportMessageFetchedEvent,
		logger,
		failure: { message: "[ingest-gmail-import] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail) => {
			const { outcome, receivedAtMessageId, rawDisposable } = await ingestFetchedMessage(detail);
			await publishEvent(GmailHistoryImportMessageIngestedEvent, {
				userId: detail.userId,
				jobId: detail.jobId,
				generation: detail.generation,
				gmailMessageId: detail.gmailMessageId,
				outcome,
				receivedAtMessageId,
			});
			if (rawDisposable) await deleteRawEmail(detail.rawEmailS3Key);
			logger.info("[ingest-gmail-import] ingested", {
				jobId: detail.jobId,
				outcome,
			});
		},
	});
}
