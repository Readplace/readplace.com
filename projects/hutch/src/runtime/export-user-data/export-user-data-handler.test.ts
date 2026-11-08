import assert from "node:assert/strict";
import { noopLogger, Logger } from "@packages/logger";
import type { SQSBatchResponse, SQSEvent, SQSRecord, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { z } from "zod";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryHighlights } from "@packages/test-fixtures/providers/highlights";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initInMemoryEngagementStarter } from "@packages/test-fixtures/providers/onboarding-signals";
import { type Highlight, HighlightIdSchema, MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { UserDataExportedEvent, UserDataExportSkippedEvent } from "@packages/infra-components";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import type { UploadUserDataExport } from "../providers/user-data-export/user-data-export.types";
import { initExportUserDataHandler } from "./export-user-data-handler";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

const ExportBodySchema = z.object({
	articleCount: z.number(),
	articles: z.array(z.looseObject({ url: z.string(), title: z.string() })),
});

type ExportMessage = {
	userId: string;
	requestedAt: string;
	email?: string;
};

function createSqsEvent(detail: ExportMessage): SQSEvent {
	const record: SQSRecord = {
		messageId: "msg-1",
		receiptHandle: "receipt-1",
		body: JSON.stringify({ detail }),
		attributes: stubAttributes,
		messageAttributes: {},
		md5OfBody: "",
		eventSource: "aws:sqs",
		eventSourceARN:
			"arn:aws:sqs:ap-southeast-2:123456789:export-user-data",
		awsRegion: "ap-southeast-2",
	};
	return { Records: [record] };
}

function fixedNow(): Date {
	return new Date("2026-04-30T12:00:00.000Z");
}

const READER_EMAIL = "user@example.com";

type Auth = ReturnType<typeof initInMemoryAuth>;

interface HarnessHooks {
	onUpload?: (input: { auth: Auth; userId: UserId }) => Promise<void>;
	onSend?: (input: { auth: Auth; userId: UserId }) => Promise<void>;
	failSends?: number;
	failExportedPublishes?: number;
}

interface HandlerHarness {
	userId: UserId;
	auth: Auth;
	uploadCalls: Array<{ userId: string; bodyLength: number; parsedBody: unknown }>;
	objects: Map<string, string[]>;
	emailCalls: Array<{ from: string; replyTo: string | undefined; to: string; subject: string; html: string }>;
	publishedEvents: Array<{ source: string; detailType: string; detail: unknown }>;
	handler: ReturnType<typeof initExportUserDataHandler>;
	store: ReturnType<typeof initInMemoryArticleStore>;
	highlights: ReturnType<typeof initInMemoryHighlights>;
	engagement: ReturnType<typeof initInMemoryEngagementStarter>;
}

function initTestAuth(): Auth {
	return initInMemoryAuth({
		hashPassword: async (password) => `hashed:${password}`,
		verifyPassword: async (password, stored) => stored === `hashed:${password}`,
		now: fixedNow,
	});
}

async function signUp(auth: Auth, email: string): Promise<UserId> {
	const created = await auth.createUser({ email, password: "password123" });
	assert(created.ok, "sign-up failed");
	return created.userId;
}

async function createHarness(hooks: HarnessHooks = {}): Promise<HandlerHarness> {
	const auth = initTestAuth();
	const userId = await signUp(auth, READER_EMAIL);
	const store = initInMemoryArticleStore();
	const highlights = initInMemoryHighlights();
	const engagement = initInMemoryEngagementStarter({ library: store });
	const uploadCalls: HandlerHarness["uploadCalls"] = [];
	const objects: HandlerHarness["objects"] = new Map();
	const uploadUserDataExport: UploadUserDataExport = async ({ userId: uploadUserId, body }) => {
		uploadCalls.push({ userId: uploadUserId, bodyLength: body.length, parsedBody: JSON.parse(body) });
		const s3Key = `exports/${uploadUserId}/upload-${uploadCalls.length}.json`;
		objects.set(uploadUserId, [...(objects.get(uploadUserId) ?? []), s3Key]);
		await hooks.onUpload?.({ auth, userId });
		return { s3Key, downloadUrl: `https://example.com/signed/${uploadUserId}` };
	};
	const emailCalls: HandlerHarness["emailCalls"] = [];
	const publishedEvents: HandlerHarness["publishedEvents"] = [];
	let sendsToFail = hooks.failSends ?? 0;
	let exportedPublishesToFail = hooks.failExportedPublishes ?? 0;

	const handler = initExportUserDataHandler({
		engagementState: engagement,
		listReadlistDefinitions: store.listReadlistDefinitions,
		findArticlesAcrossReadlists: store.findArticlesAcrossReadlists,
		listAllUserHighlights: highlights.listAllUserHighlights,
		uploadUserDataExport,
		deleteUserExports: async (deletedUserId) => {
			objects.delete(deletedUserId);
		},
		findExportRecipient: auth.findExportRecipient,
		markExportDelivered: auth.markExportDelivered,
		sendEmail: async (msg) => {
			if (sendsToFail > 0) {
				sendsToFail--;
				throw new Error("Resend 500");
			}
			emailCalls.push({ from: msg.from, replyTo: msg.replyTo, to: msg.to, subject: msg.subject, html: msg.html });
			await hooks.onSend?.({ auth, userId });
		},
		publishEvent: async (event, detail) => {
			if (event.detailType === UserDataExportedEvent.detailType && exportedPublishesToFail > 0) {
				exportedPublishesToFail--;
				throw new Error("PutEvents failed");
			}
			publishedEvents.push({
				source: event.source,
				detailType: event.detailType,
				detail,
			});
		},
		logger: Logger.from(noopLogger),
		now: fixedNow,
	});

	return { userId, auth, uploadCalls, objects, emailCalls, publishedEvents, handler, store, highlights, engagement };
}

async function invokeHandler(
	harness: HandlerHarness,
	detail: ExportMessage,
): Promise<SQSBatchResponse> {
	const result = harness.handler(createSqsEvent(detail), buildLambdaContext(), () => {});
	const awaited = result instanceof Promise ? await result : result;
	if (!awaited) throw new Error("handler returned void; expected SQSBatchResponse");
	return awaited;
}

describe("initExportUserDataHandler", () => {
	it("exports the permanent assignment, frozen starter, readlist identity and article attribution", async () => {
		const harness = await createHarness();
		const { userId } = harness;
		const now = fixedNow();
		const picks = Array.from({ length: 10 }, (_, index) => ({
			url: `https://publisher.com/${index}`,
			hnItemId: index + 100,
			rank: index + 1,
			snapshotAt: now.toISOString(),
		}));
		const pack = {
			campaignId: "hn-starter-v1",
			picks,
			readlist: ReadlistSlugSchema.parse("hn-picks"),
			readlistLabel: "Hacker News picks",
			selectedAt: now.toISOString(),
			emailStatus: "pending" as const,
		};
		const observed = await harness.engagement.observeEngagement({
			userId,
			startedAt: now.toISOString(),
		});
		const assignment = {
			campaignId: pack.campaignId,
			arm: "treatment" as const,
			assignedAt: now.toISOString(),
			tier: "paid" as const,
			accountCohort: "existing" as const,
		};
		await harness.engagement.assignStarter({
			userId,
			revision: observed.activityRevision,
			assignment,
			pack,
		});
		for (const pick of picks) {
			await harness.store.saveArticleGlobally({
				url: pick.url,
				metadata: { title: "Pick", siteName: "Publisher", excerpt: "", wordCount: 100 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: now,
			});
			await harness.store.setReaderAvailableAt({ url: pick.url, at: now });
		}
		await harness.engagement.saveStarterPack({
			userId,
			activityRevision: observed.activityRevision + 1,
			pack,
			savedAt: Array(10).fill(now),
			at: now,
		});
		await invokeHandler(harness, {
			userId,
			requestedAt: now.toISOString(),
		});
		expect(harness.uploadCalls[0]?.parsedBody).toMatchObject({
			engagement: { assignment, observationStartedAt: now.toISOString() },
			starterPack: { ...pack, insertedAt: now.toISOString() },
			readlists: [{ slug: pack.readlist, starterCampaignId: pack.campaignId }],
			articleCount: 10,
		});
		const body = ExportBodySchema.parse(harness.uploadCalls[0]?.parsedBody);
		expect(body.articles.sort((a, b) => a.url.localeCompare(b.url))).toMatchObject(
			picks.map((pick) => ({
				url: pick.url,
				provenance: { kind: "hn-suggestion", campaignId: pack.campaignId },
				suggestionAttribution: {
					campaignId: pack.campaignId,
					hnItemId: pick.hnItemId,
					snapshotAt: pick.snapshotAt,
					rank: pick.rank,
				},
			})),
		);
	});
	it("uploads an export, emails the user a download link, and publishes UserDataExportedEvent", async () => {
		const harness = await createHarness();
		const { userId } = harness;
		await harness.store.saveArticle({
			userId,
			url: "https://example.com/article-1",
			metadata: {
				title: "Article 1",
				siteName: "example.com",
				excerpt: "An excerpt",
				wordCount: 100,
			},
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date(),
		});

		const response = await invokeHandler(harness, {
			userId,
			requestedAt: "2026-04-30T11:59:00.000Z",
		});

		expect(response).toEqual({ batchItemFailures: [] });
		expect(harness.uploadCalls).toHaveLength(1);
		const upload = harness.uploadCalls[0];
		expect(upload.userId).toBe(userId);
		const body = ExportBodySchema.parse(upload.parsedBody);
		expect(body.articleCount).toBe(1);
		expect(body.articles[0].url).toBe("https://example.com/article-1");
		expect(body.articles[0].title).toBe("Article 1");

		expect(harness.emailCalls).toHaveLength(1);
		const email = harness.emailCalls[0];
		expect(email.from).toBe("Readplace <readplace@readplace.com>");
		expect(email.replyTo).toBe("fayner@readplace.com");
		expect(email.to).toBe("user@example.com");
		expect(email.subject).toBe("Your Readplace export is ready");
		expect(email.html).toContain(`https://example.com/signed/${userId}`);
		expect(email.html).toContain("7 days");

		expect(harness.publishedEvents).toHaveLength(1);
		expect(harness.publishedEvents[0].source).toBe(UserDataExportedEvent.source);
		expect(harness.publishedEvents[0].detailType).toBe(UserDataExportedEvent.detailType);
		expect(harness.publishedEvents[0].detail).toEqual({
			userId,
			articleCount: 1,
			s3Key: `exports/${userId}/upload-1.json`,
			exportedAt: "2026-04-30T12:00:00.000Z",
		});
	});

	it("paginates through every page when the user has more articles than one page", async () => {
		const harness = await createHarness();
		const { userId } = harness;
		// PAGE_SIZE in the handler is 500; cross the boundary to force two pages.
		const TOTAL = 600;
		for (let i = 0; i < TOTAL; i++) {
			await harness.store.saveArticle({
				userId,
				url: `https://example.com/article-${i}`,
				metadata: {
					title: `Article ${i}`,
					siteName: "example.com",
					excerpt: "x",
					wordCount: 100,
				},
				estimatedReadTime: MinutesSchema.parse(1),
				provenance: { kind: "web" },
				savedAt: new Date(),
			});
		}

		await invokeHandler(harness, {
			userId,
			requestedAt: "2026-04-30T11:59:00.000Z",
		});

		const body = ExportBodySchema.parse(harness.uploadCalls[0].parsedBody);
		expect(body.articleCount).toBe(TOTAL);
		expect(harness.publishedEvents[0].detail).toMatchObject({ articleCount: TOTAL });
	});

	it("exports an article saved only to a named readlist, not just the All readlist", async () => {
		const harness = await createHarness();
		const { userId } = harness;
		await harness.store.saveArticle({
			userId,
			url: "https://example.com/in-all",
			metadata: { title: "In All", siteName: "example.com", excerpt: "x", wordCount: 100 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-04-28T00:00:00.000Z"),
		});
		const work = ReadlistSlugSchema.parse("work");
		await harness.store.createReadlistDefinition({
			userId,
			slug: work,
			label: "Work",
			createdAt: new Date("2026-04-27T00:00:00.000Z"),
		});
		await harness.store.saveReadlistArticle({
			userId,
			url: "https://example.com/only-in-work",
			metadata: { title: "Only In Work", siteName: "example.com", excerpt: "x", wordCount: 100 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-04-29T00:00:00.000Z"),
			readlist: work,
		});

		await invokeHandler(harness, {
			userId,
			requestedAt: "2026-04-30T11:59:00.000Z",
		});

		const body = ExportBodySchema.parse(harness.uploadCalls[0].parsedBody);
		expect(body.articleCount).toBe(2);
		expect(body.articles.map((a) => a.url).sort()).toEqual([
			"https://example.com/in-all",
			"https://example.com/only-in-work",
		]);
	});

	describe("highlights", () => {
		const HIGHLIGHTED_URL = "https://example.com/highlighted?utm_source=x";

		function aHighlight(overrides: Partial<Highlight> & Pick<Highlight, "highlightId" | "exact" | "orderKey">): Highlight {
			return {
				highlightOf: ArticleResourceUniqueId.parse(HIGHLIGHTED_URL).value,
				prefix: "",
				suffix: "",
				start: 0,
				end: overrides.exact.length,
				anchoredContentHash: "hash-1",
				anchorState: "anchored",
				createdAt: new Date("2026-04-29T10:00:00.000Z"),
				updatedAt: new Date("2026-04-29T10:00:00.000Z"),
				anchorRevision: 0,
				...overrides,
			};
		}

		async function saveArticle(harness: HandlerHarness, url: string): Promise<void> {
			await harness.store.saveArticle({
				userId: harness.userId,
				url,
				metadata: { title: url, siteName: "example.com", excerpt: "x", wordCount: 100 },
				estimatedReadTime: MinutesSchema.parse(1),
				provenance: { kind: "web" },
				savedAt: new Date("2026-04-28T00:00:00.000Z"),
			});
		}

		const ExportWithHighlightsSchema = z.object({
			articles: z.array(z.looseObject({ url: z.string() })),
		});

		it("exports an article's highlights in reading order with their anchor state", async () => {
			const harness = await createHarness();
			await saveArticle(harness, HIGHLIGHTED_URL);
			for (const highlight of [
				aHighlight({
					highlightId: HighlightIdSchema.parse("00000000-0000-4000-8000-000000000002"),
					exact: "second passage",
					orderKey: 20,
					anchorState: "orphaned",
				}),
				aHighlight({
					highlightId: HighlightIdSchema.parse("00000000-0000-4000-8000-000000000001"),
					exact: "first passage",
					orderKey: 10,
					note: "keep this",
				}),
			]) {
				const created = await harness.highlights.createHighlight({
					userId: harness.userId,
					highlight,
					replacedIds: [],
				});
				assert.equal(created.status, "created");
			}

			await invokeHandler(harness, { userId: harness.userId, requestedAt: "2026-04-30T11:59:00.000Z" });

			const body = ExportWithHighlightsSchema.parse(harness.uploadCalls[0].parsedBody);
			const [article] = body.articles;
			expect(article.url).toBe(HIGHLIGHTED_URL);
			expect(article.highlights).toEqual([
				{
					quote: "first passage",
					prefix: "",
					suffix: "",
					note: "keep this",
					state: "anchored",
					createdAt: "2026-04-29T10:00:00.000Z",
					updatedAt: "2026-04-29T10:00:00.000Z",
				},
				{
					quote: "second passage",
					prefix: "",
					suffix: "",
					state: "orphaned",
					createdAt: "2026-04-29T10:00:00.000Z",
					updatedAt: "2026-04-29T10:00:00.000Z",
				},
			]);
		});

		it("writes no highlights key on an article without highlights", async () => {
			const harness = await createHarness();
			await saveArticle(harness, HIGHLIGHTED_URL);
			await saveArticle(harness, "https://example.com/plain");
			const created = await harness.highlights.createHighlight({
				userId: harness.userId,
				highlight: aHighlight({
					highlightId: HighlightIdSchema.parse("00000000-0000-4000-8000-000000000003"),
					exact: "a passage",
					orderKey: 1,
				}),
				replacedIds: [],
			});
			assert.equal(created.status, "created");

			await invokeHandler(harness, { userId: harness.userId, requestedAt: "2026-04-30T11:59:00.000Z" });

			const body = ExportWithHighlightsSchema.parse(harness.uploadCalls[0].parsedBody);
			const plain = body.articles.find((a) => a.url === "https://example.com/plain");
			assert(plain, "plain article missing from the export");
			expect(Object.keys(plain).sort()).toEqual(
				["excerpt", "provenance", "readAt", "readTime", "savedAt", "siteName", "status", "title", "url", "wordCount"],
			);
		});
	});

	it("emits an empty export when the user has no articles", async () => {
		const harness = await createHarness();
		const { userId } = harness;

		await invokeHandler(harness, {
			userId,
			requestedAt: "2026-04-30T11:59:00.000Z",
		});

		const body = ExportBodySchema.parse(harness.uploadCalls[0].parsedBody);
		expect(body.articleCount).toBe(0);
		expect(body.articles).toEqual([]);
		expect(harness.emailCalls[0].html).toContain("0 articles");
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const harness = await createHarness();

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { invalid: true } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:export-user-data",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = harness.handler(invalidEvent, buildLambdaContext(), () => {});
		const response = result instanceof Promise ? await result : result;

		expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(harness.uploadCalls).toHaveLength(0);
		expect(harness.emailCalls).toHaveLength(0);
		expect(harness.publishedEvents).toHaveLength(0);
	});

	it("stops on the first empty page when total claims more rows (orphaned user_articles)", async () => {
		const auth = initTestAuth();
		const userId = await signUp(auth, READER_EMAIL);
		const findArticlesAcrossReadlists = jest
			.fn()
			.mockResolvedValueOnce({
				articles: [
					{
						id: { value: "a1" },
						userId,
						url: "https://example.com/a-1",
						metadata: { title: "A1", siteName: "example.com", excerpt: "x", wordCount: 1 },
						estimatedReadTime: MinutesSchema.parse(1),
						status: "unread" as const,
						savedAt: new Date("2026-04-29T00:00:00.000Z"),
					},
				],
				total: 2,
				page: 1,
				pageSize: 500,
			})
			.mockResolvedValueOnce({ articles: [], total: 2, page: 2, pageSize: 500 });

		const uploadCalls: Array<{ parsedBody: unknown }> = [];
		const emailCalls: Array<{ to: string }> = [];
		const publishedEvents: Array<{ detail: unknown }> = [];

		const handler = initExportUserDataHandler({
			engagementState: {
				findEngagement: async () => ({ activityRevision: 0 }),
				findStarterPack: async () => undefined,
			},
			listReadlistDefinitions: async () => [],
			findArticlesAcrossReadlists,
			listAllUserHighlights: async () => [],
			uploadUserDataExport: async ({ userId: uid, body }) => {
				uploadCalls.push({ parsedBody: JSON.parse(body) });
				return { s3Key: `exports/${uid}/x.json`, downloadUrl: "https://example.com/d" };
			},
			deleteUserExports: async () => {},
			findExportRecipient: auth.findExportRecipient,
			markExportDelivered: auth.markExportDelivered,
			sendEmail: async (msg) => {
				emailCalls.push({ to: msg.to });
			},
			publishEvent: async (_event, detail) => {
				publishedEvents.push({ detail });
			},
			logger: Logger.from(noopLogger),
			now: fixedNow,
		});

		const result = handler(
			createSqsEvent({
				userId,
				requestedAt: "2026-04-30T11:59:00.000Z",
			}),
			buildLambdaContext(),
			() => {},
		);
		if (result instanceof Promise) await result;

		expect(findArticlesAcrossReadlists).toHaveBeenCalledTimes(2);
		expect(result).toBeInstanceOf(Promise);
		const body = ExportBodySchema.parse(uploadCalls[0].parsedBody);
		expect(body.articleCount).toBe(1);
		expect(emailCalls).toHaveLength(1);
		expect(publishedEvents[0].detail).toMatchObject({ articleCount: 1 });
	});

	describe("redrive safety", () => {
		const REQUESTED_AT = "2026-04-30T11:59:00.000Z";
		const LATER_REQUESTED_AT = "2026-04-30T11:59:30.000Z";

		function skipped(input: { userId: UserId; requestedAt: string; reason: string }) {
			return {
				source: UserDataExportSkippedEvent.source,
				detailType: UserDataExportSkippedEvent.detailType,
				detail: input,
			};
		}

		function exported(input: { userId: UserId; s3Key: string }) {
			return {
				source: UserDataExportedEvent.source,
				detailType: UserDataExportedEvent.detailType,
				detail: { ...input, articleCount: 0, exportedAt: "2026-04-30T12:00:00.000Z" },
			};
		}

		it("skips with no email and no object when the account row is gone", async () => {
			const harness = await createHarness();
			const { userId } = harness;
			await harness.auth.closeUserAccount(userId);

			const response = await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(harness.uploadCalls).toEqual([]);
			expect(harness.emailCalls).toEqual([]);
			expect(Object.fromEntries(harness.objects)).toEqual({});
			expect(harness.publishedEvents).toEqual([
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "account-gone" }),
			]);
			expect(await harness.auth.findExportRecipient(userId)).toBeNull();
		});

		it("skips with no email and no object when deletedAt is set", async () => {
			const harness = await createHarness();
			const { userId } = harness;
			await harness.auth.markAccountDeleted({ userId, at: "2026-04-30T11:59:10.000Z" });

			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(harness.emailCalls).toEqual([]);
			expect(Object.fromEntries(harness.objects)).toEqual({});
			expect(harness.publishedEvents).toEqual([
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "account-deleting" }),
			]);
		});

		it("mails the live row's address when an old-shape message carries a stale email", async () => {
			const harness = await createHarness();
			const { userId } = harness;

			await invokeHandler(harness, { userId, email: "old@example.com", requestedAt: REQUESTED_AT });

			expect(harness.emailCalls.map((email) => email.to)).toEqual([READER_EMAIL]);
		});

		it("does not mail the new owner when the address was reclaimed under a new userId", async () => {
			const harness = await createHarness();
			const { userId } = harness;
			await harness.auth.closeUserAccount(userId);
			const newUserId = await signUp(harness.auth, READER_EMAIL);

			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(harness.emailCalls).toEqual([]);
			expect(Object.fromEntries(harness.objects)).toEqual({});
			expect(harness.publishedEvents).toEqual([
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "account-gone" }),
			]);
			expect(await harness.auth.findExportRecipient(newUserId)).toEqual({
				email: READER_EMAIL,
				deletedAt: undefined,
				exportDeliveredRequestedAt: undefined,
			});
		});

		it("run twice: one email, marker equals requestedAt, second run publishes already-delivered", async () => {
			const harness = await createHarness();
			const { userId } = harness;

			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });
			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(harness.emailCalls.map((email) => email.to)).toEqual([READER_EMAIL]);
			expect(Object.fromEntries(harness.objects)).toEqual({ [userId]: [`exports/${userId}/upload-1.json`] });
			expect(harness.publishedEvents).toEqual([
				exported({ userId, s3Key: `exports/${userId}/upload-1.json` }),
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "already-delivered" }),
			]);
			expect(await harness.auth.findExportRecipient(userId)).toEqual({
				email: READER_EMAIL,
				deletedAt: undefined,
				exportDeliveredRequestedAt: REQUESTED_AT,
			});
		});

		it("run after a later delivered export: an older request skips and the marker keeps the later value", async () => {
			const harness = await createHarness();
			const { userId } = harness;

			await invokeHandler(harness, { userId, requestedAt: LATER_REQUESTED_AT });
			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(harness.emailCalls.map((email) => email.to)).toEqual([READER_EMAIL]);
			expect(harness.publishedEvents).toEqual([
				exported({ userId, s3Key: `exports/${userId}/upload-1.json` }),
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "already-delivered" }),
			]);
			expect(await harness.auth.findExportRecipient(userId)).toEqual({
				email: READER_EMAIL,
				deletedAt: undefined,
				exportDeliveredRequestedAt: LATER_REQUESTED_AT,
			});
		});

		it("a newer request after an older delivered one sends and moves the marker forward", async () => {
			const harness = await createHarness();
			const { userId } = harness;

			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });
			await invokeHandler(harness, { userId, requestedAt: LATER_REQUESTED_AT });

			expect(harness.emailCalls.map((email) => email.to)).toEqual([READER_EMAIL, READER_EMAIL]);
			expect(harness.publishedEvents).toEqual([
				exported({ userId, s3Key: `exports/${userId}/upload-1.json` }),
				exported({ userId, s3Key: `exports/${userId}/upload-2.json` }),
			]);
			expect(await harness.auth.findExportRecipient(userId)).toEqual({
				email: READER_EMAIL,
				deletedAt: undefined,
				exportDeliveredRequestedAt: LATER_REQUESTED_AT,
			});
		});

		it("publish failure after the send: the retry sends no second email and publishes already-delivered", async () => {
			const harness = await createHarness({ failExportedPublishes: 1 });
			const { userId } = harness;

			const first = await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });
			const retry = await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(first).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
			expect(retry).toEqual({ batchItemFailures: [] });
			expect(harness.emailCalls.map((email) => email.to)).toEqual([READER_EMAIL]);
			expect(Object.fromEntries(harness.objects)).toEqual({ [userId]: [`exports/${userId}/upload-1.json`] });
			expect(harness.publishedEvents).toEqual([
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "already-delivered" }),
			]);
		});

		it("send failure leaves the marker unset so the retry delivers", async () => {
			const harness = await createHarness({ failSends: 1 });
			const { userId } = harness;

			const first = await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });
			const afterFailure = await harness.auth.findExportRecipient(userId);
			const retry = await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(first).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
			expect(afterFailure).toEqual({ email: READER_EMAIL, deletedAt: undefined, exportDeliveredRequestedAt: undefined });
			expect(retry).toEqual({ batchItemFailures: [] });
			expect(harness.emailCalls.map((email) => email.to)).toEqual([READER_EMAIL]);
			expect(harness.publishedEvents).toEqual([
				exported({ userId, s3Key: `exports/${userId}/upload-2.json` }),
			]);
			expect(await harness.auth.findExportRecipient(userId)).toEqual({
				email: READER_EMAIL,
				deletedAt: undefined,
				exportDeliveredRequestedAt: REQUESTED_AT,
			});
		});

		it("delete overtaking between the gates: the uploaded object is removed, no email, fact account-deleting", async () => {
			const harness = await createHarness({
				onUpload: ({ auth, userId }) => auth.markAccountDeleted({ userId, at: "2026-04-30T11:59:40.000Z" }),
			});
			const { userId } = harness;

			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(harness.uploadCalls).toHaveLength(1);
			expect(harness.emailCalls).toEqual([]);
			expect(Object.fromEntries(harness.objects)).toEqual({});
			expect(harness.publishedEvents).toEqual([
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "account-deleting" }),
			]);
		});

		it("account closed between the gates: the object is removed, no email, fact account-gone", async () => {
			const harness = await createHarness({
				onUpload: ({ auth, userId }) => auth.closeUserAccount(userId),
			});
			const { userId } = harness;

			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(harness.emailCalls).toEqual([]);
			expect(Object.fromEntries(harness.objects)).toEqual({});
			expect(harness.publishedEvents).toEqual([
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "account-gone" }),
			]);
		});

		it("a later delivered request between the gates: no email and the delivered object stays", async () => {
			const harness = await createHarness({
				onUpload: ({ auth, userId }) =>
					auth.markExportDelivered({ userId, email: READER_EMAIL, requestedAt: LATER_REQUESTED_AT }),
			});
			const { userId } = harness;
			harness.objects.set(userId, [`exports/${userId}/delivered.json`]);

			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(harness.emailCalls).toEqual([]);
			expect(Object.fromEntries(harness.objects)).toEqual({
				[userId]: [`exports/${userId}/delivered.json`, `exports/${userId}/upload-1.json`],
			});
			expect(harness.publishedEvents).toEqual([
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "already-delivered" }),
			]);
			expect(await harness.auth.findExportRecipient(userId)).toEqual({
				email: READER_EMAIL,
				deletedAt: undefined,
				exportDeliveredRequestedAt: LATER_REQUESTED_AT,
			});
		});

		it("run after delete finished: redrive leaves no object under the deleted userId, including one left by an earlier crash", async () => {
			const harness = await createHarness();
			const { userId } = harness;
			harness.objects.set(userId, [`exports/${userId}/left-by-crash.json`]);
			await harness.auth.closeUserAccount(userId);

			await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(harness.emailCalls).toEqual([]);
			expect(Object.fromEntries(harness.objects)).toEqual({});
			expect(harness.publishedEvents).toEqual([
				skipped({ userId, requestedAt: REQUESTED_AT, reason: "account-gone" }),
			]);
		});

		it("the row closed between send and mark does not fail the record", async () => {
			const harness = await createHarness({
				onSend: ({ auth, userId }) => auth.closeUserAccount(userId),
			});
			const { userId } = harness;

			const response = await invokeHandler(harness, { userId, requestedAt: REQUESTED_AT });

			expect(response).toEqual({ batchItemFailures: [] });
			expect(harness.emailCalls.map((email) => email.to)).toEqual([READER_EMAIL]);
			expect(harness.publishedEvents).toEqual([
				exported({ userId, s3Key: `exports/${userId}/upload-1.json` }),
			]);
			expect(await harness.auth.findExportRecipient(userId)).toBeNull();
		});
	});
});
