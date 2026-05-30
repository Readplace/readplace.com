import type { Context, SQSEvent } from "aws-lambda";
import { noopLogger } from "@packages/hutch-logger";
import { ReaderArticleHashId } from "@packages/domain/article";
import { ReaderReadyEmailSentEvent } from "@packages/hutch-infra-components";
import { initReaderReadyNotifyHandler, type ReaderReadyNotifyDeps } from "./reader-ready-notify-handler";

const URL = "https://example.com/article";
const USER_ID = "user-1";
const SAVED_AT = new Date("2026-05-30T12:00:00.000Z");
const VIEWED_AT = new Date("2026-05-30T12:01:00.000Z"); // viewed while loading
const SUCCEEDED_AT = "2026-05-30T12:02:00.000Z"; // 2 min after save -> generation > 60s
const NOW = new Date("2026-05-30T12:07:00.000Z");
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

const stubContext = {} as Context;

function sqsEvent(detail: unknown, messageId = "msg-1"): SQSEvent {
	return {
		Records: [{
			messageId,
			receiptHandle: "r",
			body: JSON.stringify({ detail }),
			attributes: {
				ApproximateReceiveCount: "1",
				SentTimestamp: "1",
				SenderId: "x",
				ApproximateFirstReceiveTimestamp: "1",
			},
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:1:reader-ready-notify",
			awsRegion: "ap-southeast-2",
		}],
	};
}

function baseRow() {
	return {
		savedAt: SAVED_AT,
		status: "unread" as const,
		succeededAt: new Date(SUCCEEDED_AT),
		viewedAt: VIEWED_AT,
		emailSentAt: undefined,
	};
}

function createHandler(overrides: Partial<ReaderReadyNotifyDeps> = {}) {
	const deps: ReaderReadyNotifyDeps = {
		findUserArticleNotificationState: jest.fn().mockResolvedValue(baseRow()),
		findArticleByUrl: jest.fn().mockResolvedValue({
			id: ReaderArticleHashId.from(URL),
			url: URL,
			metadata: { title: "Distributed systems", siteName: "example.com", excerpt: "", wordCount: 100 },
			estimatedReadTime: 3,
			savedAt: SAVED_AT,
		}),
		findUserContactByUserId: jest.fn().mockResolvedValue({ email: "reader@example.com", emailVerified: true }),
		claimReaderReadyEmailSlot: jest.fn().mockResolvedValue(true),
		markReaderReadyEmailSent: jest.fn().mockResolvedValue(undefined),
		sendEmail: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		appOrigin: "https://readplace.com",
		cooldownMs: COOLDOWN_MS,
		now: () => NOW,
		logger: noopLogger,
		...overrides,
	};
	return { handler: initReaderReadyNotifyHandler(deps), deps };
}

function command(detail: Partial<{ userId: string; url: string; succeededAt: string }> = {}) {
	return sqsEvent({ userId: USER_ID, url: URL, succeededAt: SUCCEEDED_AT, ...detail });
}

describe("initReaderReadyNotifyHandler", () => {
	describe("happy path", () => {
		it("claims the cooldown, sends the email, stamps emailSentAt, and publishes ReaderReadyEmailSent", async () => {
			const { handler, deps } = createHandler();

			const result = await handler(command(), stubContext, () => {});

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.claimReaderReadyEmailSlot).toHaveBeenCalledWith({ userId: USER_ID, now: NOW, cooldownMs: COOLDOWN_MS });
			expect(deps.sendEmail).toHaveBeenCalledTimes(1);
			const sent = (deps.sendEmail as jest.Mock).mock.calls[0][0];
			expect(sent.to).toBe("reader@example.com");
			expect(sent.bcc).toBe("readplace+reader_ready@readplace.com");
			expect(sent.subject).toBe("Your reader view is ready");
			expect(sent.html).toContain(`https://readplace.com/queue/${ReaderArticleHashId.from(URL).value}/view`);
			expect(sent.html).toContain("Distributed systems");
			expect(deps.markReaderReadyEmailSent).toHaveBeenCalledWith({ userId: USER_ID, url: URL, at: NOW });
			expect(deps.publishEvent).toHaveBeenCalledWith(ReaderReadyEmailSentEvent, {
				userId: USER_ID,
				url: URL,
				sentAt: NOW.toISOString(),
			});
		});
	});

	describe("gates (skip without sending)", () => {
		async function expectSkipped(deps: ReturnType<typeof createHandler>["deps"], handler: ReturnType<typeof createHandler>["handler"]) {
			const result = await handler(command(), stubContext, () => {});
			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).not.toHaveBeenCalled();
			expect(deps.markReaderReadyEmailSent).not.toHaveBeenCalled();
			expect(deps.publishEvent).not.toHaveBeenCalled();
		}

		it("skips when the user-article row was deleted", async () => {
			const { handler, deps } = createHandler({
				findUserArticleNotificationState: jest.fn().mockResolvedValue(null),
			});
			await expectSkipped(deps, handler);
			expect(deps.claimReaderReadyEmailSlot).not.toHaveBeenCalled();
		});

		it("skips when the article was already marked read", async () => {
			const { handler, deps } = createHandler({
				findUserArticleNotificationState: jest.fn().mockResolvedValue({ ...baseRow(), status: "read" }),
			});
			await expectSkipped(deps, handler);
		});

		it("skips when the article was re-saved after success (savedAt > succeededAt)", async () => {
			const { handler, deps } = createHandler({
				findUserArticleNotificationState: jest.fn().mockResolvedValue({
					...baseRow(),
					savedAt: new Date("2026-05-30T12:05:00.000Z"),
				}),
			});
			await expectSkipped(deps, handler);
		});

		it("skips when an email was already sent (emailSentAt set)", async () => {
			const { handler, deps } = createHandler({
				findUserArticleNotificationState: jest.fn().mockResolvedValue({
					...baseRow(),
					emailSentAt: new Date("2026-05-30T12:03:00.000Z"),
				}),
			});
			await expectSkipped(deps, handler);
		});

		it("skips when generation took 60s or less", async () => {
			const { handler, deps } = createHandler({
				findUserArticleNotificationState: jest.fn().mockResolvedValue(baseRow()),
			});
			const result = await handler(
				command({ succeededAt: "2026-05-30T12:00:30.000Z" }),
				stubContext,
				() => {},
			);
			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).not.toHaveBeenCalled();
		});

		it("skips when the reader was never opened (no viewedAt) — defuses the import storm", async () => {
			const { handler, deps } = createHandler({
				findUserArticleNotificationState: jest.fn().mockResolvedValue({ ...baseRow(), viewedAt: undefined }),
			});
			await expectSkipped(deps, handler);
		});

		it("skips when the user was present until ready (viewedAt >= succeededAt)", async () => {
			const { handler, deps } = createHandler({
				findUserArticleNotificationState: jest.fn().mockResolvedValue({
					...baseRow(),
					viewedAt: new Date("2026-05-30T12:03:00.000Z"),
				}),
			});
			await expectSkipped(deps, handler);
		});

		it("skips when no user contact exists", async () => {
			const { handler, deps } = createHandler({
				findUserContactByUserId: jest.fn().mockResolvedValue(null),
			});
			await expectSkipped(deps, handler);
		});

		it("skips when the user's email is not verified", async () => {
			const { handler, deps } = createHandler({
				findUserContactByUserId: jest.fn().mockResolvedValue({ email: "reader@example.com", emailVerified: false }),
			});
			await expectSkipped(deps, handler);
		});

		it("skips when the global article cannot be resolved", async () => {
			const { handler, deps } = createHandler({
				findArticleByUrl: jest.fn().mockResolvedValue(null),
			});
			await expectSkipped(deps, handler);
			expect(deps.claimReaderReadyEmailSlot).not.toHaveBeenCalled();
		});

		it("skips (rate-limited) when the 6h cooldown slot cannot be claimed, sending nothing", async () => {
			const { handler, deps } = createHandler({
				claimReaderReadyEmailSlot: jest.fn().mockResolvedValue(false),
			});
			const result = await handler(command(), stubContext, () => {});
			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).not.toHaveBeenCalled();
			expect(deps.markReaderReadyEmailSent).not.toHaveBeenCalled();
		});
	});

	describe("failures", () => {
		it("reports a batch item failure when sending throws so SQS redrives the record", async () => {
			const { handler } = createHandler({
				sendEmail: jest.fn().mockRejectedValue(new Error("resend down")),
			});

			const result = await handler(command(), stubContext, () => {});

			expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		});

		it("reports a batch item failure on an invalid command detail", async () => {
			const { handler, deps } = createHandler();

			const result = await handler(sqsEvent({ url: URL }), stubContext, () => {});

			expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
			expect(deps.findUserArticleNotificationState).not.toHaveBeenCalled();
		});
	});
});
