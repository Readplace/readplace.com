import { initResumeAcceptedGmailEmail } from "../inbox/resume-accepted-gmail-email";
import assert from "node:assert/strict";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJobId,
	GmailHistoryImportJobIdSchema,
} from "@packages/domain/gmail";
import {
	deriveSanitizedBody,
	GMAIL_FORWARDING_ALIAS,
	type InboxAddress,
	InboxAddressSchema,
	parseEmail,
} from "@packages/domain/inbox";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistSlug,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import {
	ConfirmGmailForwardingCommand,
	CrawlEmailLinkPreview,
	EmailLinksTriagedEvent,
	EmailReceivedEvent,
	GmailHistoryImportMessageFetchedEvent,
	GmailHistoryImportMessageIngestedEvent,
	type HutchEvent,
	SaveEmailIssueCommand,
	SendFirstInboxEmailNoticeCommand,
	SendTrialFeedbackEmailCommand,
	SubmitLinkCommand,
} from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryEmailIdentity } from "@packages/test-fixtures/providers/email-identity";
import { initInMemoryGmailHeldMail } from "@packages/test-fixtures/providers/gmail-held-mail";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import {
	initInMemoryInboxEmail,
	initInMemoryInboxEmailLink,
} from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { z } from "zod";
import { initExtractEmailLinksHandler } from "../inbox/extract-email-links-handler";
import { initIngestGmailImportHandler } from "../inbox/ingest-gmail-import-handler";
import { initIngestParsedEmail } from "../inbox/ingest-parsed-email";
import { initInterceptGmailConfirmation } from "../inbox/intercept-gmail-confirmation";
import { initReceiveEmailHandler } from "../inbox/receive-email-handler";
import { initRecordEmailLinksFilteredHandler } from "../inbox/record-email-links-filtered-handler";
import { initResolveEmailIdentity } from "../inbox/resolve-email-identity";
import { initRouteGmailForwardedEmail } from "./route-gmail-forwarded-email";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const JOB = GmailHistoryImportJobIdSchema.parse(
	"0123456789abcdef0123456789abcdef",
);
const GENERATION = "generation-1";
const GMAIL_MESSAGE_ID = "18c2f0a1b2c3d4e5";
const INTERNAL_DATE = "2026-09-20T07:30:00.000Z";
const FORWARDED_AT = "2026-09-20T07:31:00.000Z";
const NOW = new Date("2026-09-30T00:00:00.000Z");
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const LATER = ReadlistSlugSchema.parse("e5f6a7b8");
const STORY_URL = "https://example.com/story";

type Published = { event: HutchEvent<z.ZodTypeAny>; detail: unknown };

function tldrIssueEml(messageId: string): Buffer {
	return Buffer.from(
		[
			"From: TLDR <dan@tldr.tech>",
			"To: reader@gmail.com",
			"Subject: TLDR 2026-09-20",
			`Message-ID: ${messageId}`,
			"MIME-Version: 1.0",
			'Content-Type: text/html; charset="UTF-8"',
			"",
			`<p><a href="${STORY_URL}">Story</a></p>`,
			"",
		].join("\r\n"),
		"utf8",
	);
}

function makePipeline() {
	const now = () => NOW;
	const logger = HutchLogger.from(noopLogger);
	const addresses = initInMemoryInboxAddress({ now });
	const emails = initInMemoryInboxEmail();
	const links = initInMemoryInboxEmailLink();
	const identities = initInMemoryEmailIdentity();
	const imports = initInMemoryGmailHistoryImport();
	const senders = initInMemoryGmailSender({ now });
	const rawObjects = new Map<string, Buffer>();
	const readRawEmail = async (key: string) => rawObjects.get(key);

	const published: Published[] = [];
	const publishEvent = (async (event, detail) => {
		published.push({ event, detail: event.detailSchema.parse(detail) });
	}) as PublishEvent;

	const resolveIdentity = initResolveEmailIdentity({
		identities,
		findReceivedByMessageId: emails.findReceivedByMessageId,
		getEmail: emails.getEmail,
		now,
	});
	const ingest = initIngestParsedEmail({
		storeBody: async ({ receivedAtMessageId }) =>
			`content/${receivedAtMessageId}/content.html`,
		putEmail: emails.putEmail,
		getEmail: emails.getEmail,
		publishEvent,
		logger,
	});

	const ingestImport = initIngestGmailImportHandler({
		resumeAcceptedGmailEmail: initResumeAcceptedGmailEmail({ getEmail: emails.getEmail, publishEvent }),
		readRawEmail,
		parseEmail,
		findByAddress: addresses.findByAddress,
		findImportJob: imports.findJob,
		downloadEmailImages: async () => [],
		resolveIdentity,
		ingest,
		publishEvent,
		maxEmailBytes: 20 * 1024 * 1024,
		logger,
	});

	const receive = initReceiveEmailHandler({
		resumeAcceptedGmailEmail: initResumeAcceptedGmailEmail({ getEmail: emails.getEmail, publishEvent }),
		readRawEmail,
		findByAddress: addresses.findByAddress,
		putEmail: emails.putEmail,
		parseEmail,
		downloadEmailImages: async () => [],
		resolveIdentity,
		ingest,
		interceptGmailConfirmation: initInterceptGmailConfirmation({
			publishConfirmGmailForwarding: (detail) =>
				publishEvent(ConfirmGmailForwardingCommand, detail),
			logger,
		}),
		routeGmailForwardedEmail: initRouteGmailForwardedEmail({
			senders,
			heldMail: initInMemoryGmailHeldMail(),
			logger,
		}),
		logger,
		maxEmailBytes: 20 * 1024 * 1024,
	});

	const extract = initExtractEmailLinksHandler({
		getEmail: emails.getEmail,
		readRawEmail,
		parseEmail,
		deriveSanitizedBody,
		putLink: links.putLink,
		getLink: links.getLink,
		putLinksMeta: links.putLinksMeta,
		setEmailLinkCounts: emails.setEmailLinkCounts,
		publishCrawlPreview: (input) => publishEvent(CrawlEmailLinkPreview, input),
		publishSubmitLink: (input) => publishEvent(SubmitLinkCommand, input),
		publishEmailLinksTriaged: (input) =>
			publishEvent(EmailLinksTriagedEvent, input),
		publishSaveEmailIssue: (input) => publishEvent(SaveEmailIssueCommand, input),
		alertTruncated: async () => {},
		publishSaveHeldNotice: ({ userId, receivedAtMessageId, inboxAddress }) =>
			publishEvent(SendTrialFeedbackEmailCommand, {
				userId,
				kind: "automation_saves_held",
				receivedAtMessageId,
				inboxAddress,
			}),
		publishFirstInboxEmailNotice: (input) =>
			publishEvent(SendFirstInboxEmailNoticeCommand, input),
		findSubscriptionByUserId: async () => undefined,
		findInboxAddress: addresses.findByAddress,
		listReadlistDefinitions: async () => [
			{ slug: WORK, label: "Work", createdAt: NOW },
			{ slug: LATER, label: "Later", createdAt: NOW },
			{
				slug: ReadlistSlugSchema.parse("science"),
				label: "Science",
				createdAt: NOW,
			},
		],
		now,
		triageEmailLinks: async (input) => ({
			status: "triaged",
			categories: new Map(
				input.links.map((link) => [link.ordinal, "article" as const]),
			),
		}),
		logger,
		maxLinks: 200,
		appOrigin: "https://readplace.com",
	});

	const run = async (
		handler: typeof receive,
		records: { messageId: string; body: string }[],
	) => {
		const response = await handler(
			buildSqsEvent(records),
			buildLambdaContext(),
			() => {},
		);
		assert(response, "every handler returns a batch response");
		assert.deepEqual(response.batchItemFailures, []);
	};

	const readlistAddress = async (readlist: ReadlistSlug) =>
		(
			await addresses.getOrCreateReadlistAddress({
				userId: READER,
				domain: "read.place",
				readlist,
			})
		).address;

	const startImport = async (input: {
		jobId: GmailHistoryImportJobId;
		destinationAddress: InboxAddress;
		additionalAddresses?: InboxAddress[];
	}) => {
		await imports.createJob({
			userId: READER,
			jobId: input.jobId,
			senderEmail: TLDR,
			destinationAddresses: [
				input.destinationAddress,
				...(input.additionalAddresses ?? []),
			],
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
			counts: {
				listed: 0,
				imported: 0,
				alreadyImported: 0,
				skippedNoMessageId: 0,
				skippedSenderMismatch: 0,
				failed: 0,
				cancelled: 0,
			},
			failureReason: undefined,
			cancelReason: undefined,
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString(),
			completedAt: undefined,
		});
		await imports.startJob({
			userId: READER,
			jobId: input.jobId,
			generation: GENERATION,
			now: NOW,
		});
		await imports.claimPage({
			userId: READER,
			jobId: input.jobId,
			generation: GENERATION,
			page: 0,
			now: NOW,
		});
	};

	const deliverFetched = async (input: {
		destinationAddress: InboxAddress;
		additionalAddresses?: InboxAddress[];
		messageId: string;
		deliveryMode?: "links" | "issue";
	}) => {
		const rawEmailS3Key = `gmail-import/${READER}/${JOB}/${GMAIL_MESSAGE_ID}.eml`;
		rawObjects.set(rawEmailS3Key, tldrIssueEml(input.messageId));
		const detail = GmailHistoryImportMessageFetchedEvent.detailSchema.parse({
			userId: READER,
			jobId: JOB,
			generation: GENERATION,
			gmailMessageId: GMAIL_MESSAGE_ID,
			accountEmail: "reader@gmail.com",
			senderEmail: TLDR,
			destinationAddresses: [
				input.destinationAddress,
				...(input.additionalAddresses ?? []),
			],
			deliveryMode: input.deliveryMode ?? "links",
			rawEmailS3Key,
			internalDate: INTERNAL_DATE,
		});
		await run(ingestImport, [
			{ messageId: "fetched-1", body: JSON.stringify({ detail }) },
		]);
	};

	const forward = async (input: {
		gateway: InboxAddress;
		messageId: string;
		sesMessageId: string;
	}) => {
		const objectKey = `inbound/${input.sesMessageId}`;
		rawObjects.set(objectKey, tldrIssueEml(input.messageId));
		await run(receive, [
			{
				messageId: input.sesMessageId,
				body: JSON.stringify({
					mail: { messageId: input.sesMessageId },
					receipt: {
						timestamp: FORWARDED_AT,
						recipients: [input.gateway],
						action: { objectKey },
					},
				}),
			},
		]);
	};

	const extractEach = async (entries: Published[]) => {
		for (const [index, entry] of entries.entries()) {
			await run(extract, [
				{
					messageId: `received-${index}`,
					body: JSON.stringify({
						"detail-type": entry.event.detailType,
						detail: entry.detail,
					}),
				},
			]);
		}
	};

	const mapGatewaySender = async (
		mappedAddress: InboxAddress,
		additionalAddresses: InboxAddress[] = [],
	) => {
		await senders.mapSenderToAddress({
			userId: READER,
			senderEmail: TLDR,
			mappedAddresses: [mappedAddress, ...additionalAddresses],
			deliveryMode: "links",
		});
		await senders.addSenderToFilter({ userId: READER, senderEmail: TLDR });
	};

	const gatewayAddress = async () =>
		(
			await addresses.createAddress({
				userId: READER,
				domain: "read.place",
				name: GMAIL_FORWARDING_ALIAS,
				purpose: "gmail-forwarding",
			})
		).address;

	const rows = async () =>
		(
			await emails.listEmailsByUserId({
				userId: READER,
				cursor: undefined,
				pageSize: 10,
			})
		).emails;

	const publishedOf = (event: HutchEvent<z.ZodTypeAny>) =>
		published.filter((entry) => entry.event === event);

	return {
		links,
		emails,
		published,
		publishedOf,
		readlistAddress,
		startImport,
		deliverFetched,
		forward,
		extractEach,
		mapGatewaySender,
		gatewayAddress,
		rows,
	};
}

describe("gmail history import chain (inbox half)", () => {
	it("delivers an imported issue into the chosen custom readlist", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		await pipeline.startImport({ jobId: JOB, destinationAddress });

		await pipeline.deliverFetched({
			destinationAddress,
			messageId: "<issue-42@tldr.tech>",
		});

		const receivedAtMessageId = `${INTERNAL_DATE}#<issue-42@tldr.tech>`;
		assert.deepEqual(
			pipeline
				.publishedOf(GmailHistoryImportMessageIngestedEvent)
				.map((entry) => entry.detail),
			[
				{
					userId: READER,
					jobId: JOB,
					generation: GENERATION,
					gmailMessageId: GMAIL_MESSAGE_ID,
					outcome: "imported",
					receivedAtMessageId,
				},
			],
		);
		const received = pipeline.publishedOf(EmailReceivedEvent);
		assert.deepEqual(
			received.map((entry) => entry.detail),
			[
				{
					userId: READER,
					receivedAtMessageId,
					recipientAddress: destinationAddress,
					origin: "gmail-import",
					routing: {
						kind: "gmail",
						destinationAddresses: [destinationAddress],
						deliveryMode: "links",
					},
				},
			],
		);

		await pipeline.extractEach(received);

		assert.deepEqual(
			pipeline.publishedOf(EmailLinksTriagedEvent).map((entry) => entry.detail),
			[
				{
					userId: READER,
					receivedAtMessageId,
					readlist: WORK,
					senderEmail: "dan@tldr.tech",
					subject: "TLDR 2026-09-20",
					links: [{ ordinal: "0000", url: STORY_URL, anchorText: "Story" }],
				},
			],
		);
		expect(pipeline.publishedOf(SubmitLinkCommand).map(({ detail }) => detail)).toEqual([
			{
				userId: READER,
				url: STORY_URL,
				readlist: DEFAULT_READLIST_SLUG,
				provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
				saveAttemptId: expect.any(String),
			},
		]);
	});

	it("delivers an imported issue into All with the email as its provenance", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(
			DEFAULT_READLIST_SLUG,
		);
		await pipeline.startImport({ jobId: JOB, destinationAddress });

		await pipeline.deliverFetched({
			destinationAddress,
			messageId: "<issue-42@tldr.tech>",
		});
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));

		expect(pipeline.publishedOf(SubmitLinkCommand).map((entry) => entry.detail)).toEqual([
			{
				userId: READER,
				url: STORY_URL,
				provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
				readlist: DEFAULT_READLIST_SLUG,
				saveAttemptId: expect.any(String),
			},
		]);
		assert.deepEqual(pipeline.publishedOf(EmailLinksTriagedEvent), []);
	});

	it("saves an imported issue whole, into its custom readlist, when the reader chose to keep the issue", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		await pipeline.startImport({ jobId: JOB, destinationAddress });

		await pipeline.deliverFetched({
			destinationAddress,
			messageId: "<issue-42@tldr.tech>",
			deliveryMode: "issue",
		});
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));

		assert.deepEqual(
			pipeline.publishedOf(SaveEmailIssueCommand).map((entry) => SaveEmailIssueCommand.detailSchema.parse(entry.detail).readlists),
			[[WORK]],
		);
		assert.deepEqual(pipeline.publishedOf(SubmitLinkCommand), []);
	});

	it("routes forwarded mail to the readlist the sender was remapped to", async () => {
		const pipeline = makePipeline();
		const gateway = await pipeline.gatewayAddress();
		await pipeline.mapGatewaySender(await pipeline.readlistAddress(WORK));
		const remapped = await pipeline.readlistAddress(LATER);
		await pipeline.mapGatewaySender(remapped);

		await pipeline.forward({
			gateway,
			messageId: "<issue-43@tldr.tech>",
			sesMessageId: "ses-43",
		});
		const received = pipeline.publishedOf(EmailReceivedEvent);
		await pipeline.extractEach(received);

		assert.deepEqual(
			received.map((entry) => entry.detail),
			[
				{
					userId: READER,
					receivedAtMessageId: `${FORWARDED_AT}#<issue-43@tldr.tech>`,
					recipientAddress: remapped,
					origin: "receive",
					routing: { kind: "gmail", destinationAddresses: [remapped], deliveryMode: "links" },
				},
			],
		);
		assert.deepEqual(
			pipeline
				.publishedOf(EmailLinksTriagedEvent)
				.map(
					(entry) =>
						EmailLinksTriagedEvent.detailSchema.parse(entry.detail).readlist,
				),
			[LATER],
		);
	});

	it("reports an issue already forwarded as already imported, keeping the single forwarded copy", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const gateway = await pipeline.gatewayAddress();
		await pipeline.mapGatewaySender(destinationAddress);
		await pipeline.forward({
			gateway,
			messageId: "<issue-42@tldr.tech>",
			sesMessageId: "ses-42",
		});
		await pipeline.startImport({ jobId: JOB, destinationAddress });

		await pipeline.deliverFetched({
			destinationAddress,
			messageId: "<issue-42@tldr.tech>",
		});

		assert.deepEqual(
			(await pipeline.rows()).map((row) => row.receivedAtMessageId),
			[`${FORWARDED_AT}#<issue-42@tldr.tech>`],
		);
		assert.equal(pipeline.publishedOf(EmailReceivedEvent).length, 1);
		assert.deepEqual(
			pipeline
				.publishedOf(GmailHistoryImportMessageIngestedEvent)
				.map((entry) => entry.detail),
			[
				{
					userId: READER,
					jobId: JOB,
					generation: GENERATION,
					gmailMessageId: GMAIL_MESSAGE_ID,
					outcome: "already-imported",
					receivedAtMessageId: undefined,
				},
			],
		);
	});

	it("drops a forwarded copy of an issue already imported: no second row and no second announcement", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const gateway = await pipeline.gatewayAddress();
		await pipeline.mapGatewaySender(destinationAddress);
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({
			destinationAddress,
			messageId: "<issue-42@tldr.tech>",
		});

		await pipeline.forward({
			gateway,
			messageId: "<issue-42@tldr.tech>",
			sesMessageId: "ses-42",
		});

		assert.deepEqual(
			(await pipeline.rows()).map((row) => row.receivedAtMessageId),
			[`${INTERNAL_DATE}#<issue-42@tldr.tech>`],
		);
		assert.equal(pipeline.publishedOf(EmailReceivedEvent).length, 1);
	});
});

for (const delivery of ["forward", "import"] as const) {
	it(`keeps a ${delivery} article in All while custom lists accept, reject, and fail independently`, async () => {
		const pipeline = makePipeline();
		const failed = ReadlistSlugSchema.parse("science");
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const additionalAddresses = [
			await pipeline.readlistAddress(LATER),
			await pipeline.readlistAddress(failed),
		];
		if (delivery === "forward") {
			await pipeline.mapGatewaySender(destinationAddress, additionalAddresses);
			await pipeline.forward({
				gateway: await pipeline.gatewayAddress(),
				messageId: "<issue-42@tldr.tech>",
				sesMessageId: "ses-42",
			});
		} else {
			await pipeline.startImport({
				jobId: JOB,
				destinationAddress,
				additionalAddresses,
			});
			await pipeline.deliverFetched({
				destinationAddress,
				additionalAddresses,
				messageId: "<issue-42@tldr.tech>",
			});
		}
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		expect(pipeline.publishedOf(SubmitLinkCommand).map(({ detail }) => detail)).toEqual([
			{
				userId: READER,
				url: STORY_URL,
				provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
				readlist: DEFAULT_READLIST_SLUG,
				saveAttemptId: expect.any(String),
			},
		]);
		assert.deepEqual(
			pipeline
				.publishedOf(EmailLinksTriagedEvent)
				.map(
					({ detail }) =>
						EmailLinksTriagedEvent.detailSchema.parse(detail).readlist,
				),
			[WORK, LATER, failed],
		);
		const row = (await pipeline.rows())[0];
		const recordOutcome = initRecordEmailLinksFilteredHandler({
			markLinkDropped: pipeline.links.markLinkDropped,
			settleReadlistDecision: pipeline.links.settleReadlistDecision,
			putReadlistOutcome: pipeline.links.putReadlistOutcome,
			listLinksByEmail: pipeline.links.listLinksByEmail,
			setEmailLinkCounts: pipeline.emails.setEmailLinkCounts,
			logger: HutchLogger.from(noopLogger),
		});
		const details = [
			{
				"detail-type": "EmailLinksFiltered",
				detail: {
					userId: READER,
					receivedAtMessageId: row.receivedAtMessageId,
					readlist: WORK,
					savedTo: WORK,
					readlistLabel: "Work",
					dropped: [],
				},
			},
			{
				"detail-type": "EmailLinksFiltered",
				detail: {
					userId: READER,
					receivedAtMessageId: row.receivedAtMessageId,
					readlist: LATER,
					savedTo: LATER,
					readlistLabel: "Later",
					dropped: [{ ordinal: "0000", reason: "Outside this list" }],
				},
			},
			{
				"detail-type": "EmailLinksFilterFailed",
				detail: {
					userId: READER,
					receivedAtMessageId: row.receivedAtMessageId,
					readlist: failed,
				},
			},
		];
		const result = await recordOutcome(
			buildSqsEvent(
				details.map((detail, index) => ({
					messageId: `outcome-${index}`,
					body: JSON.stringify(detail),
				})),
			),
			buildLambdaContext(),
			() => {},
		);
		assert.deepEqual(result, { batchItemFailures: [] });
		const { links, meta } = await pipeline.links.listLinksByEmail({
			userId: READER,
			receivedAtMessageId: row.receivedAtMessageId,
		});
		assert.equal(links[0].droppedFor, undefined);
		assert.deepEqual(
			meta?.readlistOutcomes?.map(({ readlist, decision, dropped }) => ({
				readlist,
				state: decision.state,
				dropped: dropped.length,
			})),
			[
				{ readlist: WORK, state: "decided", dropped: 0 },
				{ readlist: LATER, state: "decided", dropped: 1 },
				{ readlist: failed, state: "failed", dropped: 0 },
			],
		);
	});
}
