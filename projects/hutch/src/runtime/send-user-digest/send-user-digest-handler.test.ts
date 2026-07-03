import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { noopLogger } from "@packages/hutch-logger";
import { ReaderArticleHashId } from "@packages/domain/article";
import { DigestEmailSentEvent } from "@packages/hutch-infra-components";
import type { UserArticleNotificationState } from "@packages/provider-contracts/article-store";
import { initSendUserDigestHandler, type SendUserDigestDeps } from "./send-user-digest-handler";

const USER_ID = "user-1";
const URL_A = "https://example.com/a";
const URL_B = "https://example.com/b";
const CANON_A = "example.com/a";
const CANON_B = "example.com/b";
const SAVED_AT = new Date("2026-06-01T12:00:00.000Z");
const VIEWED_AT = new Date("2026-06-01T12:01:00.000Z"); // viewed while still loading
const SUCCEEDED_AT = new Date("2026-06-01T12:02:00.000Z"); // 2 min after save -> generation > 60s
const NOW = new Date("2026-06-01T18:00:00.000Z");
const COOLDOWN_MS = 5.5 * 60 * 60 * 1000;

function eligibleState(): UserArticleNotificationState {
	return {
		savedAt: SAVED_AT,
		status: "unread",
		succeededAt: SUCCEEDED_AT,
		viewedAt: VIEWED_AT,
		emailSentAt: undefined,
	};
}

function digestItem(originalUrl: string, url: string) {
	return { userId: USER_ID, url, originalUrl, enqueuedAt: "2026-06-01T12:03:00.000Z" };
}

function article(url: string, title: string) {
	return {
		id: ReaderArticleHashId.from(url),
		url,
		metadata: { title, siteName: "example.com", excerpt: "", wordCount: 100 },
		estimatedReadTime: 3,
		savedAt: SAVED_AT,
	};
}

function command(userId: string = USER_ID) {
	return buildSqsEvent([{ messageId: "msg-1", body: JSON.stringify({ detail: { userId } }) }]);
}

function createHandler(overrides: Partial<SendUserDigestDeps> = {}) {
	const deps: SendUserDigestDeps = {
		findUserContactByUserId: jest.fn().mockResolvedValue({ email: "reader@example.com", emailVerified: true }),
		listDigestItemsByUser: jest.fn().mockResolvedValue([digestItem(URL_A, CANON_A)]),
		findUserArticleNotificationState: jest.fn().mockResolvedValue(eligibleState()),
		findArticleByUrl: jest.fn().mockImplementation(async (url: string) => article(url, url === URL_A ? "Alpha" : "Beta")),
		readArticleContent: jest.fn().mockResolvedValue("<p>Body paragraph.</p>"),
		deleteDigestItem: jest.fn().mockResolvedValue(undefined),
		claimReaderReadyEmailSlot: jest.fn().mockResolvedValue(true),
		releaseReaderReadyEmailSlot: jest.fn().mockResolvedValue(undefined),
		markReaderReadyEmailSent: jest.fn().mockResolvedValue(undefined),
		sendEmail: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		appOrigin: "https://readplace.com",
		cooldownMs: COOLDOWN_MS,
		now: () => NOW,
		logger: noopLogger,
		...overrides,
	};
	return { handler: initSendUserDigestHandler(deps), deps };
}

async function run(handler: ReturnType<typeof createHandler>["handler"], userId?: string) {
	return handler(command(userId), buildLambdaContext(), () => {});
}

describe("initSendUserDigestHandler", () => {
	describe("happy path", () => {
		it("sends one digest of every eligible article, stamps + drains each row, and publishes DigestEmailSent", async () => {
			const { handler, deps } = createHandler({
				listDigestItemsByUser: jest.fn().mockResolvedValue([
					digestItem(URL_A, CANON_A),
					digestItem(URL_B, CANON_B),
				]),
			});

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.claimReaderReadyEmailSlot).toHaveBeenCalledWith({ userId: USER_ID, now: NOW, cooldownMs: COOLDOWN_MS });
			expect(deps.sendEmail).toHaveBeenCalledTimes(1);
			const sent = (deps.sendEmail as jest.Mock).mock.calls[0][0];
			expect(sent.from).toBe("Fayner from Readplace <readplace@readplace.com>");
			expect(sent.to).toBe("reader@example.com");
			expect(sent.bcc).toBe("readplace+reader_ready@readplace.com");
			expect(sent.subject).toBe("Reader views are ready for articles you saved.");
			expect(sent.html).toContain("Alpha");
			expect(sent.html).toContain("Beta");

			expect(deps.markReaderReadyEmailSent).toHaveBeenCalledWith({ userId: USER_ID, url: URL_A, at: NOW });
			expect(deps.markReaderReadyEmailSent).toHaveBeenCalledWith({ userId: USER_ID, url: URL_B, at: NOW });
			expect(deps.deleteDigestItem).toHaveBeenCalledWith({ userId: USER_ID, url: CANON_A });
			expect(deps.deleteDigestItem).toHaveBeenCalledWith({ userId: USER_ID, url: CANON_B });
			expect(deps.publishEvent).toHaveBeenCalledWith(DigestEmailSentEvent, {
				userId: USER_ID,
				itemCount: 2,
				sentAt: NOW.toISOString(),
			});
		});

		it("includes an article with no stored content as a card with no body preview", async () => {
			const { handler, deps } = createHandler({
				readArticleContent: jest.fn().mockResolvedValue(undefined),
			});

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).toHaveBeenCalledTimes(1);
			const sent = (deps.sendEmail as jest.Mock).mock.calls[0][0];
			expect(sent.html).toContain("Alpha");
			expect(sent.html).not.toContain("Body paragraph.");
			expect(deps.markReaderReadyEmailSent).toHaveBeenCalledWith({ userId: USER_ID, url: URL_A, at: NOW });
		});
	});

	describe("user-level skips (nothing sent)", () => {
		it("skips and keeps rows when no contact exists", async () => {
			const { handler, deps } = createHandler({ findUserContactByUserId: jest.fn().mockResolvedValue(null) });

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.listDigestItemsByUser).not.toHaveBeenCalled();
			expect(deps.sendEmail).not.toHaveBeenCalled();
			expect(deps.deleteDigestItem).not.toHaveBeenCalled();
		});

		it("skips when the contact email is not verified", async () => {
			const { handler, deps } = createHandler({
				findUserContactByUserId: jest.fn().mockResolvedValue({ email: "reader@example.com", emailVerified: false }),
			});

			await run(handler);

			expect(deps.sendEmail).not.toHaveBeenCalled();
		});

		it("skips when the queue is empty", async () => {
			const { handler, deps } = createHandler({ listDigestItemsByUser: jest.fn().mockResolvedValue([]) });

			await run(handler);

			expect(deps.findUserArticleNotificationState).not.toHaveBeenCalled();
			expect(deps.sendEmail).not.toHaveBeenCalled();
			expect(deps.claimReaderReadyEmailSlot).not.toHaveBeenCalled();
		});
	});

	describe("per-item live-state gate (stale rows are dropped, not sent)", () => {
		const cases: Array<[string, UserArticleNotificationState | null]> = [
			["row-deleted", null],
			["already-read", { ...eligibleState(), status: "read" }],
			["already-emailed", { ...eligibleState(), emailSentAt: new Date("2026-06-01T12:05:00.000Z") }],
			["never-succeeded", { ...eligibleState(), succeededAt: undefined }],
			["re-saved-after-success", { ...eligibleState(), savedAt: new Date("2026-06-01T12:03:00.000Z") }],
			["under-min-generation", { ...eligibleState(), succeededAt: new Date("2026-06-01T12:00:30.000Z") }],
			["not-viewed-while-loading (no viewedAt)", { ...eligibleState(), viewedAt: undefined }],
			["present-until-ready (viewedAt >= succeededAt)", { ...eligibleState(), viewedAt: new Date("2026-06-01T12:03:00.000Z") }],
		];

		it.each(cases)("drops the row and sends nothing when %s", async (_label, state) => {
			const { handler, deps } = createHandler({
				findUserArticleNotificationState: jest.fn().mockResolvedValue(state),
			});

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).not.toHaveBeenCalled();
			expect(deps.claimReaderReadyEmailSlot).not.toHaveBeenCalled();
			expect(deps.deleteDigestItem).toHaveBeenCalledWith({ userId: USER_ID, url: CANON_A });
		});

		it("drops a row whose global article can no longer be resolved", async () => {
			const { handler, deps } = createHandler({ findArticleByUrl: jest.fn().mockResolvedValue(null) });

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).not.toHaveBeenCalled();
			expect(deps.deleteDigestItem).toHaveBeenCalledWith({ userId: USER_ID, url: CANON_A });
		});

		it("swallows a failed stale-row cleanup delete rather than redriving the record", async () => {
			const { handler, deps } = createHandler({
				findUserArticleNotificationState: jest.fn().mockResolvedValue(null),
				deleteDigestItem: jest.fn().mockRejectedValue(new Error("dynamo down")),
			});

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).not.toHaveBeenCalled();
		});
	});

	describe("cooldown + failure handling", () => {
		it("skips without deleting when the per-user cooldown slot cannot be claimed", async () => {
			const { handler, deps } = createHandler({ claimReaderReadyEmailSlot: jest.fn().mockResolvedValue(false) });

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).not.toHaveBeenCalled();
			expect(deps.markReaderReadyEmailSent).not.toHaveBeenCalled();
			expect(deps.deleteDigestItem).not.toHaveBeenCalled();
		});

		it("releases the slot and reports a batch failure when the send throws, so the redrive re-attempts", async () => {
			const { handler, deps } = createHandler({ sendEmail: jest.fn().mockRejectedValue(new Error("resend down")) });

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
			expect(deps.releaseReaderReadyEmailSlot).toHaveBeenCalledWith({ userId: USER_ID, claimedAt: NOW });
			expect(deps.markReaderReadyEmailSent).not.toHaveBeenCalled();
		});

		it("acks the record even if post-send bookkeeping fails (best effort)", async () => {
			const { handler, deps } = createHandler({
				markReaderReadyEmailSent: jest.fn().mockRejectedValue(new Error("mark down")),
			});

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).toHaveBeenCalledTimes(1);
			expect(deps.publishEvent).toHaveBeenCalledTimes(1);
		});

		it("acks the record even if publishing the DigestEmailSent event fails", async () => {
			const { handler, deps } = createHandler({
				publishEvent: jest.fn().mockRejectedValue(new Error("bus down")),
			});

			const result = await run(handler);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(deps.sendEmail).toHaveBeenCalledTimes(1);
		});
	});

	describe("envelope validation", () => {
		it("reports a batch item failure on an invalid command detail", async () => {
			const { handler, deps } = createHandler();

			const result = await handler(
				buildSqsEvent([{ messageId: "msg-1", body: JSON.stringify({ detail: {} }) }]),
				buildLambdaContext(),
				() => {},
			);

			expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
			expect(deps.findUserContactByUserId).not.toHaveBeenCalled();
		});
	});
});
