import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJobId,
	GmailHistoryImportJobIdSchema,
	type GmailHistoryImportStore,
} from "@packages/domain/gmail";
import {
	DEFAULT_INBOX_ALIAS,
	InboxAddressSchema,
	type InboxAddress,
	MessageIdSchema,
	messageIdentityKey,
	NormalizedMessageIdSchema,
	type ParseEmailResult,
	parseEmail,
} from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import {
	EmailReceivedEvent,
	type GmailHistoryImportMessageFetchedDetail,
	GmailHistoryImportMessageIngestedEvent,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryEmailIdentity } from "@packages/test-fixtures/providers/email-identity";
import { initInMemoryRawEmailBucket } from "@packages/test-fixtures/providers/gmail-history";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initIngestGmailImportHandler } from "./ingest-gmail-import-handler";
import { initIngestParsedEmail } from "./ingest-parsed-email";
import { initResolveEmailIdentity } from "./resolve-email-identity";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const OTHER_READER = UserIdSchema.parse("00000000000000000000000000000002");
const FIRST_JOB = GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef");
const SECOND_JOB = GmailHistoryImportJobIdSchema.parse("fedcba9876543210fedcba9876543210");
const INTERNAL_DATE = "2026-09-20T07:30:00.000Z";
const NOW = new Date("2026-09-30T00:00:00.000Z");
const GMAIL_MESSAGE_ID = "18c2f0a1b2c3d4e5";
const IMPORTED_ROW = `${INTERNAL_DATE}#<issue-42@tldr.tech>`;

function tldrIssue(headers: { from: string; messageId: string | undefined }): Buffer {
	return Buffer.from(
		[
			`From: TLDR <${headers.from}>`,
			"To: reader@gmail.com",
			"Subject: TLDR 2026-09-20",
			...(headers.messageId === undefined ? [] : [`Message-ID: ${headers.messageId}`]),
			"MIME-Version: 1.0",
			'Content-Type: text/html; charset="UTF-8"',
			"",
			'<p><a href="https://example.com/story">Story</a></p>',
			"",
		].join("\r\n"),
		"utf8",
	);
}

function makeHarness(opts?: { maxEmailBytes?: number; parseEmail?: () => Promise<ParseEmailResult> }) {
	const now = () => NOW;
	const imports = initInMemoryGmailHistoryImport();
	const addresses = initInMemoryInboxAddress({ now });
	const emails = initInMemoryInboxEmail();
	const identities = initInMemoryEmailIdentity();
	const rawBucket = initInMemoryRawEmailBucket();
	const imageDownloads: string[] = [];
	const published: { event: unknown; detail: unknown }[] = [];
	const publishEvent = (async (event, detail) => {
		published.push({ event, detail: event.detailSchema.parse(detail) });
	}) as PublishEvent;

	const handler = initIngestGmailImportHandler({
		readRawEmail: rawBucket.read,
		parseEmail: opts?.parseEmail ?? parseEmail,
		findByAddress: addresses.findByAddress,
		findImportJob: imports.findJob,
		downloadEmailImages: async ({ html }) => {
			imageDownloads.push(html);
			return [];
		},
		resolveIdentity: initResolveEmailIdentity({
			identities,
			findReceivedByMessageId: emails.findReceivedByMessageId,
			getEmail: emails.getEmail,
			now,
		}),
		ingest: initIngestParsedEmail({
			storeBody: async ({ receivedAtMessageId }) => `content/${receivedAtMessageId}/content.html`,
			putEmail: emails.putEmail,
			publishEvent,
			logger: HutchLogger.from(noopLogger),
		}),
		publishEvent,
		maxEmailBytes: opts?.maxEmailBytes ?? 20 * 1024 * 1024,
		logger: HutchLogger.from(noopLogger),
	});

	const deliver = async (details: GmailHistoryImportMessageFetchedDetail[]) => {
		const response = await handler(
			buildSqsEvent(
				details.map((detail, index) => ({
					messageId: `fetched-${index}`,
					body: JSON.stringify({ "detail-type": "GmailHistoryImportMessageFetched", detail }),
				})),
			),
			buildLambdaContext(),
			() => {},
		);
		assert(response, "the handler always returns a batch response");
		return response;
	};

	const readlistAddress = async (userId: UserId) =>
		(await addresses.getOrCreateReadlistAddress({ userId, domain: "read.place", readlist: ReadlistSlugSchema.parse("a1b2c3d4") }))
			.address;

	return { imports, addresses, emails, identities, rawBucket, imageDownloads, published, deliver, readlistAddress };
}

async function runningImport(input: {
	imports: GmailHistoryImportStore;
	jobId: GmailHistoryImportJobId;
	destinationAddress: InboxAddress;
}) {
	await input.imports.createJob({
		userId: READER,
		jobId: input.jobId,
		senderEmail: ForwardableSenderSchema.parse("dan@tldr.tech"),
		destinationAddress: input.destinationAddress,
		connection: {
			gatewayAddress: InboxAddressSchema.parse("gmail-def456@read.place"),
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		},
		window: undefined,
		generation: "generation-0",
		page: 0,
		pageToken: undefined,
		listingCompletedAt: undefined,
		state: "awaiting-permission",
		counts: { listed: 0, imported: 0, alreadyImported: 0, skippedNoMessageId: 0, skippedSenderMismatch: 0, failed: 0, cancelled: 0 },
		failureReason: undefined,
		cancelReason: undefined,
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString(),
		completedAt: undefined,
	});
	await input.imports.startJob({ userId: READER, jobId: input.jobId, generation: "generation-1", now: NOW });
	await input.imports.claimPage({ userId: READER, jobId: input.jobId, generation: "generation-1", page: 0, now: NOW });
}

function fetchedDetail(input: {
	jobId: GmailHistoryImportJobId;
	destinationAddress: InboxAddress;
	generation?: string;
}): GmailHistoryImportMessageFetchedDetail {
	return {
		userId: READER,
		jobId: input.jobId,
		generation: input.generation ?? "generation-1",
		gmailMessageId: GMAIL_MESSAGE_ID,
		accountEmail: "reader@gmail.com",
		senderEmail: "dan@tldr.tech",
		destinationAddress: input.destinationAddress,
		rawEmailS3Key: `gmail-import/${READER}/${input.jobId}/${GMAIL_MESSAGE_ID}.eml`,
		internalDate: INTERNAL_DATE,
	};
}

function ingested(input: { jobId: GmailHistoryImportJobId; outcome: string; receivedAtMessageId?: string; generation?: string }) {
	return {
		event: GmailHistoryImportMessageIngestedEvent,
		detail: {
			userId: READER,
			jobId: input.jobId,
			generation: input.generation ?? "generation-1",
			gmailMessageId: GMAIL_MESSAGE_ID,
			outcome: input.outcome,
			receivedAtMessageId: input.receivedAtMessageId,
		},
	};
}

async function importedIssueHarness(opts?: Parameters<typeof makeHarness>[0]) {
	const harness = makeHarness(opts);
	const destinationAddress = await harness.readlistAddress(READER);
	await runningImport({ imports: harness.imports, jobId: FIRST_JOB, destinationAddress });
	const detail = fetchedDetail({ jobId: FIRST_JOB, destinationAddress });
	await harness.rawBucket.put({
		key: detail.rawEmailS3Key,
		raw: tldrIssue({ from: "dan@tldr.tech", messageId: "<issue-42@tldr.tech>" }),
	});
	return { ...harness, destinationAddress, detail };
}

describe("initIngestGmailImportHandler", () => {
	it("stores an imported message at its readlist address and reports it imported", async () => {
		const { emails, published, imageDownloads, deliver, destinationAddress, detail } = await importedIssueHarness();

		const response = await deliver([detail]);

		assert.deepEqual(response, { batchItemFailures: [] });
		const row = await emails.getEmail({ userId: READER, receivedAtMessageId: IMPORTED_ROW });
		assert.equal(row?.status, "received");
		assert.equal(row?.recipientAddress, destinationAddress);
		assert.equal(row?.receivedAt, INTERNAL_DATE);
		assert.equal(row?.rawEmailS3Key, detail.rawEmailS3Key);
		assert.equal(imageDownloads.length, 1);
		assert.deepEqual(published, [
			{
				event: EmailReceivedEvent,
				detail: { userId: READER, receivedAtMessageId: IMPORTED_ROW, recipientAddress: destinationAddress, origin: "gmail-import" },
			},
			ingested({ jobId: FIRST_JOB, outcome: "imported", receivedAtMessageId: IMPORTED_ROW }),
		]);
	});

	it("republishes the stored message when the same import delivery is retried", async () => {
		const { emails, published, deliver, detail } = await importedIssueHarness();

		await deliver([detail]);
		await deliver([detail]);

		assert.equal((await emails.listEmailsByUserId({ userId: READER, cursor: undefined, pageSize: 10 })).emails.length, 1);
		assert.deepEqual(published.slice(2), published.slice(0, 2));
	});

	it("reports a message a later import job finds already stored as already imported", async () => {
		const { imports, published, deliver, destinationAddress, detail, rawBucket } = await importedIssueHarness();
		await deliver([detail]);
		await runningImport({ imports, jobId: SECOND_JOB, destinationAddress });
		const secondDetail = fetchedDetail({ jobId: SECOND_JOB, destinationAddress });
		await rawBucket.put({
			key: secondDetail.rawEmailS3Key,
			raw: tldrIssue({ from: "dan@tldr.tech", messageId: "<issue-42@tldr.tech>" }),
		});

		await deliver([secondDetail]);

		assert.deepEqual(published.slice(2), [ingested({ jobId: SECOND_JOB, outcome: "already-imported" })]);
	});

	it("cancels a message fetched by a superseded run of the import", async () => {
		const { emails, published, deliver, destinationAddress } = await importedIssueHarness();

		await deliver([fetchedDetail({ jobId: FIRST_JOB, destinationAddress, generation: "generation-0" })]);

		assert.deepEqual(published, [ingested({ jobId: FIRST_JOB, outcome: "cancelled", generation: "generation-0" })]);
		assert.deepEqual((await emails.listEmailsByUserId({ userId: READER, cursor: undefined, pageSize: 10 })).emails, []);
	});

	it("cancels a message whose import job no longer exists", async () => {
		const { published, deliver, destinationAddress } = await importedIssueHarness();

		await deliver([fetchedDetail({ jobId: SECOND_JOB, destinationAddress })]);

		assert.deepEqual(published, [ingested({ jobId: SECOND_JOB, outcome: "cancelled" })]);
	});

	it("cancels a message whose readlist address was retired", async () => {
		const { addresses, published, deliver, detail } = await importedIssueHarness();
		await addresses.retireReadlistAddress({ userId: READER, readlist: ReadlistSlugSchema.parse("a1b2c3d4") });

		await deliver([detail]);

		assert.deepEqual(published, [ingested({ jobId: FIRST_JOB, outcome: "cancelled" })]);
	});

	it("cancels a message addressed to another reader's address", async () => {
		const { imports, published, deliver, readlistAddress, rawBucket } = makeHarness();
		const othersAddress = await readlistAddress(OTHER_READER);
		await runningImport({ imports, jobId: FIRST_JOB, destinationAddress: othersAddress });
		const detail = fetchedDetail({ jobId: FIRST_JOB, destinationAddress: othersAddress });
		await rawBucket.put({ key: detail.rawEmailS3Key, raw: tldrIssue({ from: "dan@tldr.tech", messageId: "<issue-42@tldr.tech>" }) });

		await deliver([detail]);

		assert.deepEqual(published, [ingested({ jobId: FIRST_JOB, outcome: "cancelled" })]);
	});

	it("cancels a message addressed to an address that does not exist", async () => {
		const { imports, published, deliver, rawBucket } = makeHarness();
		const unknown = InboxAddressSchema.parse("gmail-zzzzzz@read.place");
		await runningImport({ imports, jobId: FIRST_JOB, destinationAddress: unknown });
		const detail = fetchedDetail({ jobId: FIRST_JOB, destinationAddress: unknown });
		await rawBucket.put({ key: detail.rawEmailS3Key, raw: tldrIssue({ from: "dan@tldr.tech", messageId: "<issue-42@tldr.tech>" }) });

		await deliver([detail]);

		assert.deepEqual(published, [ingested({ jobId: FIRST_JOB, outcome: "cancelled" })]);
	});

	it("skips a message whose From header is not the mapped sender", async () => {
		const { published, deliver, detail, rawBucket } = await importedIssueHarness();
		await rawBucket.put({ key: detail.rawEmailS3Key, raw: tldrIssue({ from: "promo@tldr.tech", messageId: "<issue-42@tldr.tech>" }) });

		await deliver([detail]);

		assert.deepEqual(published, [ingested({ jobId: FIRST_JOB, outcome: "skipped-sender-mismatch" })]);
	});

	it("skips a message without a Message-ID header", async () => {
		const { emails, published, deliver, detail, rawBucket } = await importedIssueHarness();
		await rawBucket.put({ key: detail.rawEmailS3Key, raw: tldrIssue({ from: "dan@tldr.tech", messageId: undefined }) });

		await deliver([detail]);

		assert.deepEqual(published, [ingested({ jobId: FIRST_JOB, outcome: "skipped-no-message-id" })]);
		assert.deepEqual((await emails.listEmailsByUserId({ userId: READER, cursor: undefined, pageSize: 10 })).emails, []);
	});

	it("retries a message larger than the inbox accepts so it dead-letters to the operator", async () => {
		const { published, deliver, detail } = await importedIssueHarness({ maxEmailBytes: 16 });

		const response = await deliver([detail]);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "fetched-0" }] });
		assert.deepEqual(published, []);
	});

	it("retries a message that cannot be parsed so it dead-letters to the operator", async () => {
		const { published, deliver, detail } = await importedIssueHarness({
			parseEmail: async () => ({ ok: false, reason: "unparseable" }),
		});

		const response = await deliver([detail]);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "fetched-0" }] });
		assert.deepEqual(published, []);
	});

	it("cancels a message fetched by the current run of an import the reader cancelled", async () => {
		const { imports, emails, published, deliver, detail } = await importedIssueHarness();
		await imports.cancelJobs({
			userId: READER,
			senderEmail: ForwardableSenderSchema.parse("dan@tldr.tech"),
			reason: "user-cancelled",
			now: NOW,
		});

		await deliver([detail]);

		assert.deepEqual(published, [ingested({ jobId: FIRST_JOB, outcome: "cancelled" })]);
		assert.deepEqual((await emails.listEmailsByUserId({ userId: READER, cursor: undefined, pageSize: 10 })).emails, []);
	});

	it("cancels a message fetched by the current run of an import that failed", async () => {
		const { imports, emails, published, deliver, detail } = await importedIssueHarness();
		await imports.failJob({ userId: READER, jobId: FIRST_JOB, generation: "generation-1", reason: "gmail-rejected", now: NOW });

		await deliver([detail]);

		assert.deepEqual(published, [ingested({ jobId: FIRST_JOB, outcome: "cancelled" })]);
		assert.deepEqual((await emails.listEmailsByUserId({ userId: READER, cursor: undefined, pageSize: 10 })).emails, []);
	});

	it("retries a message whose raw copy is not readable", async () => {
		const { published, deliver, destinationAddress } = await importedIssueHarness();
		const unreadable = { ...fetchedDetail({ jobId: FIRST_JOB, destinationAddress }), rawEmailS3Key: "gmail-import/missing.eml" };

		const response = await deliver([unreadable]);

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "fetched-0" }] });
		assert.deepEqual(published, []);
	});

	it("retries a record that is not a fetched message", async () => {
		const { imports } = makeHarness();
		const published: unknown[] = [];
		const handler = initIngestGmailImportHandler({
			readRawEmail: async () => undefined,
			parseEmail,
			findByAddress: async () => undefined,
			findImportJob: imports.findJob,
			downloadEmailImages: async () => [],
			resolveIdentity: async () => ({ proceed: false, reason: "already-ingested" }),
			ingest: async () => "stored",
			publishEvent: (async (_event, detail) => {
				published.push(detail);
			}) as PublishEvent,
			maxEmailBytes: 1,
			logger: HutchLogger.from(noopLogger),
		});

		const response = await handler(buildSqsEvent([{ messageId: "bad", body: "not json" }]), buildLambdaContext(), () => {});

		assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: "bad" }] });
		assert.deepEqual(published, []);
	});

	it("delivers a copy only once when forwarded mail of the same issue arrived first", async () => {
		const { addresses, emails, identities, published, deliver, detail } = await importedIssueHarness();
		const inbox = await addresses.createAddress({ userId: READER, domain: "read.place", name: DEFAULT_INBOX_ALIAS, purpose: "user-alias" });
		const forwardedRow = `2026-09-20T07:31:00.000Z#<issue-42@tldr.tech>`;
		const claimed = await identities.claim({
			key: messageIdentityKey({
				userId: READER,
				sender: ForwardableSenderSchema.parse("dan@tldr.tech"),
				messageId: NormalizedMessageIdSchema.parse("issue-42@tldr.tech"),
			}),
			userId: READER,
			receivedAtMessageId: forwardedRow,
			attempt: { origin: "receive", sesMessageId: "ses-1" },
			now: NOW,
		});
		assert.equal(claimed.status, "claimed");
		await emails.putEmail({
			userId: READER,
			receivedAtMessageId: forwardedRow,
			messageId: MessageIdSchema.parse("<issue-42@tldr.tech>"),
			recipientAddress: inbox.address,
			senderEmail: "dan@tldr.tech",
			subject: "TLDR 2026-09-20",
			status: "received",
			receivedAt: "2026-09-20T07:31:00.000Z",
			rawEmailS3Key: "inbound/ses-1",
			bodyS3Key: "content/forwarded/content.html",
			linkCounts: undefined,
		});

		await deliver([detail]);

		assert.deepEqual(published, [ingested({ jobId: FIRST_JOB, outcome: "already-imported" })]);
	});
});
