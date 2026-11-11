import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initCanonicalAliasStore, initFindSavedArticleForLink } from "@packages/article-store";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { z } from "zod";
import { type Logger, noopLogger } from "@packages/logger";
import { markCrawlExhausted } from "@packages/domain/article-aggregate";
import {
	MinutesSchema,
	ReaderArticleHashId,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
	articleDestinationUrl,
	articleDisplayMetadata,
	validateSaveableUrl,
	ANONYMOUS_VIEWER,
} from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	EmailLinksFilteredEvent,
	FileArticleIntoReadlistCommand,
	QueueEntryCreatedEvent,
	TierContentExtractedEvent,
	EmailOutputSavedToAllEvent,
	LinkQueueFailedEvent,
	LinkQueuedEvent,
} from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { RefreshIdentifiedArticleIfStale, ResolvedSaveIdentity } from "@packages/provider-contracts/article-freshness";
import type { DecideReadlistFit } from "@packages/readlist-fit";
import {
	initFileRequestedArticleIntoReadlist,
	initResolveCanonicalIdentity,
	initResolveSaveIdentity,
	initSubmitFreshness,
} from "@packages/save-article";
import { ArticlePurgedAfterRequest } from "@packages/provider-contracts/article-store";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initRecordingPublishEvent } from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import type {
	CrawlAndFinalizeArticle,
	CrawlAndFinalizeResult,
	FinalizedArticle,
} from "@packages/finalize-article";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initSubmitLinkCommandHandler } from "./submit-link-command-handler";
import { SUBMIT_LINK_MAX_RECEIVE_COUNT } from "./max-receive-count";
import { initFileArticleIntoReadlistCommandHandler } from "../file-article-into-readlist/file-article-into-readlist-command-handler";
import { initAdmitTriagedMessage } from "../filter-email-links/triaged-message-admission";
import { initFilingsLeftToFile } from "../filter-email-links/filings-left-to-file";
import { initFilterEmailLinksHandler } from "../filter-email-links/filter-email-links-handler";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const exampleUrl = SaveableUrlSchema.parse("https://example.com/post");
const exampleDestination = articleDestinationUrl({ url: exampleUrl, displayUrl: undefined });

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(
	details: Array<{
		url: string;
		userId?: string;
		rawHtml?: string;
		provenance?: unknown;
		saveTrigger?: string;
		readlist?: string;
		emailOutput?: { receivedAtMessageId: string; outputKey: string };
	}>,
	requestedAt = "2026-06-02T00:00:00Z",
): SQSEvent {
	return {
		Records: details.map((detail, index) => ({
			messageId: `msg-${index + 1}`,
			receiptHandle: `receipt-${index + 1}`,
			body: JSON.stringify({
				time: requestedAt,
				detail:
					detail.userId === undefined
						? { saveAttemptId: `attempt-${index + 1}`, ...detail }
						: { saveAttemptId: `attempt-${index + 1}`, provenance: { kind: "web" }, saveTrigger: "manual", readlist: "default", ...detail },
			}),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SubmitLinkCommand",
			awsRegion: "ap-southeast-2",
		})),
	};
}

function makeSaved(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: articleId,
		userId,
		url: exampleUrl,
		destinationUrl: exampleDestination,
		metadata: articleDisplayMetadata({ url: exampleUrl, destinationUrl: exampleDestination, title: "", siteName: "", excerpt: "", wordCount: 0, imageUrl: undefined, publishedOn: undefined, viewer: ANONYMOUS_VIEWER, ownerUserId: undefined }),
		servedBody: { kind: "legacy" },
		estimatedReadTime: MinutesSchema.parse(0),
		status: "unread",
		savedAt: new Date("2026-06-01T00:00:00.000Z"),
		...overrides,
	};
}

const stubFinalizedArticle: FinalizedArticle = {
	html: "<p>Article content</p>",
	metadata: {
		title: "Test",
		siteName: "example.com",
		excerpt: "test",
		wordCount: 10,
		estimatedReadTime: 1,
		imageUrl: undefined,
	},
};

const fetchedResult: CrawlAndFinalizeResult = {
	status: "fetched",
	article: stubFinalizedArticle,
	evaluationHtml: stubFinalizedArticle.html,
	bodyHash: "a".repeat(64),
};

const rejectingEmitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported = async () => {
	throw new Error("emitSimpleCrawlUnsupported invoked unexpectedly");
};

type HandlerDeps = Parameters<typeof initSubmitLinkCommandHandler>[0];

function refreshAs(
	action: "new" | "skip",
	identityOf = (url: string): ResolvedSaveIdentity => ({ status: "resolved", url, originalUrl: url }),
): RefreshIdentifiedArticleIfStale {
	return async ({ url }) => ({ action, identity: identityOf(url) });
}

const fixedNow = () => new Date("2026-06-01T12:00:00.000Z");
const allocatedSavedAt = new Date("2026-06-01T12:00:00.777Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initSubmitLinkCommandHandler({
		verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
		resolveOriginalUrl: async (url) => url,
		validateSaveableUrl,
		saveArticleAsRequested: jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true }),
		allocateSavedAt: jest.fn().mockResolvedValue(allocatedSavedAt),
		saveReadlistArticleAsRequested: jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true }),
		updateArticleStatusAcrossReadlists: jest.fn().mockResolvedValue(true),
		assignSavedArticleToReadlist: jest.fn().mockResolvedValue(undefined),
		hasSaveLandedSince: jest.fn().mockResolvedValue(false),
		resolveSubmitterStanding: async () => "may-save",
		resolveSaveIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
		recordInboxArticleQueued: jest.fn().mockResolvedValue(undefined),
		updateArticleStatus: jest.fn().mockResolvedValue(true),
		markCrawlPending: jest.fn().mockResolvedValue({ kind: "marked" }),
		markSummaryPending: jest.fn().mockResolvedValue(undefined),
		publishUpdateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		refreshArticleIfStale: refreshAs("new"),
		pinContentSource: jest.fn().mockResolvedValue(undefined),
		crawlAndFinalizeArticle: (async () => fetchedResult) as CrawlAndFinalizeArticle,
		emitSimpleCrawlUnsupported: rejectingEmitSimpleCrawlUnsupported,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		isSiteRuleUrl: () => false,
		publishEvent: initRecordingPublishEvent().publishEvent,
		now: fixedNow,
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({
			tier0Status: "not_attempted",
			tier1Status: "not_attempted",
			pickedTier: "none",
		}),
		...overrides,
	});
}

/** The detail types published, in order — every accepted save emits LinkQueued,
 * so a test that cares about the crawl chain names what it expects beside it. */
function publishedDetailTypes(published: ReadonlyArray<{ detailType: string }>): string[] {
	return published.map((entry) => entry.detailType);
}

async function run(handler: ReturnType<typeof createHandler>, event: SQSEvent) {
	const response = await handler(event, buildLambdaContext(), () => undefined);
	if (!response) throw new Error("handler returned no response");
	return response;
}

describe("initSubmitLinkCommandHandler", () => {
	it("saves an oversized newsletter tracker at its destination and reuses the bounded alias on a repeated submission", async () => {
		const tracker = `https://link.mail.beehiiv.com/ss/c/u001.${"a".repeat(2800)}`;
		const destination = "https://publisher.example/article";
		const rows = new Map<string, Record<string, unknown>>();
		const storageKeys: string[] = [];
		const commandSchema = z.object({ input: z.object({
			Key: z.object({ url: z.string() }),
			UpdateExpression: z.string().optional(),
			ExpressionAttributeValues: z.record(z.string(), z.string()).optional(),
		}) });
		// The SDK's overloaded send signature requires this isolated fake assertion;
		// every command is parsed and checked before its alias read or write runs.
		const client = { send: async (command: unknown) => {
			const { input } = commandSchema.parse(command);
			const key = input.Key.url;
			assert(Buffer.byteLength(key, "utf8") <= 2048, "an alias operation must fit DynamoDB's partition key limit");
			storageKeys.push(key);
			if (input.UpdateExpression === undefined) return { Item: rows.get(key) };
			assert(input.UpdateExpression.startsWith("SET "), "the alias fake accepts only SET writes");
			const values = input.ExpressionAttributeValues;
			assert(values, "an alias write must carry its values");
			const row = { ...rows.get(key) };
			for (const assignment of input.UpdateExpression.slice(4).split(", ")) {
				const [field, value] = assignment.split(" = ");
				assert(field !== undefined && value !== undefined && values[value] !== undefined, "every alias assignment must name a value");
				row[field] = values[value];
			}
			rows.set(key, row);
			return {};
		} } as unknown as DynamoDBDocumentClient;
		const aliases = initCanonicalAliasStore({ client, tableName: "articles" });
		const store = initInMemoryArticleStore();
		const redirectRequests: string[] = [];
		const articleOperations: string[] = [];
		const recordArticle = (url: string) => {
			expect(url).toBe(destination);
			articleOperations.push(url);
		};
		const { refreshArticleIfStale } = initSubmitFreshness({
			resolveSaveIdentity: initResolveSaveIdentity({
				validateUrl: validateSaveableUrl,
				findIdentityRow: aliases.findIdentityRow,
				claimAlias: aliases.claimAlias,
				resolveWrapperTarget: async (url) => {
					redirectRequests.push(url);
					return { url: destination, contentSourceUrl: tracker };
				},
				now: fixedNow,
			}),
			findArticleByUrl: async (url) => { recordArticle(url); return store.findArticleByUrl(url); },
			findArticleCrawlStatus: async (url) => { recordArticle(url); return { status: "ready" }; },
			publishStaleCheckRequested: async ({ url }) => { recordArticle(url); },
		});
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			refreshArticleIfStale,
			saveArticleAsRequested: async (params) => { recordArticle(params.url); return store.saveArticleAsRequested(params); },
			saveReadlistArticleAsRequested: async (params) => { recordArticle(params.url); return store.saveReadlistArticleAsRequested(params); },
			allocateSavedAt: store.allocateSavedAt,
			markCrawlPending: async ({ url }) => { recordArticle(url); return { kind: "marked" }; },
			markSummaryPending: async ({ url }) => { recordArticle(url); },
			publishUpdateFetchTimestamp: async ({ url }) => { recordArticle(url); },
			crawlAndFinalizeArticle: async (params) => { recordArticle(params.url); return fetchedResult; },
			publishEvent,
		});
		const submission = createSqsEvent([{ url: tracker, userId, provenance: { kind: "email", senderEmail: "letter@example.com" }, saveTrigger: "automatic" }]);

		expect((await run(handler, submission)).batchItemFailures).toEqual([]);
		expect((await run(handler, submission)).batchItemFailures).toEqual([]);

		expect(redirectRequests).toEqual([tracker]);
		expect(await aliases.resolveAlias(tracker)).toBe(destination);
		expect(new Set(storageKeys).size).toBe(2);
		expect(new Set(articleOperations)).toEqual(new Set([destination]));
		expect(await store.findQueueRowKeys({ userId, urls: [destination] })).toEqual([
			{ userId, url: ArticleResourceUniqueId.parse(destination).value },
		]);
		expect(published.filter(({ detailType }) => detailType === LinkQueuedEvent.detailType).map(({ detail }) => detail)).toEqual([
			{ userId, url: tracker },
			{ userId, url: tracker },
		]);
	});

	it("converges duplicate Gmail saves on one canonical membership in All and each accepted custom list", async () => {
		const store = initInMemoryArticleStore();
		const accepted = ReadlistSlugSchema.parse("engineering");
		const rejected = ReadlistSlugSchema.parse("travel");
		const unavailable = ReadlistSlugSchema.parse("finance");
		const canonical = "https://example.com/canonical";
		for (const slug of [accepted, rejected, unavailable]) {
			await store.createReadlistDefinition({ userId, slug, label: slug, createdAt: fixedNow() });
			await store.setReadlistDefinitionPurpose({ userId, slug, purpose: slug });
		}
		const submit = createHandler({
			saveArticleAsRequested: store.saveArticleAsRequested,
			allocateSavedAt: store.allocateSavedAt,
			updateArticleStatus: store.updateArticleStatus,
			saveReadlistArticleAsRequested: store.saveReadlistArticleAsRequested,
			updateArticleStatusAcrossReadlists: store.updateArticleStatusAcrossReadlists,
			assignSavedArticleToReadlist: store.assignSavedArticleToReadlist,
			refreshArticleIfStale: refreshAs("skip", () => ({ status: "resolved", url: canonical, originalUrl: canonical })),
		});
		const initial = createSqsEvent([{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "letter@example.com" }, saveTrigger: "automatic" }]);
		expect((await run(submit, initial)).batchItemFailures).toEqual([]);
		expect((await run(submit, initial)).batchItemFailures).toEqual([]);
		await store.claimAlias({ aliasUrl: exampleUrl, targetOriginalUrl: canonical, now: fixedNow() });
		const fileIntoReadlist = initFileArticleIntoReadlistCommandHandler({
			findSavedArticleForLink: initFindSavedArticleForLink({
				resolveCanonicalIdentity: initResolveCanonicalIdentity({ findIdentityRow: store.findIdentityRow }),
				findArticleById: store.findArticleById,
			}),
			listReadlistDefinitions: store.listReadlistDefinitions,
			fileRequestedArticleIntoReadlist: initFileRequestedArticleIntoReadlist({
				...store,
				resolveCanonicalIdentity: initResolveCanonicalIdentity({ findIdentityRow: store.findIdentityRow }),
			}),
			publishEvent: async () => {},
			logger: noopLogger,
		});
		const terminal: unknown[] = [];
		const publishEvent: PublishEvent = async (event, detail) => {
			if (event.detailType === FileArticleIntoReadlistCommand.detailType) {
				const result = await run(fileIntoReadlist, buildSqsEvent([{ messageId: "file", body: JSON.stringify({ detail, time: fixedNow().toISOString() }) }]));
				expect(result.batchItemFailures).toEqual([]);
			}
			if (event.detailType === EmailLinksFilteredEvent.detailType) terminal.push(detail);
		};
		const decideReadlistFit: DecideReadlistFit = async ({ purpose, candidates }) => {
			if (purpose.keep === unavailable) throw new Error("Custom filtering unavailable");
			return {
				decisions: candidates.map(({ id }) => ({
					id,
					verdict: purpose.keep === accepted ? "keep" : "drop",
					reason: "Judged against this readlist's purpose",
				})),
				engine: "deepseek-flash",
				model: "deepseek-chat",
				usage: { inputTokens: 10, outputTokens: 10, reasoningTokens: 0 },
			};
		};
		const discardLines: Logger.Typed<unknown> = {
			info: () => {},
			error: () => {},
			warn: () => {},
			debug: () => {},
		};
		const inboxEmailLinks = initInMemoryInboxEmailLink();
		await inboxEmailLinks.putLinksMeta({
			userId,
			receivedAtMessageId: "2026-10-04#gmail-issue",
			meta: {
				truncated: false,
				extractionFailed: false,
				selectedReadlists: [accepted, rejected, unavailable].map((readlist) => ({ readlist, label: readlist })),
			},
		});
		const filter = initFilterEmailLinksHandler({
			listReadlistDefinitions: store.listReadlistDefinitions,
			listReadlistFitOverrides: store.listReadlistFitOverrides,
			admitTriagedMessage: initAdmitTriagedMessage({
				listLinksByEmail: inboxEmailLinks.listLinksByEmail,
				findSubscriptionByUserId: async () => undefined,
				now: fixedNow,
			}),
			filingsLeftToFile: initFilingsLeftToFile({
				listReadlistFitOverrides: store.listReadlistFitOverrides,
				findSavedArticleForLink: initFindSavedArticleForLink({
					resolveCanonicalIdentity: initResolveCanonicalIdentity({ findIdentityRow: store.findIdentityRow }),
					findArticleById: store.findArticleById,
				}),
				findReadlistRemoval: store.findReadlistRemoval,
				logger: noopLogger,
			}),
			decideReadlistFit,
			publishEvent,
			logger: noopLogger,
			fitDecidedLog: discardLines,
			fitUnsureLog: discardLines,
			deepseekCallFailedLog: discardLines,
			now: fixedNow,
		});
		const deliveries = buildSqsEvent([accepted, rejected, unavailable].map((readlist) => ({
			messageId: readlist,
			body: JSON.stringify({ detail: {
				userId, receivedAtMessageId: "2026-10-04#gmail-issue", readlist,
				senderEmail: "letter@example.com", subject: "Weekly articles",
				links: [{ ordinal: "0000", url: exampleUrl, anchorText: "Story" }],
			}, time: fixedNow().toISOString() }),
		})));
		for (let attempt = 0; attempt < 2; attempt++) {
			const response = await filter(deliveries, buildLambdaContext(), () => {});
			expect(response?.batchItemFailures).toEqual([{ itemIdentifier: unavailable }]);
		}

		expect((await store.listUserSavesForUrl({ userId, url: canonical })).map((save) => save.readlist ?? DEFAULT_READLIST_SLUG).sort()).toEqual([DEFAULT_READLIST_SLUG, accepted].sort());
		expect(terminal.map((fact) => EmailLinksFilteredEvent.detailSchema.parse(fact).readlist)).toEqual([accepted, rejected, accepted, rejected]);
		expect(await store.listUserSavesForUrl({ userId, url: exampleUrl })).toEqual([]);
	});

	it("stub-saves a new URL, crawls tier-1 in-process, and emits TierContentExtractedEvent", async () => {
		const saveArticle = jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true });
		const markCrawlPending = jest.fn().mockResolvedValue(undefined);
		const { publishEvent, published } = initRecordingPublishEvent();
		const putTierSource = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ saveArticleAsRequested: saveArticle, markCrawlPending, publishEvent, putTierSource });

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(saveArticle).toHaveBeenCalledWith(
			expect.objectContaining({ userId, url: exampleUrl, savedAt: allocatedSavedAt }),
		);
		expect(markCrawlPending).toHaveBeenCalledWith({ url: exampleUrl, measured: true, meteredLegs: "run" });
		expect(putTierSource).toHaveBeenCalledWith(
			expect.objectContaining({ url: exampleUrl, tier: "tier-1" }),
		);
		expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
			url: exampleUrl,
			userId,
			extractedAt: fixedNow().toISOString(),
		}) });
	});

	describe("a link whose identity carries an archive capture", () => {
		const capture = "https://web.archive.org/web/20081203185222/https://example.com/post";
		const captureIdentity = (url: string): ResolvedSaveIdentity => ({ status: "resolved", originalUrl: url, sourceOriginalUrl: url, url, contentSourceUrl: capture });
		const withCapture = { refreshArticleIfStale: refreshAs("new", captureIdentity) };

		it("crawls the live page and the capture in-process, offering both to the content judge", async () => {
			const crawls: Parameters<CrawlAndFinalizeArticle>[0][] = [];
			const { publishEvent, published } = initRecordingPublishEvent();
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				...withCapture,
				crawlAndFinalizeArticle: async (params) => {
					crawls.push(params);
					return fetchedResult;
				},
				publishEvent,
				putTierSource,
			});

			const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

			expect(response.batchItemFailures).toEqual([]);
			const writeContext = { url: exampleUrl, attemptId: "attempt-1" };
			expect(crawls).toEqual(expect.arrayContaining([{ url: exampleUrl, retainResponseBody: true, writeContext }, { url: exampleUrl, fetchUrl: capture, retainResponseBody: true, writeContext }]));
			expect(putTierSource.mock.calls.map(([params]) => params.tier)).toEqual(expect.arrayContaining(["tier-1", "tier-2"]));
			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({
				url: exampleUrl,
				userId,
				extractedAt: fixedNow().toISOString(),
			}) });
		});

		it("hands the capture to the deferred crawl without a tier event when the live fetch is deferred, so the content judge runs once", async () => {
			const { publishEvent, published } = initRecordingPublishEvent();
			const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				...withCapture,
				publishEvent,
				emitSimpleCrawlUnsupported,
				crawlAndFinalizeArticle: (async (params) => params.fetchUrl === capture ? fetchedResult : { status: "blocked", httpStatus: 403 }) as CrawlAndFinalizeArticle,
			});

			const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

			expect(response.batchItemFailures).toEqual([]);
			expect(emitSimpleCrawlUnsupported.mock.calls).toEqual([[expect.objectContaining({
				url: exampleUrl,
				unsupportedReason: "blocked",
				candidates: [{ id: expect.any(String), tier: "tier-2" }],
			})]]);
			expect(publishedDetailTypes(published)).toEqual(["LinkQueued", "QueueEntryCreated"]);
		});

		it("runs both candidates even for an existing original when an archive is submitted", async () => {
			const { publishEvent, published } = initRecordingPublishEvent();
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				refreshArticleIfStale: refreshAs("skip", captureIdentity),
				crawlAndFinalizeArticle: async () => ({ status: "failed", decision: undefined, reason: "crawl-failed" }),
				publishEvent,
				transitionAndPersist,
			});

			const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

			expect(response.batchItemFailures).toEqual([]);
			expect(transitionAndPersist).not.toHaveBeenCalled();
			expect(published).toContainEqual({ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({ candidates: [], liveAttempt: { outcome: "no-body", failureReason: { kind: "fetch-failed" } } }) });
		});

		it.each([
			{ path: "capture", deps: withCapture },
			{ path: "plain tier-1", deps: {} },
		])("terminalises a $path storage failure as exhausted-retries on the last receive, so the row is not left pending once the record dead-letters", async ({ deps }) => {
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				...deps,
				transitionAndPersist,
				putTierSource: jest.fn().mockRejectedValue(new Error("S3 PutObject failed")),
			});
			const lastReceive = createSqsEvent([{ url: exampleUrl, userId }]);
			lastReceive.Records[0].attributes = { ...stubAttributes, ApproximateReceiveCount: String(SUBMIT_LINK_MAX_RECEIVE_COUNT) };

			const response = await run(handler, lastReceive);

			expect(response.batchItemFailures).toEqual([]);
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
				url: exampleUrl,
				input: { reason: { kind: "exhausted-retries", receiveCount: SUBMIT_LINK_MAX_RECEIVE_COUNT }, receiveCount: SUBMIT_LINK_MAX_RECEIVE_COUNT },
			});
		});
	});

	it("asks to resurface earlier saves for a newsletter link the reader tapped Save on, keyed on the alias target", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			publishEvent,
			refreshArticleIfStale: refreshAs("new", () => ({ status: "resolved", originalUrl: "https://example.com/canonical", url: "https://example.com/canonical" })),
		});

		await run(handler, createSqsEvent([{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "news@example.com" }, saveTrigger: "manual" }]));

		expect(published).toContainEqual({ detailType: QueueEntryCreatedEvent.detailType, detail: {
			url: "https://example.com/canonical",
			userId,
		} });
	});

	it("asks nothing for a newsletter link the system saved on the reader's behalf", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			publishEvent,
			refreshArticleIfStale: refreshAs("new"),
		});

		await run(handler, createSqsEvent([{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "news@example.com" }, saveTrigger: "automatic" }]));

		expect(publishedDetailTypes(published)).not.toContain("QueueEntryCreated");
	});

	it("asks nothing for a newsletter link already sitting in the reader's queue", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			publishEvent,
			saveArticleAsRequested: jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: false, wroteUserArticle: true }),
		});

		await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(publishedDetailTypes(published)).toEqual([
			"LinkQueued",
			"TierContentExtracted",
		]);
	});

	it("attaches an existing article without re-crawling: 'skip' freshness bumps the row and emits only the accepted-save fact", async () => {
		const saveArticle = jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true });
		const { publishEvent, published } = initRecordingPublishEvent();
		const crawlAndFinalizeArticle = jest.fn();
		const handler = createHandler({
			saveArticleAsRequested: saveArticle,
			publishEvent,
			refreshArticleIfStale: refreshAs("skip"),
			crawlAndFinalizeArticle: crawlAndFinalizeArticle as unknown as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(saveArticle).toHaveBeenCalledWith(
			expect.objectContaining({ userId, url: exampleUrl }),
		);
		expect(crawlAndFinalizeArticle).not.toHaveBeenCalled();
		expect(publishedDetailTypes(published)).toEqual(["LinkQueued", "QueueEntryCreated"]);
	});

	it("resurfaces a previously-read article back to unread, exactly like the queue save button", async () => {
		const updateArticleStatus = jest.fn().mockResolvedValue(true);
		const handler = createHandler({
			saveArticleAsRequested: jest
				.fn()
				.mockResolvedValue({ saved: makeSaved({ status: "read", readAt: new Date("2026-06-10T00:00:00.000Z") }), createdUserArticle: true, wroteUserArticle: true }),
			updateArticleStatus,
			refreshArticleIfStale: refreshAs("skip"),
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(updateArticleStatus).toHaveBeenCalledWith(articleId, userId, "unread");
	});

	it("completes the queue write and resurface before the tier-1 crawl starts", async () => {
		const order: string[] = [];
		const handler = createHandler({
			saveArticleAsRequested: jest.fn().mockImplementation(async () => {
				order.push("saveArticle");
				return { saved: makeSaved({ status: "read", readAt: new Date() }), createdUserArticle: true, wroteUserArticle: true };
			}),
			updateArticleStatus: jest.fn().mockImplementation(async () => {
				order.push("resurface");
				return true;
			}),
			crawlAndFinalizeArticle: (async () => {
				order.push("crawl");
				return fetchedResult;
			}) as CrawlAndFinalizeArticle,
		});

		await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(order).toEqual(["saveArticle", "resurface", "crawl"]);
	});

	it("fails the record when the message carries rawHtml — the tier-0 submit path has no handler yet", async () => {
		const handler = createHandler();

		const response = await run(
			handler,
			createSqsEvent([{ url: exampleUrl, userId, rawHtml: "<html></html>" }]),
		);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("fails the record when the message is anonymous — the /view submit path has no handler yet", async () => {
		const handler = createHandler();

		const response = await run(handler, createSqsEvent([{ url: exampleUrl }]));

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("fails a pre-provenance record still in flight at deploy, rather than reading it as an anonymous submission", async () => {
		const saveArticle = jest.fn();
		const handler = createHandler({ saveArticleAsRequested: saveArticle });
		const event = createSqsEvent([{ url: exampleUrl }]);
		event.Records[0].body = JSON.stringify({ detail: { url: exampleUrl, userId } });

		const response = await run(handler, event);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(saveArticle).not.toHaveBeenCalled();
	});

	it("fails a pre-trigger record still in flight at deploy, so its dead letter re-offers the Save button", async () => {
		const saveArticle = jest.fn();
		const handler = createHandler({ saveArticleAsRequested: saveArticle });
		const event = createSqsEvent([{ url: exampleUrl }]);
		event.Records[0].body = JSON.stringify({
			detail: { saveAttemptId: "attempt-1", url: exampleUrl, userId, provenance: { kind: "web" }, readlist: "default" },
		});

		const response = await run(handler, event);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(saveArticle).not.toHaveBeenCalled();
	});

	it("fails a pre-readlist record still in flight at deploy, so its dead letter re-offers the Save button", async () => {
		const saveArticle = jest.fn();
		const handler = createHandler({ saveArticleAsRequested: saveArticle });
		const event = createSqsEvent([{ url: exampleUrl }]);
		event.Records[0].body = JSON.stringify({
			detail: { saveAttemptId: "attempt-1", url: exampleUrl, userId, provenance: { kind: "web" }, saveTrigger: "manual" },
		});

		const response = await run(handler, event);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(saveArticle).not.toHaveBeenCalled();
	});

	it("fails a record whose readlist is not a readlist id", async () => {
		const saveArticle = jest.fn();
		const handler = createHandler({ saveArticleAsRequested: saveArticle });

		const response = await run(
			handler,
			createSqsEvent([{ url: exampleUrl, userId, readlist: "Not A Slug" }]),
		);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(saveArticle).not.toHaveBeenCalled();
	});

	it("files the accepted save into the readlist the command names, after accepting it at All", async () => {
		const saved = makeSaved();
		const calls: string[] = [];
		const publishEvent = jest.fn(async (event: { detailType: string }) => {
			calls.push(event.detailType);
		});
		const saveReadlistArticleAsRequested = jest.fn(async () => {
			calls.push("filed");
			return { saved, createdUserArticle: true, wroteUserArticle: true };
		});
		const handler = createHandler({
			publishEvent,
			saveReadlistArticleAsRequested,
			saveArticleAsRequested: jest.fn().mockResolvedValue({ saved, createdUserArticle: true, wroteUserArticle: true }),
		});

		const response = await run(
			handler,
			createSqsEvent([
				{
					url: exampleUrl,
					userId,
					provenance: { kind: "email", senderEmail: "news@example.com" },
					saveTrigger: "automatic",
					readlist: "a1b2c3d4",
				},
			]),
		);

		expect(response.batchItemFailures).toEqual([]);
		expect(saveReadlistArticleAsRequested).toHaveBeenCalledWith(
			expect.objectContaining({
				userId,
				readlist: "a1b2c3d4",
				url: saved.url,
				provenance: { kind: "email", senderEmail: "news@example.com" },
				requestedAt: new Date("2026-06-02T00:00:00Z"),
			}),
		);
		expect(calls.slice(0, calls.indexOf("filed") + 1)).toEqual([
			"LinkQueued",
			"filed",
		]);
	});

	it("confirms an email output in All after the save lands there and before filing or crawling", async () => {
		const calls: string[] = [];
		const publishEvent = jest.fn(async (event: { detailType: string }) => {
			calls.push(event.detailType);
		});
		const handler = createHandler({
			publishEvent,
			saveReadlistArticleAsRequested: jest.fn(async () => {
				calls.push("filed");
				throw new Error("custom readlist write failed");
			}),
		});
		const emailOutput = { receivedAtMessageId: "2026-10-27T00:00:00.000Z#<m@x>", outputKey: "link#0000" };

		const response = await run(
			handler,
			createSqsEvent([{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "news@example.com" }, saveTrigger: "automatic", readlist: "a1b2c3d4", emailOutput }]),
		);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(calls).toEqual(["LinkQueued", "EmailOutputSavedToAll", "filed"]);
		expect(publishEvent).toHaveBeenCalledWith(EmailOutputSavedToAllEvent, { userId, ...emailOutput });
	});

	it("confirms an email output again when the same link is saved twice", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({ publishEvent });
		const emailOutput = { receivedAtMessageId: "2026-10-27T00:00:00.000Z#<m@x>", outputKey: "link#0000" };

		await run(handler, createSqsEvent([{ url: exampleUrl, userId, emailOutput }, { url: exampleUrl, userId, emailOutput }]));

		expect(publishedDetailTypes(published).filter((type) => type === "EmailOutputSavedToAll")).toHaveLength(2);
	});

	it("files nothing beyond All when the command names All", async () => {
		const saveReadlistArticleAsRequested = jest.fn();
		const handler = createHandler({ saveReadlistArticleAsRequested });

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(saveReadlistArticleAsRequested).not.toHaveBeenCalled();
	});

	it("fails the record when filing into the readlist fails, so the retry files it", async () => {
		const handler = createHandler({
			saveReadlistArticleAsRequested: jest.fn().mockRejectedValue(new Error("dynamo unavailable")),
		});

		const response = await run(
			handler,
			createSqsEvent([{ url: exampleUrl, userId, readlist: "a1b2c3d4" }]),
		);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("publishes the save failure instead of dead-lettering when the wrapper's original is still unresolved on the final receive", async () => {
		const saveArticle = jest.fn();
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			refreshArticleIfStale: async () => ({ action: "unresolved", identity: { status: "unresolved" } }),
			saveArticleAsRequested: saveArticle,
			publishEvent,
		});
		const lastReceive = createSqsEvent([{ url: "https://archive.ph/abc", userId }]);
		lastReceive.Records[0].attributes = { ...stubAttributes, ApproximateReceiveCount: String(SUBMIT_LINK_MAX_RECEIVE_COUNT) };

		const response = await run(handler, lastReceive);

		expect(response.batchItemFailures).toEqual([]);
		expect(saveArticle).toHaveBeenCalledTimes(0);
		expect(published).toEqual([{ detailType: LinkQueueFailedEvent.detailType, detail: {
			url: "https://archive.ph/abc",
			userId,
			reason: "wrapper-original-unresolved",
			receiveCount: SUBMIT_LINK_MAX_RECEIVE_COUNT,
		} }]);
	});

	it("fails the record and writes no article while the wrapper's original is unresolved before the final receive, so the queue retries it", async () => {
		const wrapperUrl = "https://archive.ph/abc";
		const saveArticle = jest.fn();
		const pinContentSource = jest.fn();
		const markCrawlPending = jest.fn();
		const allocateSavedAt = jest.fn();
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			refreshArticleIfStale: async () => ({ action: "unresolved", identity: { status: "unresolved" } }),
			saveArticleAsRequested: saveArticle,
			pinContentSource,
			markCrawlPending,
			allocateSavedAt,
			publishEvent,
		});

		const response = await run(handler, createSqsEvent([{ url: wrapperUrl, userId }]));

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(saveArticle).toHaveBeenCalledTimes(0);
		expect(pinContentSource).toHaveBeenCalledTimes(0);
		expect(markCrawlPending).toHaveBeenCalledTimes(0);
		expect(allocateSavedAt).toHaveBeenCalledTimes(0);
		expect(published).toEqual([]);
	});

	it("fails the record for an unsaveable URL instead of stub-saving garbage", async () => {
		const saveArticle = jest.fn();
		const handler = createHandler({ saveArticleAsRequested: saveArticle });

		const response = await run(
			handler,
			createSqsEvent([{ url: "ftp://example.com/file", userId }]),
		);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(saveArticle).not.toHaveBeenCalled();
	});

	it("acks a tier-1-deferred crawl without emitting TierContentExtractedEvent — the comprehensive Lambda owns the next event", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			publishEvent,
			emitSimpleCrawlUnsupported,
			crawlAndFinalizeArticle: (async () => ({
				status: "unsupported",
				reason: "content-type application/pdf",
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith(expect.objectContaining({
			url: exampleUrl,
			userId,
			trigger: "save",
		}));
		expect(publishedDetailTypes(published)).toEqual(["LinkQueued", "QueueEntryCreated"]);
	});

	it("acks a tier-1-terminal crawl (origin no longer serves the page) without emitting a tier event", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			publishEvent,
			crawlAndFinalizeArticle: (async () => ({
				status: "not-found",
				httpStatus: 410,
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(publishedDetailTypes(published)).toEqual(["LinkQueued", "QueueEntryCreated"]);
	});

	it("defers an edge-blocked import (HTTP 403) to the render ladder and reports no batch failure", async () => {
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({ emitSimpleCrawlUnsupported,
			transitionAndPersist,
			publishEvent,
			crawlAndFinalizeArticle: (async () => ({
				status: "blocked",
				httpStatus: 403,
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith(expect.objectContaining({ unsupportedReason: "blocked" }));
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(publishedDetailTypes(published)).toEqual(["LinkQueued", "QueueEntryCreated"]);
	});

	it("terminalises the row as fetch-failed and acks the record when the tier-1 crawl throws a transport failure — a first receive is not an exhausted retry budget", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			transitionAndPersist,
			crawlAndFinalizeArticle: (async () => ({
				status: "failed", decision: undefined,
				reason: "crawl-failed",
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: exampleUrl,
			input: { reason: { kind: "fetch-failed" }, receiveCount: 1 },
		});
	});

	it("preserves the parse-error detail the worker already wrote instead of clobbering it with a retry label", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			transitionAndPersist,
			crawlAndFinalizeArticle: (async () => ({
				status: "failed", decision: undefined,
				reason: "Readability returned null",
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(transitionAndPersist).toHaveBeenLastCalledWith(markCrawlExhausted, {
			url: exampleUrl,
			input: {
				reason: { kind: "parse-error", detail: "Readability returned null" },
				receiveCount: 1,
			},
		});
	});

	it("retries storage failure without relabeling it as a crawl failure", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			transitionAndPersist,
			putTierSource: jest.fn().mockRejectedValue(new Error("S3 PutObject failed")),
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("fails the record when the in-process terminalisation itself fails, so the row is not silently left pending", async () => {
		const handler = createHandler({
			transitionAndPersist: jest.fn().mockRejectedValue(new Error("DDB throttled")),
			crawlAndFinalizeArticle: (async () => ({
				status: "failed", decision: undefined,
				reason: "crawl-failed",
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("processes the rest of the batch when one record fails", async () => {
		const handler = createHandler();

		const response = await run(
			handler,
			createSqsEvent([
				{ url: "not a url", userId },
				{ url: exampleUrl, userId },
			]),
		);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("fails the record when the body is not JSON", async () => {
		const handler = createHandler();
		const event = createSqsEvent([{ url: exampleUrl, userId }]);
		event.Records[0].body = "not json";

		const response = await run(handler, event);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("announces the accepted save with the submitted url, so a reader's saved-link view can match it", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({ publishEvent });

		await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		const queued = published.find((entry) => entry.detailType === LinkQueuedEvent.detailType);
		expect(queued?.detail).toEqual({ url: exampleUrl, userId });
	});

	it("stamps the reader's first inbox article once for an email-provenance save", async () => {
		const recordInboxArticleQueued = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ recordInboxArticleQueued });

		const response = await run(
			handler,
			createSqsEvent([
				{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "letters@example.com" }, saveTrigger: "automatic" },
			]),
		);

		expect(response.batchItemFailures).toEqual([]);
		expect(recordInboxArticleQueued).toHaveBeenCalledTimes(1);
		expect(recordInboxArticleQueued).toHaveBeenCalledWith({ userId });
	});

	it.each([
		{ kind: "web" },
		{ kind: "client", clientName: "chrome" },
		{ kind: "import" },
		{ kind: "mcp", registeredName: "claude" },
	])("leaves the inbox stamp untouched for a $kind save", async (provenance) => {
		const recordInboxArticleQueued = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ recordInboxArticleQueued });

		await run(handler, createSqsEvent([{ url: exampleUrl, userId, provenance }]));

		expect(recordInboxArticleQueued).not.toHaveBeenCalled();
	});

	it("stamps after the queue write and before the tier-1 crawl", async () => {
		const order: string[] = [];
		const handler = createHandler({
			saveArticleAsRequested: jest.fn().mockImplementation(async () => {
				order.push("saveArticle");
				return { saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true };
			}),
			recordInboxArticleQueued: jest.fn().mockImplementation(async () => {
				order.push("stamp");
			}),
			crawlAndFinalizeArticle: (async () => {
				order.push("crawl");
				return fetchedResult;
			}) as CrawlAndFinalizeArticle,
		});

		await run(
			handler,
			createSqsEvent([
				{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "letters@example.com" }, saveTrigger: "automatic" },
			]),
		);

		expect(order).toEqual(["saveArticle", "stamp", "crawl"]);
	});

	it("logs a warning, keeps the accepted save and still crawls when the inbox stamp throws", async () => {
		const crawlAndFinalizeArticle = jest.fn().mockResolvedValue(fetchedResult);
		const warnings: unknown[] = [];
		const handler = createHandler({
			recordInboxArticleQueued: jest.fn().mockRejectedValue(new Error("DDB throttled")),
			crawlAndFinalizeArticle: crawlAndFinalizeArticle as unknown as CrawlAndFinalizeArticle,
			logger: {
				...noopLogger,
				warn: (message, context) => {
					warnings.push([message, context]);
				},
			},
		});

		const response = await run(
			handler,
			createSqsEvent([
				{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "letters@example.com" }, saveTrigger: "automatic" },
			]),
		);

		expect(response.batchItemFailures).toEqual([]);
		expect(crawlAndFinalizeArticle).toHaveBeenCalled();
		expect(warnings).toEqual([
			[
				"[SubmitLinkCommand] inbox onboarding stamp failed — continuing",
				{ url: exampleUrl, error: "Error: DDB throttled" },
			],
		]);
	});
});

describe("initSubmitLinkCommandHandler — a twitter.com link from an email", () => {
	const TWEET_ON_TWITTER = "https://twitter.com/jack/status/20";
	const TWEET_ON_X = "https://x.com/jack/status/20";

	it("checks freshness, saves, crawls and announces the x.com article", async () => {
		const refreshArticleIfStale = jest.fn(refreshAs("new"));
		const saveArticle = jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true });
		const crawled: string[] = [];
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async (params) => {
			crawled.push(params.url);
			return fetchedResult;
		};
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({ refreshArticleIfStale, saveArticleAsRequested: saveArticle, crawlAndFinalizeArticle, publishEvent });

		const response = await run(handler, createSqsEvent([{ url: TWEET_ON_TWITTER, userId, provenance: { kind: "email", senderEmail: "news@example.com" }, saveTrigger: "automatic" }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(refreshArticleIfStale).toHaveBeenCalledWith({ url: TWEET_ON_X });
		expect(saveArticle).toHaveBeenCalledWith(expect.objectContaining({ url: TWEET_ON_X }));
		expect(crawled).toEqual([TWEET_ON_X]);
		expect(published).toEqual([
			{ detailType: LinkQueuedEvent.detailType, detail: expect.objectContaining({ url: TWEET_ON_X }) },
			{ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({ url: TWEET_ON_X }) },
		]);
	});

	it("leaves a twitter.com subdomain link as it was emailed", async () => {
		const saveArticle = jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true });
		const handler = createHandler({ saveArticleAsRequested: saveArticle });

		await run(handler, createSqsEvent([{ url: "https://mobile.twitter.com/jack/status/20", userId }]));

		expect(saveArticle).toHaveBeenCalledWith(expect.objectContaining({ url: "https://mobile.twitter.com/jack/status/20" }));
	});
});

describe("initSubmitLinkCommandHandler — an Amazon title link from an email", () => {
	const TITLE = "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451";
	const BARE = "https://www.amazon.com.au/dp/1492043451";

	it("checks freshness, saves, crawls and announces the bare product article", async () => {
		const refreshArticleIfStale = jest.fn(refreshAs("new"));
		const saveArticle = jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true });
		const crawled: string[] = [];
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async (params) => {
			crawled.push(params.url);
			return fetchedResult;
		};
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({ refreshArticleIfStale, saveArticleAsRequested: saveArticle, crawlAndFinalizeArticle, publishEvent });

		const response = await run(handler, createSqsEvent([{ url: TITLE, userId, provenance: { kind: "email", senderEmail: "news@example.com" }, saveTrigger: "automatic" }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(refreshArticleIfStale).toHaveBeenCalledWith({ url: BARE });
		expect(saveArticle).toHaveBeenCalledWith(expect.objectContaining({ url: BARE }));
		expect(crawled).toEqual([BARE]);
		expect(published).toEqual([
			{ detailType: LinkQueuedEvent.detailType, detail: expect.objectContaining({ url: BARE }) },
			{ detailType: TierContentExtractedEvent.detailType, detail: expect.objectContaining({ url: BARE }) },
		]);
	});
});

describe("initSubmitLinkCommandHandler — the per-save log line", () => {
	const trackerUrl = "https://substack.com/redirect/abc-123?j=xyz";

	it.each([
		{
			identity: "its own url",
			refreshArticleIfStale: refreshAs("new"),
			contentSource: false,
		},
		{
			identity: "a newsletter tracker as its content source",
			refreshArticleIfStale: refreshAs("new", (url): ResolvedSaveIdentity => ({ status: "resolved", url, originalUrl: url, contentSourceUrl: trackerUrl, sourceOriginalUrl: url })),
			contentSource: true,
		},
	])("logs the trigger, freshness, deferral mode and refused stamp of an automatic save keyed on $identity", async ({ refreshArticleIfStale, contentSource }) => {
		const saves: unknown[] = [];
		const handler = createHandler({
			refreshArticleIfStale,
			markCrawlPending: jest.fn().mockResolvedValue({ kind: "refused", crawlStatus: "pending", carriedMarker: false }),
			logger: {
				...noopLogger,
				info: (message, context) => {
					if (message === "[SubmitLinkCommand] saved") saves.push(context);
				},
			},
		});

		await run(handler, createSqsEvent([{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "news@example.com" }, saveTrigger: "automatic" }]));

		expect(saves).toEqual([
			{
				url: exampleUrl,
				saveTrigger: "automatic",
				freshness: "new",
				meteredLegs: "deferred",
				contentSource,
				crawlPending: { kind: "refused", crawlStatus: "pending", carriedMarker: false },
			},
		]);
	});
});

describe("a redelivered save", () => {
	const requestedAt = "2026-06-02T00:00:00Z";
	const finalReceive = (event: SQSEvent): SQSEvent => {
		event.Records[0].attributes = { ...stubAttributes, ApproximateReceiveCount: String(SUBMIT_LINK_MAX_RECEIVE_COUNT) };
		return event;
	};
	const collectWarnings = () => {
		const warnings: unknown[][] = [];
		const logger: Logger = {
			...noopLogger,
			warn: (...args: unknown[]) => {
				warnings.push(args);
			},
		};
		return { warnings, logger };
	};
	const refusalContext = (reason: string, receiveCount: number) => ({
		messageId: "msg-1",
		reason,
		requestedAt: "2026-06-02T00:00:00.000Z",
		receiveCount,
		saveAttemptId: "attempt-1",
		userId,
	});

	it("refuses a save for an erased account on the final receive, logs it without the url and writes nothing", async () => {
		const { warnings, logger } = collectWarnings();
		const { publishEvent, published } = initRecordingPublishEvent();
		const saveArticleAsRequested = jest.fn();
		const handler = createHandler({ resolveSubmitterStanding: async () => "account-gone", publishEvent, saveArticleAsRequested, logger });

		const response = await run(handler, finalReceive(createSqsEvent([{ url: exampleUrl, userId }])));

		expect(response.batchItemFailures).toEqual([]);
		expect(saveArticleAsRequested).not.toHaveBeenCalled();
		expect(published).toEqual([]);
		expect(warnings).toEqual([["[SubmitLinkCommand] save refused", refusalContext("account-gone", SUBMIT_LINK_MAX_RECEIVE_COUNT)]]);
	});

	it("retries a save whose account is not visible yet on an earlier receive", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({ resolveSubmitterStanding: async () => "account-gone", publishEvent });

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(published).toEqual([]);
	});

	it("refuses a save for a read-only reader whose save has not landed since the request", async () => {
		const { warnings, logger } = collectWarnings();
		const { publishEvent, published } = initRecordingPublishEvent();
		const saveArticleAsRequested = jest.fn();
		const refreshArticleIfStale = jest.fn();
		const hasSaveLandedSince = jest.fn().mockResolvedValue(false);
		const handler = createHandler({
			resolveSubmitterStanding: async () => "read-only",
			hasSaveLandedSince,
			publishEvent,
			saveArticleAsRequested,
			refreshArticleIfStale,
			logger,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(hasSaveLandedSince).toHaveBeenCalledWith({ userId, url: exampleUrl, requestedAt: new Date(requestedAt) });
		expect(saveArticleAsRequested).not.toHaveBeenCalled();
		expect(refreshArticleIfStale).not.toHaveBeenCalled();
		expect(published).toEqual([
			{ detailType: LinkQueueFailedEvent.detailType, detail: { url: exampleUrl, userId, reason: "read-only", receiveCount: 1 } },
		]);
		expect(warnings).toEqual([["[SubmitLinkCommand] save refused", { ...refusalContext("read-only", 1), url: exampleUrl }]]);
	});

	it("finishes a read-only reader's save that landed before access lapsed and acknowledges its Gmail output", async () => {
		const { warnings, logger } = collectWarnings();
		const { publishEvent, published } = initRecordingPublishEvent();
		const emailOutput = { receivedAtMessageId: "2026-10-27T00:00:00.000Z#<m@x>", outputKey: "link#0000" };
		const handler = createHandler({
			resolveSubmitterStanding: async () => "read-only",
			hasSaveLandedSince: jest.fn().mockResolvedValue(true),
			publishEvent,
			logger,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId, emailOutput }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(publishedDetailTypes(published)).not.toContain("LinkQueueFailed");
		expect(published).toContainEqual({ detailType: EmailOutputSavedToAllEvent.detailType, detail: { userId, ...emailOutput } });
		expect(warnings.filter(([message]) => message === "[SubmitLinkCommand] save refused")).toEqual([]);
	});

	it("retries a read-only save whose identity is unresolved until the final receive", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			resolveSubmitterStanding: async () => "read-only",
			resolveSaveIdentity: async () => ({ status: "unresolved" }),
			publishEvent,
		});

		const early = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));
		expect(early.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(published).toEqual([]);

		const final = await run(handler, finalReceive(createSqsEvent([{ url: exampleUrl, userId }])));
		expect(final.batchItemFailures).toEqual([]);
		expect(published).toEqual([
			{ detailType: LinkQueueFailedEvent.detailType, detail: { url: exampleUrl, userId, reason: "read-only", receiveCount: SUBMIT_LINK_MAX_RECEIVE_COUNT } },
		]);
	});

	it("refuses a save requested before the purge and does not crawl", async () => {
		const { warnings, logger } = collectWarnings();
		const { publishEvent, published } = initRecordingPublishEvent();
		const crawlAndFinalizeArticle = jest.fn();
		const handler = createHandler({
			saveArticleAsRequested: jest.fn().mockRejectedValue(new ArticlePurgedAfterRequest(exampleUrl)),
			crawlAndFinalizeArticle,
			publishEvent,
			logger,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(crawlAndFinalizeArticle).not.toHaveBeenCalled();
		expect(published).toEqual([
			{ detailType: LinkQueueFailedEvent.detailType, detail: { url: exampleUrl, userId, reason: "purged-after-request", receiveCount: 1 } },
		]);
		expect(warnings).toEqual([["[SubmitLinkCommand] save refused", { ...refusalContext("purged-after-request", 1), url: exampleUrl }]]);
	});

	it("refuses when the purge lands between the save and the filing", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			saveReadlistArticleAsRequested: jest.fn().mockRejectedValue(new ArticlePurgedAfterRequest(exampleUrl)),
			publishEvent,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId, readlist: "a1b2c3d4" }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(publishedDetailTypes(published).at(-1)).toBe("LinkQueueFailed");
		expect(published.at(-1)).toEqual({
			detailType: LinkQueueFailedEvent.detailType,
			detail: { url: exampleUrl, userId, reason: "purged-after-request", receiveCount: 1 },
		});
	});

	it("files a save that stayed read into the readlist as read, from All, at a fresh position", async () => {
		const saved = makeSaved({ status: "read" });
		const assignSavedArticleToReadlist = jest.fn().mockResolvedValue(undefined);
		const saveReadlistArticleAsRequested = jest.fn();
		const handler = createHandler({
			saveArticleAsRequested: jest.fn().mockResolvedValue({ saved, createdUserArticle: false, wroteUserArticle: false }),
			assignSavedArticleToReadlist,
			saveReadlistArticleAsRequested,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId, readlist: "a1b2c3d4" }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(saveReadlistArticleAsRequested).not.toHaveBeenCalled();
		expect(assignSavedArticleToReadlist).toHaveBeenCalledWith({
			userId,
			readlist: "a1b2c3d4",
			from: DEFAULT_READLIST_SLUG,
			url: saved.url,
			savedAt: allocatedSavedAt,
		});
	});

	it("fences the All save with the time the save was requested", async () => {
		const saveArticleAsRequested = jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true });
		const handler = createHandler({ saveArticleAsRequested });

		await run(handler, createSqsEvent([{ url: exampleUrl, userId }], "2026-06-03T04:05:06Z"));

		expect(saveArticleAsRequested).toHaveBeenCalledWith(expect.objectContaining({ requestedAt: new Date("2026-06-03T04:05:06Z") }));
	});

	it("rethrows any other save failure without a refusal", async () => {
		const { warnings, logger } = collectWarnings();
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = createHandler({
			saveArticleAsRequested: jest.fn().mockRejectedValue(new Error("dynamo unavailable")),
			publishEvent,
			logger,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(publishedDetailTypes(published)).not.toContain("LinkQueueFailed");
		expect(warnings.filter(([message]) => message === "[SubmitLinkCommand] save refused")).toEqual([]);
	});
});

describe("a redelivered save against the stored rows", () => {
	const beforeRequest = new Date("2026-06-01T00:00:00.000Z");
	const afterRequest = new Date("2026-06-03T00:00:00.000Z");
	const custom = ReadlistSlugSchema.parse("a1b2c3d4");
	const id = ReaderArticleHashId.from(exampleUrl);
	const seed = {
		userId,
		url: exampleUrl,
		metadata: { title: "Post", siteName: "example.com", excerpt: "", wordCount: 10 },
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "web" } as const,
	};

	function storeHandler(store: ReturnType<typeof initInMemoryArticleStore>, overrides: Partial<HandlerDeps> = {}) {
		return createHandler({
			saveArticleAsRequested: store.saveArticleAsRequested,
			allocateSavedAt: store.allocateSavedAt,
			updateArticleStatus: store.updateArticleStatus,
			saveReadlistArticleAsRequested: store.saveReadlistArticleAsRequested,
			updateArticleStatusAcrossReadlists: store.updateArticleStatusAcrossReadlists,
			assignSavedArticleToReadlist: store.assignSavedArticleToReadlist,
			hasSaveLandedSince: store.hasSaveLandedSince,
			...overrides,
		});
	}

	const allRow = (store: ReturnType<typeof initInMemoryArticleStore>) => store.findArticleById(id, userId);
	const customRow = (store: ReturnType<typeof initInMemoryArticleStore>) =>
		store.findReadlistArticleById({ id, userId, readlist: custom });

	async function seedPurged(at: Date) {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, userId: UserIdSchema.parse("00000000000000000000000000000002"), savedAt: beforeRequest });
		await store.setPurgedAt({ url: exampleUrl, at });
		return store;
	}

	it.each([
		{ name: "before the purge", purgedAt: new Date("2026-06-02T00:00:01.000Z") },
		{ name: "in the same second as the purge", purgedAt: new Date("2026-06-02T00:00:00.500Z") },
	])("refuses a save requested $name", async ({ purgedAt }) => {
		const store = await seedPurged(purgedAt);
		const { publishEvent, published } = initRecordingPublishEvent();
		const crawlAndFinalizeArticle = jest.fn();

		const response = await run(storeHandler(store, { publishEvent, crawlAndFinalizeArticle }), createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect((await store.findArticleByUrl(exampleUrl))?.purgedAt).toEqual(purgedAt);
		expect(await allRow(store)).toBeNull();
		expect(published).toEqual([
			{ detailType: LinkQueueFailedEvent.detailType, detail: { url: exampleUrl, userId, reason: "purged-after-request", receiveCount: 1 } },
		]);
		expect(crawlAndFinalizeArticle).not.toHaveBeenCalled();
	});

	it("revives a URL purged before the save was requested", async () => {
		const store = await seedPurged(new Date("2026-06-01T23:59:59.000Z"));

		const response = await run(storeHandler(store), createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect((await store.findArticleByUrl(exampleUrl))?.purgedAt).toBeUndefined();
		expect(await allRow(store)).not.toBeNull();
	});

	it("leaves the row alone when the same message runs twice", async () => {
		const store = initInMemoryArticleStore();
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = storeHandler(store, { publishEvent });
		const event = createSqsEvent([{ url: exampleUrl, userId }]);

		await run(handler, event);
		const first = await allRow(store);
		await run(handler, event);

		const second = await allRow(store);
		expect(second?.savedAt).toEqual(first?.savedAt);
		expect(second?.status).toBe(first?.status);
		expect(publishedDetailTypes(published).filter((type) => type === "QueueEntryCreated")).toHaveLength(1);
	});

	it("keeps a later save's position", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: afterRequest });

		await run(storeHandler(store), createSqsEvent([{ url: exampleUrl, userId }]));

		expect((await allRow(store))?.savedAt).toEqual(afterRequest);
	});

	it("keeps a read article read when it was read after the request", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: beforeRequest });
		await store.updateArticleStatus(id, userId, "read");
		const read = await allRow(store);

		await run(storeHandler(store), createSqsEvent([{ url: exampleUrl, userId }]));

		const after = await allRow(store);
		expect(after?.status).toBe("read");
		expect(after?.readAt).toEqual(read?.readAt);
		expect(after?.savedAt).toEqual(beforeRequest);
	});

	it("resurfaces an article read before the request", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: beforeRequest });
		await store.updateArticleStatus(id, userId, "read");

		await run(storeHandler(store), createSqsEvent([{ url: exampleUrl, userId }], "2099-01-01T00:00:00Z"));

		const after = await allRow(store);
		expect(after?.status).toBe("unread");
		expect(after?.savedAt.getTime()).toBeGreaterThan(beforeRequest.getTime());
	});

	it("files both readlists when one save sends two messages in one second", async () => {
		const store = initInMemoryArticleStore();
		const handler = storeHandler(store);

		await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));
		await run(handler, createSqsEvent([{ url: exampleUrl, userId, readlist: custom }]));

		expect(await allRow(store)).not.toBeNull();
		expect(await customRow(store)).not.toBeNull();
	});

	it("keeps a custom readlist's position on a stale message", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: afterRequest });
		await store.saveReadlistArticle({ ...seed, readlist: custom, savedAt: afterRequest });

		await run(storeHandler(store), createSqsEvent([{ url: exampleUrl, userId, readlist: custom }]));

		expect((await allRow(store))?.savedAt).toEqual(afterRequest);
		expect((await customRow(store))?.savedAt).toEqual(afterRequest);
	});

	it("keeps a custom readlist row read when it was read after the request", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: afterRequest });
		await store.saveReadlistArticle({ ...seed, readlist: custom, savedAt: beforeRequest });
		await store.setReadlistArticleStatus({ id, userId, readlist: custom, status: "read" });
		const read = await customRow(store);

		await run(storeHandler(store), createSqsEvent([{ url: exampleUrl, userId, readlist: custom }]));

		const after = await customRow(store);
		expect(after?.status).toBe("read");
		expect(after?.readAt).toEqual(read?.readAt);
		expect(after?.savedAt).toEqual(beforeRequest);
		expect((await allRow(store))?.status).toBe("unread");
	});

	it("files a lost filing when All was overtaken", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: afterRequest });

		await run(storeHandler(store), createSqsEvent([{ url: exampleUrl, userId, readlist: custom }]));

		expect((await allRow(store))?.savedAt).toEqual(afterRequest);
		expect((await customRow(store))?.status).toBe("unread");
	});

	it("files a lost filing as read when the reader read it after the request", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: beforeRequest });
		await store.updateArticleStatus(id, userId, "read");
		const all = await allRow(store);

		await run(storeHandler(store), createSqsEvent([{ url: exampleUrl, userId, readlist: custom }]));

		expect(await allRow(store)).toEqual(all);
		const filed = await customRow(store);
		expect(filed?.status).toBe("read");
		expect(filed?.readAt).toEqual(all?.readAt);
	});

	it("leaves an older custom row in place when All stays read", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: beforeRequest });
		await store.updateArticleStatus(id, userId, "read");
		await store.saveReadlistArticle({ ...seed, readlist: custom, savedAt: beforeRequest });
		const all = await allRow(store);

		await run(storeHandler(store), createSqsEvent([{ url: exampleUrl, userId, readlist: custom }]));

		expect(await allRow(store)).toEqual(all);
		const kept = await customRow(store);
		expect(kept?.status).toBe("unread");
		expect(kept?.savedAt).toEqual(beforeRequest);
	});

	it("refuses a read-only reader whose row is older than the request", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: beforeRequest });
		const before = await allRow(store);
		const { publishEvent, published } = initRecordingPublishEvent();

		await run(
			storeHandler(store, { resolveSubmitterStanding: async () => "read-only", publishEvent }),
			createSqsEvent([{ url: exampleUrl, userId }]),
		);

		expect(await allRow(store)).toEqual(before);
		expect(published).toEqual([
			{ detailType: LinkQueueFailedEvent.detailType, detail: { url: exampleUrl, userId, reason: "read-only", receiveCount: 1 } },
		]);
	});

	it("looks for the landed row under the resolved URL", async () => {
		const store = initInMemoryArticleStore();
		const wrapperUrl = "https://wrapper.example/redirect?to=post";
		await store.saveArticle({ ...seed, savedAt: afterRequest });
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = storeHandler(store, {
			resolveSubmitterStanding: async () => "read-only",
			resolveSaveIdentity: async () => ({ status: "resolved", url: exampleUrl, originalUrl: exampleUrl }),
			publishEvent,
		});

		const response = await run(handler, createSqsEvent([{ url: wrapperUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(publishedDetailTypes(published)).not.toContain("LinkQueueFailed");
	});

	it("acknowledges a Gmail output whose save landed before access lapsed", async () => {
		const store = initInMemoryArticleStore();
		await store.saveArticle({ ...seed, savedAt: afterRequest });
		const { publishEvent, published } = initRecordingPublishEvent();
		const emailOutput = { receivedAtMessageId: "2026-10-27T00:00:00.000Z#<m@x>", outputKey: "link#0000" };

		await run(
			storeHandler(store, { resolveSubmitterStanding: async () => "read-only", publishEvent }),
			createSqsEvent([{ url: exampleUrl, userId, emailOutput }]),
		);

		expect(published).toContainEqual({ detailType: EmailOutputSavedToAllEvent.detailType, detail: { userId, ...emailOutput } });
	});

	it("leaves a refused Gmail output unacknowledged", async () => {
		const emailOutput = { receivedAtMessageId: "2026-10-27T00:00:00.000Z#<m@x>", outputKey: "link#0000" };
		const { publishEvent: readOnlyEvents, published: readOnlyPublished } = initRecordingPublishEvent();
		await run(
			storeHandler(initInMemoryArticleStore(), { resolveSubmitterStanding: async () => "read-only", publishEvent: readOnlyEvents }),
			createSqsEvent([{ url: exampleUrl, userId, emailOutput }]),
		);
		const { publishEvent: purgedEvents, published: purgedPublished } = initRecordingPublishEvent();
		await run(
			storeHandler(await seedPurged(new Date("2026-06-02T00:00:01.000Z")), { publishEvent: purgedEvents }),
			createSqsEvent([{ url: exampleUrl, userId, emailOutput }]),
		);

		expect(readOnlyPublished).toEqual([
			{ detailType: LinkQueueFailedEvent.detailType, detail: { url: exampleUrl, userId, reason: "read-only", receiveCount: 1 } },
		]);
		expect(purgedPublished).toEqual([
			{ detailType: LinkQueueFailedEvent.detailType, detail: { url: exampleUrl, userId, reason: "purged-after-request", receiveCount: 1 } },
		]);
	});

	it("finishes a save that landed before access lapsed across two receives", async () => {
		const store = initInMemoryArticleStore();
		const { publishEvent, published } = initRecordingPublishEvent();
		const standings: Array<"may-save" | "read-only"> = ["may-save", "read-only"];
		const crawlAndFinalizeArticle = jest
			.fn<ReturnType<CrawlAndFinalizeArticle>, Parameters<CrawlAndFinalizeArticle>>()
			.mockRejectedValueOnce(new Error("crawl timed out"))
			.mockResolvedValue(fetchedResult);
		const handler = storeHandler(store, {
			resolveSubmitterStanding: async () => {
				const standing = standings.shift();
				assert(standing, "only two receives");
				return standing;
			},
			crawlAndFinalizeArticle,
			publishEvent,
		});
		const event = createSqsEvent([{ url: exampleUrl, userId }]);

		expect((await run(handler, event)).batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		const landed = await allRow(store);
		const second = await run(handler, event);

		expect(second.batchItemFailures).toEqual([]);
		expect(crawlAndFinalizeArticle).toHaveBeenCalledTimes(2);
		expect((await allRow(store))?.savedAt).toEqual(landed?.savedAt);
		expect(publishedDetailTypes(published)).not.toContain("LinkQueueFailed");
	});
});
