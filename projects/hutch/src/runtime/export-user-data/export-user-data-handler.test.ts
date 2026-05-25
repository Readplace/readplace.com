import { noopLogger, HutchLogger } from "@packages/hutch-logger";
import type { SQSBatchResponse, SQSEvent, SQSRecord, SQSRecordAttributes } from "aws-lambda";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import type { Minutes } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { UserDataExportedEvent } from "@packages/hutch-infra-components";
import type { UploadUserDataExport } from "../providers/user-data-export/user-data-export.types";
import { initExportUserDataHandler } from "./export-user-data-handler";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

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
	emailCalls: Array<{ to: string; subject: string; html: string }>;
	publishedEvents: Array<{ source: string; detailType: string; detail: unknown }>;
	handler: ReturnType<typeof initExportUserDataHandler>;
	store: ReturnType<typeof initInMemoryArticleStore>;
}

function createHarness(): HandlerHarness {
	const store = initInMemoryArticleStore();
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
		findArticlesByUser: store.findArticlesByUser,
		uploadUserDataExport,
		sendEmail: async (msg) => {
			emailCalls.push({ to: msg.to, subject: msg.subject, html: msg.html });
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

	return { uploadCalls, emailCalls, publishedEvents, handler, store };
}

async function invokeHandler(
	harness: HandlerHarness,
	detail: { userId: string; email: string; requestedAt: string },
): Promise<SQSBatchResponse> {
	const result = harness.handler(createSqsEvent(detail), {} as never, () => {});
	const awaited = result instanceof Promise ? await result : result;
	if (!awaited) throw new Error("handler returned void; expected SQSBatchResponse");
	return awaited;
}

describe("initExportUserDataHandler", () => {
	it("uploads an export, emails the user a download link, and publishes UserDataExportedEvent", async () => {
		const harness = createHarness();
		const userId = "user-1" as UserId;
		await harness.store.saveArticle({
			userId,
			url: "https://example.com/article-1",
			metadata: {
				title: "Article 1",
				siteName: "example.com",
				excerpt: "An excerpt",
				wordCount: 100,
			},
			estimatedReadTime: 1 as Minutes,
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
		const body = upload.parsedBody as {
			articleCount: number;
			articles: Array<{ url: string; title: string }>;
		};
		expect(body.articleCount).toBe(1);
		expect(body.articles[0].url).toBe("https://example.com/article-1");
		expect(body.articles[0].title).toBe("Article 1");

		expect(harness.emailCalls).toHaveLength(1);
		const email = harness.emailCalls[0];
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
		const userId = "user-many" as UserId;
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
				estimatedReadTime: 1 as Minutes,
			});
		}

		await invokeHandler(harness, {
			userId,
			email: "user@example.com",
			requestedAt: "2026-04-30T11:59:00.000Z",
		});

		const body = harness.uploadCalls[0].parsedBody as { articleCount: number };
		expect(body.articleCount).toBe(TOTAL);
		expect(harness.publishedEvents[0].detail).toMatchObject({ articleCount: TOTAL });
	});

	it("emits an empty export when the user has no articles", async () => {
		const harness = createHarness();
		const userId = "user-empty" as UserId;

		await invokeHandler(harness, {
			userId,
			email: "user@example.com",
			requestedAt: "2026-04-30T11:59:00.000Z",
		});

		const body = harness.uploadCalls[0].parsedBody as { articleCount: number; articles: unknown[] };
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

		const result = harness.handler(invalidEvent, {} as never, () => {});
		const response = result instanceof Promise ? await result : result;

		expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(harness.uploadCalls).toHaveLength(0);
		expect(harness.emailCalls).toHaveLength(0);
		expect(harness.publishedEvents).toHaveLength(0);
	});

	it("stops on the first empty page when total claims more rows (orphaned user_articles)", async () => {
		// findArticlesByUser drops orphans, so total can exceed the rows the
		// handler will ever see; termination must come from an empty page.
		const userId = "user-orphan" as UserId;
		const findArticlesByUser = jest
			.fn()
			.mockResolvedValueOnce({
				articles: [
					{
						id: { value: "a1" },
						userId,
						url: "https://example.com/a-1",
						metadata: { title: "A1", siteName: "example.com", excerpt: "x", wordCount: 1 },
						estimatedReadTime: 1 as Minutes,
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
			findArticlesByUser,
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
			{} as never,
			() => {},
		);
		if (result instanceof Promise) await result;

		expect(findArticlesByUser).toHaveBeenCalledTimes(2);
		expect(result).toBeInstanceOf(Promise);
		const body = uploadCalls[0].parsedBody as { articleCount: number };
		expect(body.articleCount).toBe(1);
		expect(emailCalls).toHaveLength(1);
		expect(publishedEvents[0].detail).toMatchObject({ articleCount: 1 });
	});
});
