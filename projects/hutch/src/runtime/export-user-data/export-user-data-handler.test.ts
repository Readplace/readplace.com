import { noopLogger, HutchLogger } from "@packages/hutch-logger";
import type { SQSBatchResponse, SQSEvent, SQSRecord, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { z } from "zod";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryEngagementStarter } from "@packages/test-fixtures/providers/onboarding-signals";
import { MinutesSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { UserDataExportedEvent } from "@packages/hutch-infra-components";
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

function createSqsEvent(detail: {
	userId: string;
	email: string;
	requestedAt: string;
}): SQSEvent {
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

interface HandlerHarness {
	uploadCalls: Array<{ userId: string; bodyLength: number; parsedBody: unknown }>;
	emailCalls: Array<{ from: string; to: string; subject: string; html: string }>;
	publishedEvents: Array<{ source: string; detailType: string; detail: unknown }>;
	handler: ReturnType<typeof initExportUserDataHandler>;
	store: ReturnType<typeof initInMemoryArticleStore>;
	engagement: ReturnType<typeof initInMemoryEngagementStarter>;
}

function createHarness(): HandlerHarness {
	const store = initInMemoryArticleStore();
	const engagement = initInMemoryEngagementStarter({ library: store });
	const uploadCalls: HandlerHarness["uploadCalls"] = [];
	const uploadUserDataExport: UploadUserDataExport = async ({ userId, body }) => {
		uploadCalls.push({ userId, bodyLength: body.length, parsedBody: JSON.parse(body) });
		return {
			s3Key: `exports/${userId}/2026-04-30T12-00-00-000Z.json`,
			downloadUrl: `https://example.com/signed/${userId}`,
		};
	};
	const emailCalls: HandlerHarness["emailCalls"] = [];
	const publishedEvents: HandlerHarness["publishedEvents"] = [];

	const handler = initExportUserDataHandler({
		engagementState: engagement,
		listReadlistDefinitions: store.listReadlistDefinitions,
		findArticlesAcrossReadlists: store.findArticlesAcrossReadlists,
		uploadUserDataExport,
		sendEmail: async (msg) => {
			emailCalls.push({ from: msg.from, to: msg.to, subject: msg.subject, html: msg.html });
		},
		publishEvent: async (event, detail) => {
			publishedEvents.push({
				source: event.source,
				detailType: event.detailType,
				detail,
			});
		},
		logger: HutchLogger.from(noopLogger),
		now: fixedNow,
	});

	return { uploadCalls, emailCalls, publishedEvents, handler, store, engagement };
}

async function invokeHandler(
	harness: HandlerHarness,
	detail: { userId: string; email: string; requestedAt: string },
): Promise<SQSBatchResponse> {
	const result = harness.handler(createSqsEvent(detail), buildLambdaContext(), () => {});
	const awaited = result instanceof Promise ? await result : result;
	if (!awaited) throw new Error("handler returned void; expected SQSBatchResponse");
	return awaited;
}

describe("initExportUserDataHandler", () => {
	it("exports the permanent assignment, frozen starter, readlist identity and article attribution", async () => {
		const harness = createHarness();
		const userId = UserIdSchema.parse("starter-user");
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
			email: "reader@recipient.com",
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
		const harness = createHarness();
		const userId = UserIdSchema.parse("user-1");
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
			email: "user@example.com",
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
		expect(email.from).toBe("Readplace <fayner@readplace.com>");
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
			s3Key: `exports/${userId}/2026-04-30T12-00-00-000Z.json`,
			exportedAt: "2026-04-30T12:00:00.000Z",
		});
	});

	it("paginates through every page when the user has more articles than one page", async () => {
		const harness = createHarness();
		const userId = UserIdSchema.parse("user-many");
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
			email: "user@example.com",
			requestedAt: "2026-04-30T11:59:00.000Z",
		});

		const body = ExportBodySchema.parse(harness.uploadCalls[0].parsedBody);
		expect(body.articleCount).toBe(TOTAL);
		expect(harness.publishedEvents[0].detail).toMatchObject({ articleCount: TOTAL });
	});

	it("exports an article saved only to a named readlist, not just the All readlist", async () => {
		const harness = createHarness();
		const userId = UserIdSchema.parse("user-readlists");
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
			email: "user@example.com",
			requestedAt: "2026-04-30T11:59:00.000Z",
		});

		const body = ExportBodySchema.parse(harness.uploadCalls[0].parsedBody);
		expect(body.articleCount).toBe(2);
		expect(body.articles.map((a) => a.url).sort()).toEqual([
			"https://example.com/in-all",
			"https://example.com/only-in-work",
		]);
	});

	it("emits an empty export when the user has no articles", async () => {
		const harness = createHarness();
		const userId = UserIdSchema.parse("user-empty");

		await invokeHandler(harness, {
			userId,
			email: "user@example.com",
			requestedAt: "2026-04-30T11:59:00.000Z",
		});

		const body = ExportBodySchema.parse(harness.uploadCalls[0].parsedBody);
		expect(body.articleCount).toBe(0);
		expect(body.articles).toEqual([]);
		expect(harness.emailCalls[0].html).toContain("0 articles");
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const harness = createHarness();

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
		const userId = UserIdSchema.parse("user-orphan");
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
			uploadUserDataExport: async ({ userId: uid, body }) => {
				uploadCalls.push({ parsedBody: JSON.parse(body) });
				return { s3Key: `exports/${uid}/x.json`, downloadUrl: "https://example.com/d" };
			},
			sendEmail: async (msg) => {
				emailCalls.push({ to: msg.to });
			},
			publishEvent: async (_event, detail) => {
				publishedEvents.push({ detail });
			},
			logger: HutchLogger.from(noopLogger),
			now: fixedNow,
		});

		const result = handler(
			createSqsEvent({
				userId,
				email: "user@example.com",
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
});
