import assert from "node:assert/strict";
import type { z } from "zod";
import {
	ForwardableSenderSchema,
	GmailAccountEmailSchema,
	type GmailHistoryImportJobId,
	GmailHistoryImportJobIdSchema,
} from "@packages/domain/gmail";
import {
	deriveSanitizedBody,
	GMAIL_FORWARDING_ALIAS,
	InboxAddressSchema,
	type InboxAddress,
	parseEmail,
} from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import {
	ConfirmGmailForwardingCommand,
	CrawlEmailLinkPreview,
	EmailLinksTriagedEvent,
	EmailReceivedEvent,
	GmailHistoryImportMessageFetchedEvent,
	GmailHistoryImportMessageIngestedEvent,
	type HutchEvent,
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
import { initInMemoryInboxEmail, initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initExtractEmailLinksHandler } from "../inbox/extract-email-links-handler";
import { initIngestGmailImportHandler } from "../inbox/ingest-gmail-import-handler";
import { initIngestParsedEmail } from "../inbox/ingest-parsed-email";
import { initInterceptGmailConfirmation } from "../inbox/intercept-gmail-confirmation";
import { initReceiveEmailHandler } from "../inbox/receive-email-handler";
import { initResolveEmailIdentity } from "../inbox/resolve-email-identity";
import { initRouteGmailForwardedEmail } from "./route-gmail-forwarded-email";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const JOB = GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef");
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
		storeBody: async ({ receivedAtMessageId }) => `content/${receivedAtMessageId}/content.html`,
		putEmail: emails.putEmail,
		publishEvent,
		logger,
	});

	const ingestImport = initIngestGmailImportHandler({
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
		readRawEmail,
		findByAddress: addresses.findByAddress,
		putEmail: emails.putEmail,
		parseEmail,
		downloadEmailImages: async () => [],
		resolveIdentity,
		ingest,
		interceptGmailConfirmation: initInterceptGmailConfirmation({
			publishConfirmGmailForwarding: (detail) => publishEvent(ConfirmGmailForwardingCommand, detail),
			logger,
		}),
		routeGmailForwardedEmail: initRouteGmailForwardedEmail({ senders, heldMail: initInMemoryGmailHeldMail(), logger }),
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
		publishEmailLinksTriaged: (input) => publishEvent(EmailLinksTriagedEvent, input),
		alertTruncated: async () => {},
		publishSaveHeldNotice: ({ userId, receivedAtMessageId, inboxAddress }) =>
			publishEvent(SendTrialFeedbackEmailCommand, { userId, kind: "automation_saves_held", receivedAtMessageId, inboxAddress }),
		publishFirstInboxEmailNotice: (input) => publishEvent(SendFirstInboxEmailNoticeCommand, input),
		findSubscriptionByUserId: async () => undefined,
		findInboxAddress: addresses.findByAddress,
		now,
		triageEmailLinks: async (input) => ({
			status: "triaged",
			categories: new Map(input.links.map((link) => [link.ordinal, "article" as const])),
		}),
		logger,
		maxLinks: 200,
	});

	const run = async (handler: typeof receive, records: { messageId: string; body: string }[]) => {
		const response = await handler(buildSqsEvent(records), buildLambdaContext(), () => {});
		assert(response, "every handler returns a batch response");
		assert.deepEqual(response.batchItemFailures, []);
	};

	const readlistAddress = async (readlist: ReadlistSlug) =>
		(await addresses.getOrCreateReadlistAddress({ userId: READER, domain: "read.place", readlist })).address;

	const startImport = async (input: { jobId: GmailHistoryImportJobId; destinationAddress: InboxAddress }) => {
		await imports.createJob({
			userId: READER,
			jobId: input.jobId,
			senderEmail: TLDR,
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
		await imports.startJob({ userId: READER, jobId: input.jobId, generation: GENERATION, now: NOW });
		await imports.claimPage({ userId: READER, jobId: input.jobId, generation: GENERATION, page: 0, now: NOW });
	};

	const deliverFetched = async (input: { destinationAddress: InboxAddress; messageId: string }) => {
		const rawEmailS3Key = `gmail-import/${READER}/${JOB}/${GMAIL_MESSAGE_ID}.eml`;
		rawObjects.set(rawEmailS3Key, tldrIssueEml(input.messageId));
		const detail = GmailHistoryImportMessageFetchedEvent.detailSchema.parse({
			userId: READER,
			jobId: JOB,
			generation: GENERATION,
			gmailMessageId: GMAIL_MESSAGE_ID,
			accountEmail: "reader@gmail.com",
			senderEmail: TLDR,
			destinationAddress: input.destinationAddress,
			rawEmailS3Key,
			internalDate: INTERNAL_DATE,
		});
		await run(ingestImport, [{ messageId: "fetched-1", body: JSON.stringify({ detail }) }]);
	};

	const forward = async (input: { gateway: InboxAddress; messageId: string; sesMessageId: string }) => {
		const objectKey = `inbound/${input.sesMessageId}`;
		rawObjects.set(objectKey, tldrIssueEml(input.messageId));
		await run(receive, [
			{
				messageId: input.sesMessageId,
				body: JSON.stringify({
					mail: { messageId: input.sesMessageId },
					receipt: { timestamp: FORWARDED_AT, recipients: [input.gateway], action: { objectKey } },
				}),
			},
		]);
	};

	const extractEach = async (entries: Published[]) => {
		for (const [index, entry] of entries.entries()) {
			await run(extract, [
				{ messageId: `received-${index}`, body: JSON.stringify({ "detail-type": entry.event.detailType, detail: entry.detail }) },
			]);
		}
	};

	const mapGatewaySender = async (mappedAddress: InboxAddress) => {
		await senders.mapSenderToAddress({ userId: READER, senderEmail: TLDR, mappedAddress });
		await senders.addSenderToFilter({ userId: READER, senderEmail: TLDR });
	};

	const gatewayAddress = async () =>
		(await addresses.createAddress({ userId: READER, domain: "read.place", name: GMAIL_FORWARDING_ALIAS, purpose: "gmail-forwarding" }))
			.address;

	const rows = async () => (await emails.listEmailsByUserId({ userId: READER, cursor: undefined, pageSize: 10 })).emails;

	const publishedOf = (event: HutchEvent<z.ZodTypeAny>) => published.filter((entry) => entry.event === event);

	return { published, publishedOf, readlistAddress, startImport, deliverFetched, forward, extractEach, mapGatewaySender, gatewayAddress, rows };
}

describe("gmail history import chain (inbox half)", () => {
	it("delivers an imported issue into the chosen custom readlist", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		await pipeline.startImport({ jobId: JOB, destinationAddress });

		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>" });

		const receivedAtMessageId = `${INTERNAL_DATE}#<issue-42@tldr.tech>`;
		assert.deepEqual(pipeline.publishedOf(GmailHistoryImportMessageIngestedEvent).map((entry) => entry.detail), [
			{ userId: READER, jobId: JOB, generation: GENERATION, gmailMessageId: GMAIL_MESSAGE_ID, outcome: "imported", receivedAtMessageId },
		]);
		const received = pipeline.publishedOf(EmailReceivedEvent);
		assert.deepEqual(received.map((entry) => entry.detail), [
			{ userId: READER, receivedAtMessageId, recipientAddress: destinationAddress, origin: "gmail-import" },
		]);

		await pipeline.extractEach(received);

		assert.deepEqual(pipeline.publishedOf(EmailLinksTriagedEvent).map((entry) => entry.detail), [
			{
				userId: READER,
				receivedAtMessageId,
				readlist: WORK,
				senderEmail: "dan@tldr.tech",
				subject: "TLDR 2026-09-20",
				links: [{ ordinal: "0000", url: STORY_URL, anchorText: "Story" }],
			},
		]);
		assert.deepEqual(pipeline.publishedOf(SubmitLinkCommand), []);
	});

	it("delivers an imported issue into All with the email as its provenance", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(DEFAULT_READLIST_SLUG);
		await pipeline.startImport({ jobId: JOB, destinationAddress });

		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>" });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));

		assert.deepEqual(pipeline.publishedOf(SubmitLinkCommand).map((entry) => entry.detail), [
			{ userId: READER, url: STORY_URL, provenance: { kind: "email", senderEmail: "dan@tldr.tech" }, readlist: DEFAULT_READLIST_SLUG },
		]);
		assert.deepEqual(pipeline.publishedOf(EmailLinksTriagedEvent), []);
	});

	it("routes forwarded mail to the readlist the sender was remapped to", async () => {
		const pipeline = makePipeline();
		const gateway = await pipeline.gatewayAddress();
		await pipeline.mapGatewaySender(await pipeline.readlistAddress(WORK));
		const remapped = await pipeline.readlistAddress(LATER);
		await pipeline.mapGatewaySender(remapped);

		await pipeline.forward({ gateway, messageId: "<issue-43@tldr.tech>", sesMessageId: "ses-43" });
		const received = pipeline.publishedOf(EmailReceivedEvent);
		await pipeline.extractEach(received);

		assert.deepEqual(received.map((entry) => entry.detail), [
			{ userId: READER, receivedAtMessageId: `${FORWARDED_AT}#<issue-43@tldr.tech>`, recipientAddress: remapped, origin: "receive" },
		]);
		assert.deepEqual(pipeline.publishedOf(EmailLinksTriagedEvent).map((entry) => EmailLinksTriagedEvent.detailSchema.parse(entry.detail).readlist), [LATER]);
	});

	it("reports an issue already forwarded as already imported, keeping the single forwarded copy", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const gateway = await pipeline.gatewayAddress();
		await pipeline.mapGatewaySender(destinationAddress);
		await pipeline.forward({ gateway, messageId: "<issue-42@tldr.tech>", sesMessageId: "ses-42" });
		await pipeline.startImport({ jobId: JOB, destinationAddress });

		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>" });

		assert.deepEqual((await pipeline.rows()).map((row) => row.receivedAtMessageId), [`${FORWARDED_AT}#<issue-42@tldr.tech>`]);
		assert.equal(pipeline.publishedOf(EmailReceivedEvent).length, 1);
		assert.deepEqual(pipeline.publishedOf(GmailHistoryImportMessageIngestedEvent).map((entry) => entry.detail), [
			{ userId: READER, jobId: JOB, generation: GENERATION, gmailMessageId: GMAIL_MESSAGE_ID, outcome: "already-imported", receivedAtMessageId: undefined },
		]);
	});

	it("drops a forwarded copy of an issue already imported: no second row and no second announcement", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const gateway = await pipeline.gatewayAddress();
		await pipeline.mapGatewaySender(destinationAddress);
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>" });

		await pipeline.forward({ gateway, messageId: "<issue-42@tldr.tech>", sesMessageId: "ses-42" });

		assert.deepEqual((await pipeline.rows()).map((row) => row.receivedAtMessageId), [`${INTERNAL_DATE}#<issue-42@tldr.tech>`]);
		assert.equal(pipeline.publishedOf(EmailReceivedEvent).length, 1);
	});
});
