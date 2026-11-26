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
	EmailOutputSavedToAllEvent,
	EmailOutputsSelectedEvent,
	EmailReceivedEvent,
	GmailHistoryImportMessageFetchedEvent,
	GmailHistoryImportMessageIngestedEvent,
	type EventDefinition,
	MarkGmailEmailImportedCommand,
	SaveEmailIssueCommand,
	SendFirstInboxEmailNoticeCommand,
	SendTrialFeedbackEmailCommand,
	SubmitLinkCommand,
} from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryEmailIdentity } from "@packages/test-fixtures/providers/email-identity";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailHeldMail } from "@packages/test-fixtures/providers/gmail-held-mail";
import { initInMemoryGmailHistoryImport } from "@packages/test-fixtures/providers/gmail-history-import";
import { initInMemoryGmailMapping } from "@packages/test-fixtures/providers/gmail-mapping";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import {
	initInMemoryEmailImportCompletion,
	initInMemoryInboxEmail,
	initInMemoryInboxEmailLink,
} from "@packages/test-fixtures/providers/inbox-email";
import { initEvaluateGmailImportCompletion } from "../gmail-import-completion/evaluate-gmail-import-completion";
import { initGmailImportCompletionHandler } from "../gmail-import-completion/gmail-import-completion-handler";
import { initRecordDuplicateGmailOrigin } from "../gmail-import-completion/record-gmail-origin";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { z } from "zod";
import { initExtractEmailLinksHandler } from "../inbox/extract-email-links-handler";
import { initIngestGmailImportHandler } from "../inbox/ingest-gmail-import-handler";
import { initIngestParsedEmail } from "../inbox/ingest-parsed-email";
import { initInterceptGmailConfirmation } from "../inbox/intercept-gmail-confirmation";
import { initReceiveEmailHandler } from "../inbox/receive-email-handler";
import { initSettleExtractedEmail } from "../inbox/settle-extracted-email";
import { initDeliverIssueMatches } from "../inbox/deliver-issue-matches";
import { initRecordEmailLinksFilteredHandler } from "../inbox/record-email-links-filtered-handler";
import { initResolveEmailIdentity } from "../inbox/resolve-email-identity";
import { initRouteGmailForwardedEmail } from "./route-gmail-forwarded-email";

const READER = UserIdSchema.parse("00000000000000000000000000000001");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const ACCOUNT = GmailAccountEmailSchema.parse("reader@gmail.com");
const JOB = GmailHistoryImportJobIdSchema.parse(
	"0123456789abcdef0123456789abcdef",
);
const THIRD_JOB = GmailHistoryImportJobIdSchema.parse("2123456789abcdef0123456789abcdef");
const SECOND_JOB = GmailHistoryImportJobIdSchema.parse("1123456789abcdef0123456789abcdef");
const GENERATION = "generation-1";
const GMAIL_MESSAGE_ID = "18c2f0a1b2c3d4e5";
const INTERNAL_DATE = "2026-09-20T07:30:00.000Z";
const FORWARDED_AT = "2026-09-20T07:31:00.000Z";
const NOW = new Date("2026-09-30T00:00:00.000Z");
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const LATER = ReadlistSlugSchema.parse("e5f6a7b8");
const STORY_URL = "https://example.com/story";

const SaveCorrelation = z.object({
	emailOutput: z.object({ receivedAtMessageId: z.string(), outputKey: z.string() }).optional(),
});

type Published = { event: EventDefinition<z.ZodTypeAny>; detail: unknown };

function tldrIssueEml(messageId: string, storyUrls = [STORY_URL]): Buffer {
	return Buffer.from(
		[
			"From: TLDR <dan@tldr.tech>",
			"To: reader@gmail.com",
			"Subject: TLDR 2026-09-20",
			`Message-ID: ${messageId}`,
			"MIME-Version: 1.0",
			'Content-Type: text/html; charset="UTF-8"',
			"",
			...storyUrls.map((url) => `<p><a href="${url}">Story</a></p>`),
			"<p>TLDR</p>",
			"",
		].join("\r\n"),
		"utf8",
	);
}

function makePipeline({ maxLinks = 200, preferences }: { maxLinks?: number; preferences?: string } = {}) {
	const now = () => NOW;
	const logger = Logger.from(noopLogger);
	const addresses = initInMemoryInboxAddress({ now });
	const emails = initInMemoryInboxEmail();
	const completion = initInMemoryEmailImportCompletion({ getEmail: emails.getEmail, listEmailsByUserId: emails.listEmailsByUserId });
	const links = initInMemoryInboxEmailLink();
	const identities = initInMemoryEmailIdentity();
	const imports = initInMemoryGmailHistoryImport();
	const connections = initInMemoryGmailConnection({ now });
	const mappings = initInMemoryGmailMapping({ now });
	const senders = initInMemoryGmailSender({ now });
	const rawObjects = new Map<string, Buffer>();
	const readRawEmail = async (key: string) => rawObjects.get(key);

	const published: Published[] = [];
	let failSupplementalDispatch = false;
	const publishEvent = (async (event, detail) => {
		const parsed = event.detailSchema.parse(detail);
		if (failSupplementalDispatch && event.detailType === EmailReceivedEvent.detailType && EmailReceivedEvent.detailSchema.parse(parsed).supplemental) {
			failSupplementalDispatch = false;
			throw new Error("EventBridge unavailable");
		}
		published.push({ event, detail: parsed });
	}) as PublishEvent;
	const evaluateCompletion = initEvaluateGmailImportCompletion({ findCompletion: completion.findCompletion, publishEvent });
	const recordDuplicateGmailOrigin = initRecordDuplicateGmailOrigin({
		findCompletion: completion.findCompletion,
		addGmailOrigins: completion.addGmailOrigins,
		evaluate: evaluateCompletion,
	});
	const completeImport = initGmailImportCompletionHandler({ acknowledgeOutput: completion.acknowledgeOutput, evaluate: evaluateCompletion, logger });

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
		addGmailOrigins: completion.addGmailOrigins,
		publishEvent,
		logger,
	});

	const ingestImport = initIngestGmailImportHandler({
		resumeAcceptedGmailEmail: initResumeAcceptedGmailEmail({ getEmail: emails.getEmail, addGmailOrigins: completion.addGmailOrigins, publishEvent }),
		claimSupplementalImport: completion.claimSupplementalImport,
		recordDuplicateGmailOrigin,
		readRawEmail,
		deleteRawEmail: async (key: string) => {
			rawObjects.delete(key);
		},
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
		resumeAcceptedGmailEmail: initResumeAcceptedGmailEmail({ getEmail: emails.getEmail, addGmailOrigins: completion.addGmailOrigins, publishEvent }),
		recordDuplicateGmailOrigin,
		settleExtractedEmail: initSettleExtractedEmail({ getEmail: emails.getEmail, findLinksMeta: links.findLinksMeta, recordDuplicateGmailOrigin }),
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
		findConnectedGmailAccount: async (userId) => (await connections.findConnectionByUserId(userId))?.accountEmail,
		routeGmailForwardedEmail: initRouteGmailForwardedEmail({
			connections,
			mappings,
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
		listLinksByEmail: links.listLinksByEmail,
		putLinksMeta: links.putLinksMeta,
		findLinksMeta: links.findLinksMeta,
		markWindowDispatched: links.markWindowDispatched,
		setEmailLinkCounts: emails.setEmailLinkCounts,
		publishCrawlPreview: (input) => publishEvent(CrawlEmailLinkPreview, input),
		publishSubmitLink: (input) => publishEvent(SubmitLinkCommand, input),
		publishEmailLinksTriaged: (input) =>
			publishEvent(EmailLinksTriagedEvent, input),
		publishSaveEmailIssue: (input) => publishEvent(SaveEmailIssueCommand, input),
		findCompletion: completion.findCompletion,
		selectOutputs: completion.selectOutputs,
		publishEmailOutputsSelected: (input) => publishEvent(EmailOutputsSelectedEvent, input),
		amendSelection: completion.amendSelection,
		enqueueContinuation: async () => {},
		publishExtraction: (detail) => publishEvent(EmailReceivedEvent, detail),
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
			{
				slug: LATER,
				label: "Later",
				createdAt: NOW,
				...(preferences === undefined
					? {}
					: { filing: { mode: "smart" as const, purpose: preferences, revision: 1, effectiveAt: NOW } }),
			},
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
		maxLinks,
		appOrigin: "https://readplace.com",
	});

	const run = async (
		handler: typeof receive,
		records: { messageId: string; body: string }[],
		retry = false,
	) => {
		const response = await handler(
			buildSqsEvent(records),
			buildLambdaContext(),
			() => {},
		);
		assert(response, "every handler returns a batch response");
		assert.deepEqual(response.batchItemFailures, retry ? records.map(({ messageId }) => ({ itemIdentifier: messageId })) : []);
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
				accountEmail: ACCOUNT,
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
		jobId?: GmailHistoryImportJobId;
		storyUrls?: string[];
		expectRetry?: true;
		destinationAddress: InboxAddress;
		additionalAddresses?: InboxAddress[];
		messageId: string;
		deliveryMode?: "links" | "issue" | "both";
	}) => {
		const jobId = input.jobId ?? JOB;
		const rawEmailS3Key = `gmail-import/${READER}/${jobId}/${GMAIL_MESSAGE_ID}.eml`;
		rawObjects.set(rawEmailS3Key, tldrIssueEml(input.messageId, input.storyUrls));
		const detail = GmailHistoryImportMessageFetchedEvent.detailSchema.parse({
			userId: READER,
			jobId,
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
		], input.expectRetry);
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

	const recordMatch = initRecordEmailLinksFilteredHandler({
		putReadlistOutcome: links.putReadlistOutcome,
		mergeReadlistOutcomeFit: links.mergeReadlistOutcomeFit,
		listLinksByEmail: links.listLinksByEmail,
		deliverIssueMatches: initDeliverIssueMatches({
			findCompletion: completion.findCompletion,
			amendSelection: completion.amendSelection,
			getEmail: emails.getEmail,
			getLink: links.getLink,
			publishEvent,
		}),
		logger,
	});

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
		await mappings.mapSenderToAddress({
			userId: READER,
			accountEmail: ACCOUNT,
			senderEmail: TLDR,
			mappedAddresses: [mappedAddress, ...additionalAddresses],
			deliveryMode: "links",
		});
		await mappings.addSenderToFilter({
			userId: READER,
			accountEmail: ACCOUNT,
			senderEmail: TLDR,
		});
	};

	const gatewayAddress = async () => {
		const gateway = (
			await addresses.createAddress({
				userId: READER,
				domain: "read.place",
				name: GMAIL_FORWARDING_ALIAS,
				purpose: "gmail-forwarding",
			})
		).address;
		await connections.createConnection({
			userId: READER,
			gatewayAddress: gateway,
		});
		await connections.recordAccountEmail({
			userId: READER,
			accountEmail: ACCOUNT,
		});
		return gateway;
	};

	const rows = async () =>
		(
			await emails.listEmailsByUserId({
				userId: READER,
				cursor: undefined,
				pageSize: 10,
			})
		).emails;

	const publishedOf = (event: EventDefinition<z.ZodTypeAny>) =>
		published.filter((entry) => entry.event === event);

	const confirmSavedToAll = async (entries = [
		...publishedOf(EmailOutputsSelectedEvent),
		...publishedOf(SubmitLinkCommand),
		...publishedOf(SaveEmailIssueCommand),
	]) => {
		const saves = entries.filter(({ event }) => event === SubmitLinkCommand || event === SaveEmailIssueCommand).flatMap((entry) => {
			const { emailOutput } = SaveCorrelation.parse(entry.detail);
			return emailOutput === undefined ? [] : [{ "detail-type": EmailOutputSavedToAllEvent.detailType, detail: { userId: READER, ...emailOutput } }];
		});
		const selections = entries.filter(({ event }) => event === EmailOutputsSelectedEvent).map((entry) => ({ "detail-type": EmailOutputsSelectedEvent.detailType, detail: entry.detail }));
		for (const [index, body] of [...selections, ...saves].entries()) {
			await run(completeImport, [{ messageId: `completion-${index}`, body: JSON.stringify(body) }]);
		}
	};

	return {
		links,
		emails,
		completion,
		failNextSupplementalDispatch: () => { failSupplementalDispatch = true; },
		expireRawCopy: (key: string) => rawObjects.delete(key),
		confirmSavedToAll,
		recordMatch: async (receivedAtMessageId: string) => {
			await run(recordMatch, [{
				messageId: "preference-match",
				body: JSON.stringify({
					"detail-type": "EmailLinksFiltered",
					detail: {
						scope: "email", userId: READER, receivedAtMessageId, readlist: LATER,
						readlistLabel: "Later", decision: "filtered",
						fit: [{ ordinal: "0000", verdict: "keep", reason: "Matches the saved preference" }],
					},
				}),
			}]);
		},
		recordMatchFailed: async (receivedAtMessageId: string) => {
			await run(recordMatch, [{
				messageId: "preference-match-failed",
				body: JSON.stringify({
					"detail-type": "EmailLinksFilterFailed",
					detail: { userId: READER, receivedAtMessageId, readlist: LATER, reason: "decision-retries-exhausted", receiveCount: 3 },
				}),
			}]);
		},
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
	it("imports the linked articles when an unread issue was already saved", async () => {
		const pipeline = makePipeline();
		const issueAddress = await pipeline.readlistAddress(WORK);
		const articleAddress = await pipeline.readlistAddress(LATER);
		const messageId = "<issue-42@tldr.tech>";
		await pipeline.startImport({ jobId: JOB, destinationAddress: issueAddress });
		await pipeline.deliverFetched({ destinationAddress: issueAddress, messageId, deliveryMode: "issue", storyUrls: [STORY_URL, "https://example.com/unsubscribe"] });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		await pipeline.confirmSavedToAll();
		assert.equal(pipeline.publishedOf(MarkGmailEmailImportedCommand).length, 1);

		await pipeline.startImport({ jobId: SECOND_JOB, destinationAddress: articleAddress });
		await pipeline.deliverFetched({
			jobId: SECOND_JOB,
			destinationAddress: articleAddress,
			messageId,
			deliveryMode: "links",
			storyUrls: ["https://example.com/different-fetched-copy"],
		});
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent).slice(1));

		assert.equal((await pipeline.rows()).length, 1);
		assert.equal(pipeline.publishedOf(SaveEmailIssueCommand).length, 1);
		assert.equal(pipeline.publishedOf(CrawlEmailLinkPreview).length, 1);
		assert.deepEqual(pipeline.publishedOf(SubmitLinkCommand).map(({ detail }) => SubmitLinkCommand.detailSchema.parse(detail).url), [STORY_URL]);
		assert.deepEqual(pipeline.publishedOf(EmailLinksTriagedEvent).map(({ detail }) => EmailLinksTriagedEvent.detailSchema.parse(detail).readlist), [LATER]);
		assert.equal(pipeline.publishedOf(MarkGmailEmailImportedCommand).length, 1);
		const marks = () => pipeline.publishedOf(MarkGmailEmailImportedCommand).map(({ detail }) => {
			const mark = MarkGmailEmailImportedCommand.detailSchema.parse(detail);
			assert.equal(mark.origin.kind, "history");
			return [mark.origin.jobId, mark.supplemental];
		});
		await pipeline.confirmSavedToAll([
			...pipeline.publishedOf(EmailOutputsSelectedEvent),
			...pipeline.publishedOf(SaveEmailIssueCommand),
		]);
		assert.deepEqual(marks(), [[JOB, undefined], [JOB, undefined], [JOB, undefined]]);
		await pipeline.confirmSavedToAll(pipeline.publishedOf(SubmitLinkCommand));
		assert.deepEqual(marks(), [[JOB, undefined], [JOB, undefined], [JOB, undefined], [SECOND_JOB, true]]);
	});

	it("requests a plain Gmail update for a covered re-import once the linked articles import is saved", async () => {
		const pipeline = makePipeline();
		const issueAddress = await pipeline.readlistAddress(WORK);
		const articleAddress = await pipeline.readlistAddress(LATER);
		const messageId = "<issue-42@tldr.tech>";
		await pipeline.startImport({ jobId: JOB, destinationAddress: issueAddress });
		await pipeline.deliverFetched({ destinationAddress: issueAddress, messageId, deliveryMode: "issue" });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		await pipeline.confirmSavedToAll();
		await pipeline.startImport({ jobId: SECOND_JOB, destinationAddress: articleAddress });
		await pipeline.deliverFetched({ jobId: SECOND_JOB, destinationAddress: articleAddress, messageId, deliveryMode: "links" });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent).slice(1));
		await pipeline.confirmSavedToAll(pipeline.publishedOf(SubmitLinkCommand));

		await pipeline.startImport({ jobId: THIRD_JOB, destinationAddress: issueAddress });
		await pipeline.deliverFetched({ jobId: THIRD_JOB, destinationAddress: issueAddress, messageId, deliveryMode: "both" });

		const marks = pipeline.publishedOf(MarkGmailEmailImportedCommand).map(({ detail }) => MarkGmailEmailImportedCommand.detailSchema.parse(detail));
		const jobOf = (origin: (typeof marks)[number]["origin"]) => origin.kind === "history" ? origin.jobId : undefined;
		assert.deepEqual(marks.map((mark) => [jobOf(mark.origin), mark.supplemental]), [
			[JOB, undefined],
			[SECOND_JOB, true],
			[JOB, undefined],
			[THIRD_JOB, undefined],
		]);
		assert.deepEqual(pipeline.publishedOf(GmailHistoryImportMessageIngestedEvent).map(({ detail }) => GmailHistoryImportMessageIngestedEvent.detailSchema.parse(detail).outcome), ["imported", "imported", "already-imported"]);
	});

	it.each([
		{ initial: "links", next: "issue" },
		{ initial: "links", next: "both" },
		{ initial: "issue", next: "both" },
	] as const)("adds only the missing part when $initial changes to $next", async ({ initial, next }) => {
		const pipeline = makePipeline();
		const first = await pipeline.readlistAddress(WORK);
		const second = await pipeline.readlistAddress(LATER);
		const messageId = "<issue-42@tldr.tech>";
		await pipeline.startImport({ jobId: JOB, destinationAddress: first });
		await pipeline.deliverFetched({ destinationAddress: first, messageId, deliveryMode: initial });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		await pipeline.confirmSavedToAll();
		await pipeline.startImport({ jobId: SECOND_JOB, destinationAddress: second });
		await pipeline.deliverFetched({ jobId: SECOND_JOB, destinationAddress: second, messageId, deliveryMode: next });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent).slice(1));

		assert.equal((await pipeline.rows()).length, 1);
		assert.equal(pipeline.publishedOf(SubmitLinkCommand).length, 1);
		assert.deepEqual(
			pipeline.publishedOf(SaveEmailIssueCommand).map(({ detail }) => SaveEmailIssueCommand.detailSchema.parse(detail).readlists),
			[[initial === "issue" ? WORK : LATER]],
		);
		assert.deepEqual(
			pipeline.publishedOf(EmailLinksTriagedEvent).map(({ detail }) => EmailLinksTriagedEvent.detailSchema.parse(detail).readlist),
			[initial === "links" ? WORK : LATER],
		);
		const { meta } = await pipeline.links.listLinksByEmail({ userId: READER, receivedAtMessageId: (await pipeline.rows())[0].receivedAtMessageId });
		assert.deepEqual(meta?.issueSave?.readlists.map(({ readlist }) => readlist), [initial === "issue" ? WORK : LATER]);
		assert.deepEqual(meta?.selectedReadlists?.map(({ readlist }) => readlist), [initial === "links" ? WORK : LATER]);
	});

	it("redelivers the accepted destinations after dispatch fails and can extract from the fresh copy", async () => {
		const pipeline = makePipeline();
		const first = await pipeline.readlistAddress(WORK);
		const second = await pipeline.readlistAddress(LATER);
		const messageId = "<issue-42@tldr.tech>";
		await pipeline.startImport({ jobId: JOB, destinationAddress: first });
		await pipeline.deliverFetched({ destinationAddress: first, messageId, deliveryMode: "issue" });
		pipeline.expireRawCopy((await pipeline.rows())[0].rawEmailS3Key);
		await pipeline.startImport({ jobId: SECOND_JOB, destinationAddress: second });
		const fetched = { jobId: SECOND_JOB, destinationAddress: second, messageId };
		pipeline.failNextSupplementalDispatch();
		await pipeline.deliverFetched({ ...fetched, expectRetry: true });
		assert.equal(pipeline.publishedOf(EmailReceivedEvent).length, 1);

		await pipeline.deliverFetched(fetched);
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent).slice(1));

		assert.deepEqual(pipeline.publishedOf(SubmitLinkCommand).map(({ detail }) => SubmitLinkCommand.detailSchema.parse(detail).url), [STORY_URL]);
		assert.deepEqual(pipeline.publishedOf(EmailLinksTriagedEvent).map(({ detail }) => EmailLinksTriagedEvent.detailSchema.parse(detail).readlist), [LATER]);
		assert.deepEqual(pipeline.publishedOf(GmailHistoryImportMessageIngestedEvent).map(({ detail }) => GmailHistoryImportMessageIngestedEvent.detailSchema.parse(detail).outcome), ["imported", "imported"]);
	});

	it("reports already imported and requests a Gmail update for each job when the delivery mode is covered and only destinations change", async () => {
		const pipeline = makePipeline();
		const first = await pipeline.readlistAddress(WORK);
		const second = await pipeline.readlistAddress(LATER);
		const messageId = "<issue-42@tldr.tech>";
		await pipeline.startImport({ jobId: JOB, destinationAddress: first });
		await pipeline.deliverFetched({ destinationAddress: first, messageId });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		await pipeline.confirmSavedToAll();
		await pipeline.startImport({ jobId: SECOND_JOB, destinationAddress: second });
		await pipeline.deliverFetched({ jobId: SECOND_JOB, destinationAddress: second, messageId });

		assert.equal(pipeline.publishedOf(EmailReceivedEvent).length, 1);
		const origins = pipeline.publishedOf(MarkGmailEmailImportedCommand).map(({ detail }) => MarkGmailEmailImportedCommand.detailSchema.parse(detail).origin);
		assert.deepEqual(origins.map((origin) => origin.kind === "history" ? origin.jobId : undefined), [JOB, JOB, SECOND_JOB]);
		assert.deepEqual(pipeline.publishedOf(GmailHistoryImportMessageIngestedEvent).map(({ detail }) => GmailHistoryImportMessageIngestedEvent.detailSchema.parse(detail).outcome), ["imported", "already-imported"]);
	});

	it("records a completed article pass with no eligible links", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const messageId = "<issue-42@tldr.tech>";
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId, deliveryMode: "issue", storyUrls: [] });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		await pipeline.startImport({ jobId: SECOND_JOB, destinationAddress });
		await pipeline.deliverFetched({ jobId: SECOND_JOB, destinationAddress, messageId, storyUrls: [] });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent).slice(1));
		await pipeline.startImport({ jobId: THIRD_JOB, destinationAddress });
		await pipeline.deliverFetched({ jobId: THIRD_JOB, destinationAddress, messageId, storyUrls: [] });

		assert.equal(pipeline.publishedOf(SubmitLinkCommand).length, 0);
		assert.equal((await pipeline.completion.findCompletion({ userId: READER, receivedAtMessageId: (await pipeline.rows())[0].receivedAtMessageId }))?.supplementalSelection?.outputs.length, 0);
		assert.deepEqual(pipeline.publishedOf(GmailHistoryImportMessageIngestedEvent).map(({ detail }) => GmailHistoryImportMessageIngestedEvent.detailSchema.parse(detail).outcome), ["imported", "imported", "already-imported"]);
	});

	it("saves a missing issue even when the original article extraction was truncated", async () => {
		const pipeline = makePipeline({ maxLinks: 1 });
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const messageId = "<issue-42@tldr.tech>";
		const storyUrls = [STORY_URL, "https://example.com/second-story"];
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId, storyUrls });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		await pipeline.confirmSavedToAll();
		assert.equal(pipeline.publishedOf(MarkGmailEmailImportedCommand).length, 0);

		await pipeline.startImport({ jobId: SECOND_JOB, destinationAddress });
		await pipeline.deliverFetched({ jobId: SECOND_JOB, destinationAddress, messageId, deliveryMode: "issue", storyUrls });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent).slice(1));
		await pipeline.confirmSavedToAll(pipeline.publishedOf(SaveEmailIssueCommand));

		assert.equal(pipeline.publishedOf(SaveEmailIssueCommand).length, 1);
		assert.equal(pipeline.publishedOf(MarkGmailEmailImportedCommand).length, 1);
	});

	it("accepts one concurrent import and resumes only unacknowledged article saves on redelivery", async () => {
		const pipeline = makePipeline();
		const first = await pipeline.readlistAddress(WORK);
		const second = await pipeline.readlistAddress(LATER);
		const messageId = "<issue-42@tldr.tech>";
		const storyUrls = [STORY_URL, "https://example.com/second-story"];
		await pipeline.startImport({ jobId: JOB, destinationAddress: first });
		await pipeline.deliverFetched({ destinationAddress: first, messageId, deliveryMode: "issue", storyUrls });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		await pipeline.confirmSavedToAll();
		await pipeline.startImport({ jobId: SECOND_JOB, destinationAddress: second });
		await pipeline.startImport({ jobId: THIRD_JOB, destinationAddress: first });
		await Promise.all([
			pipeline.deliverFetched({ jobId: SECOND_JOB, destinationAddress: second, messageId, storyUrls }),
			pipeline.deliverFetched({ jobId: THIRD_JOB, destinationAddress: first, messageId, storyUrls }),
		]);

		const received = pipeline.publishedOf(EmailReceivedEvent).slice(1);
		assert.equal(received.length, 1);
		await pipeline.extractEach(received);
		const saves = pipeline.publishedOf(SubmitLinkCommand);
		assert.equal(saves.length, 2);
		await pipeline.confirmSavedToAll(saves.slice(0, 1));
		await pipeline.extractEach(received);

		assert.equal(pipeline.publishedOf(MarkGmailEmailImportedCommand).length, 1);
		assert.deepEqual(pipeline.publishedOf(SubmitLinkCommand).map(({ detail }) => SubmitLinkCommand.detailSchema.parse(detail).url), [...storyUrls, storyUrls[1]]);
		await pipeline.confirmSavedToAll(saves.slice(1));
		assert.equal(pipeline.publishedOf(MarkGmailEmailImportedCommand).length, 2);
	});

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
					scope: "email",
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
				requestedAt: INTERNAL_DATE,
				saveTrigger: "automatic",
				saveAttemptId: expect.any(String),
				emailOutput: { receivedAtMessageId: expect.any(String), outputKey: "link#0000" },
			},
		]);
	});

	it("delivers an imported issue into the default readlist with the email as its provenance", async () => {
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
				requestedAt: INTERNAL_DATE,
				saveTrigger: "automatic",
				readlist: DEFAULT_READLIST_SLUG,
				saveAttemptId: expect.any(String),
				emailOutput: { receivedAtMessageId: expect.any(String), outputKey: "link#0000" },
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

	const HISTORY_ORIGIN = {
	jobId: JOB, kind: "history", accountEmail: ACCOUNT, gmailMessageId: GMAIL_MESSAGE_ID, senderEmail: TLDR };
	const FORWARDED_ORIGIN = { kind: "forwarded", accountEmail: ACCOUNT, senderEmail: TLDR, rfcMessageId: "issue-42@tldr.tech" };

	it("asks for the imported Gmail message to be marked only after its saves are confirmed in the default readlist", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>" });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));

		assert.deepEqual(pipeline.publishedOf(MarkGmailEmailImportedCommand), []);

		await pipeline.confirmSavedToAll();

		assert.deepEqual(
			pipeline.publishedOf(MarkGmailEmailImportedCommand).map(({ detail }) => detail),
			[{ userId: READER, receivedAtMessageId: `${INTERNAL_DATE}#<issue-42@tldr.tech>`, origin: HISTORY_ORIGIN }],
		);
	});

	it("waits for the preference match on a newly imported issue and saves its matched article once", async () => {
		const pipeline = makePipeline({ preferences: "News about building software" });
		const destinationAddress = await pipeline.readlistAddress(WORK);
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>", deliveryMode: "issue" });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));

		expect(pipeline.publishedOf(EmailLinksTriagedEvent).map(({ detail }) =>
			EmailLinksTriagedEvent.detailSchema.parse(detail).readlist,
		)).toEqual([LATER]);
		await pipeline.confirmSavedToAll();
		expect(pipeline.publishedOf(MarkGmailEmailImportedCommand)).toHaveLength(0);
		const [row] = await pipeline.rows();
		await pipeline.recordMatch(row.receivedAtMessageId);
		expect(pipeline.publishedOf(SubmitLinkCommand)).toHaveLength(1);
		await pipeline.confirmSavedToAll();
		await pipeline.recordMatch(row.receivedAtMessageId);
		expect(pipeline.publishedOf(SubmitLinkCommand)).toHaveLength(1);
		expect(pipeline.publishedOf(MarkGmailEmailImportedCommand).map(({ detail }) => detail)).toContainEqual({
			userId: READER, receivedAtMessageId: row.receivedAtMessageId, origin: HISTORY_ORIGIN,
		});
	});

	it("finishes a newly imported issue when its preference match fails, and still saves a redriven match", async () => {
		const pipeline = makePipeline({ preferences: "News about building software" });
		const destinationAddress = await pipeline.readlistAddress(WORK);
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>", deliveryMode: "issue" });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		await pipeline.confirmSavedToAll();
		const [row] = await pipeline.rows();

		await pipeline.recordMatchFailed(row.receivedAtMessageId);
		await pipeline.confirmSavedToAll();
		expect(pipeline.publishedOf(SubmitLinkCommand)).toHaveLength(0);
		expect(pipeline.publishedOf(MarkGmailEmailImportedCommand).map(({ detail }) => detail)).toContainEqual({
			userId: READER, receivedAtMessageId: row.receivedAtMessageId, origin: HISTORY_ORIGIN,
		});

		await pipeline.recordMatch(row.receivedAtMessageId);
		expect(pipeline.publishedOf(SubmitLinkCommand)).toHaveLength(1);
	});

	it("marks an issue-mode import once the whole issue is confirmed in the default readlist", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>", deliveryMode: "issue" });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));

		assert.deepEqual(
			pipeline.publishedOf(SaveEmailIssueCommand).map(({ detail }) => SaveEmailIssueCommand.detailSchema.parse(detail).emailOutput),
			[{ receivedAtMessageId: `${INTERNAL_DATE}#<issue-42@tldr.tech>`, outputKey: "issue" }],
		);
		await pipeline.confirmSavedToAll();

		assert.equal(pipeline.publishedOf(MarkGmailEmailImportedCommand).length, 1);
	});

	it("replays the frozen selection when extraction is retried, dispatching the same outputs again", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>" });
		const received = pipeline.publishedOf(EmailReceivedEvent);

		await pipeline.extractEach(received);
		await pipeline.extractEach(received);

		const outputs = pipeline.publishedOf(SubmitLinkCommand).map(({ detail }) => SaveCorrelation.parse(detail).emailOutput?.outputKey);
		assert.deepEqual(outputs, ["link#0000", "link#0000"]);
		assert.deepEqual(
			pipeline.publishedOf(EmailOutputsSelectedEvent).map(({ detail }) => detail),
			[
				{ userId: READER, receivedAtMessageId: `${INTERNAL_DATE}#<issue-42@tldr.tech>`, outputCount: 1 },
				{ userId: READER, receivedAtMessageId: `${INTERNAL_DATE}#<issue-42@tldr.tech>`, outputCount: 1 },
			],
		);
	});

	it("repeats nothing when a notification is redelivered after its outputs are confirmed in the default readlist", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const gateway = await pipeline.gatewayAddress();
		await pipeline.mapGatewaySender(destinationAddress);
		await pipeline.forward({ gateway, messageId: "<issue-42@tldr.tech>", sesMessageId: "ses-42" });
		const received = pipeline.publishedOf(EmailReceivedEvent);
		await pipeline.extractEach(received);
		await pipeline.confirmSavedToAll();

		await pipeline.forward({ gateway, messageId: "<issue-42@tldr.tech>", sesMessageId: "ses-42" });
		await pipeline.extractEach(received);

		assert.equal(pipeline.publishedOf(EmailReceivedEvent).length, 1);
		assert.equal((await pipeline.rows()).length, 1);
		assert.deepEqual(
			pipeline.publishedOf(SubmitLinkCommand).map(({ detail }) => SaveCorrelation.parse(detail).emailOutput?.outputKey),
			["link#0000"],
		);
		const forwardedMark = { userId: READER, receivedAtMessageId: `${FORWARDED_AT}#<issue-42@tldr.tech>`, origin: FORWARDED_ORIGIN };
		assert.deepEqual(
			pipeline.publishedOf(MarkGmailEmailImportedCommand).map(({ detail }) => detail),
			[forwardedMark, forwardedMark],
		);
	});

	it("requests a new Gmail update for a fresh unread import while reusing the saved email", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const messageId = "<issue-42@tldr.tech>";
		const freshJob = GmailHistoryImportJobIdSchema.parse("fedcba9876543210fedcba9876543210");

		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));
		assert.equal(pipeline.publishedOf(MarkGmailEmailImportedCommand).length, 0);
		await pipeline.confirmSavedToAll();

		await pipeline.startImport({ jobId: freshJob, destinationAddress });
		await pipeline.deliverFetched({ jobId: freshJob, destinationAddress, messageId });
		await pipeline.deliverFetched({ jobId: freshJob, destinationAddress, messageId });

		assert.equal((await pipeline.rows()).length, 1);
		assert.equal(pipeline.publishedOf(SubmitLinkCommand).length, 1);
		const origins = pipeline.publishedOf(MarkGmailEmailImportedCommand).map(({ detail }) => MarkGmailEmailImportedCommand.detailSchema.parse(detail).origin);
		assert.deepEqual(new Set(origins.map((origin) => origin.kind === "history" ? origin.jobId : undefined)), new Set([JOB, freshJob]));
		assert.equal(origins.filter((origin) => origin.kind === "history" && origin.jobId === freshJob).length, 2);
	});

	it("marks both the forwarded and the imported Gmail copies of one issue on the single canonical email", async () => {
		const pipeline = makePipeline();
		const destinationAddress = await pipeline.readlistAddress(WORK);
		const gateway = await pipeline.gatewayAddress();
		await pipeline.mapGatewaySender(destinationAddress);
		await pipeline.forward({ gateway, messageId: "<issue-42@tldr.tech>", sesMessageId: "ses-42" });
		await pipeline.startImport({ jobId: JOB, destinationAddress });
		await pipeline.deliverFetched({ destinationAddress, messageId: "<issue-42@tldr.tech>" });
		await pipeline.extractEach(pipeline.publishedOf(EmailReceivedEvent));

		await pipeline.confirmSavedToAll();

		assert.deepEqual(
			pipeline.publishedOf(MarkGmailEmailImportedCommand).map(({ detail }) => detail),
			[
				{ userId: READER, receivedAtMessageId: `${FORWARDED_AT}#<issue-42@tldr.tech>`, origin: FORWARDED_ORIGIN },
				{ userId: READER, receivedAtMessageId: `${FORWARDED_AT}#<issue-42@tldr.tech>`, origin: HISTORY_ORIGIN },
			],
		);
	});
});

for (const delivery of ["forward", "import"] as const) {
	it(`keeps a ${delivery} article in the default readlist while custom lists accept, reject, and fail independently`, async () => {
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
				requestedAt: delivery === "forward" ? FORWARDED_AT : INTERNAL_DATE,
				saveTrigger: "automatic",
				readlist: DEFAULT_READLIST_SLUG,
				saveAttemptId: expect.any(String),
				emailOutput: { receivedAtMessageId: expect.any(String), outputKey: "link#0000" },
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
		const recordOutcome = initRecordEmailLinksFilteredHandler({ deliverIssueMatches: async () => {},
			putReadlistOutcome: pipeline.links.putReadlistOutcome,
			mergeReadlistOutcomeFit: pipeline.links.mergeReadlistOutcomeFit,
			listLinksByEmail: pipeline.links.listLinksByEmail,
			logger: Logger.from(noopLogger),
		});
		const details = [
			{
				"detail-type": "EmailLinksFiltered",
				detail: {
					scope: "email",
					userId: READER,
					receivedAtMessageId: row.receivedAtMessageId,
					readlist: WORK,
					readlistLabel: "Work",
					decision: "filtered",
					fit: [{ ordinal: "0000", verdict: "keep", reason: "Fits this list" }],
				},
			},
			{
				"detail-type": "EmailLinksFiltered",
				detail: {
					scope: "email",
					userId: READER,
					receivedAtMessageId: row.receivedAtMessageId,
					readlist: LATER,
					readlistLabel: "Later",
					decision: "filtered",
					fit: [{ ordinal: "0000", verdict: "drop", reason: "Outside this list" }],
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
		assert.equal(links.length, 1);
		assert.deepEqual(
			meta?.readlistOutcomes?.map(({ readlist, decision, fit }) => ({
				readlist,
				decision,
				verdicts: fit.map(({ verdict }) => verdict),
			})),
			[
				{ readlist: WORK, decision: "filtered", verdicts: ["keep"] },
				{ readlist: LATER, decision: "filtered", verdicts: ["drop"] },
				{ readlist: failed, decision: "failed", verdicts: [] },
			],
		);
	});
}
