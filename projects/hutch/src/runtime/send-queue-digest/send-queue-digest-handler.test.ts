import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { ReaderReadyEmailSentEvent } from "@packages/hutch-infra-components";
import { DigestPageCursorSchema } from "@packages/provider-contracts/article-store";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { UserContact } from "@packages/provider-contracts/auth";
import { EmailRejectedError } from "@packages/provider-contracts/email";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { initInMemoryEmail } from "@packages/test-fixtures/providers/email";
import { initInMemoryReaderReadyState } from "@packages/test-fixtures/providers/reader-ready-state";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initQueueDigestMarkReadToken } from "../domain/email/queue-digest-mark-read-token";
import { initQueueDigestUnsubscribeToken } from "../domain/email/queue-digest-unsubscribe-token";
import { initEmitQueueDigestEvent, type QueueDigestLogEvent } from "../observability/queue-digest-events";
import { CONSENT_SEED_ARTICLE_URL } from "../web/oauth/consent-seed-save";
import { initSendQueueDigestHandler, type SendQueueDigestDeps } from "./send-queue-digest-handler";

const USER_ID = UserIdSchema.parse("user-1");
const MESSAGE_ID = "msg-1";
const SEND_INSTANT = new Date("2026-06-10T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const COOLDOWN_MS = 5.5 * HOUR_MS;
const REGULAR_DIGEST_MIN_GAP_MS = 47.5 * HOUR_MS;
const MIN_SAVE_AGE_MS = 24 * HOUR_MS;
const MAX_DIGEST_ITEMS = 10;
const MAX_CANDIDATES_READ = 50;
const UNSUBSCRIBE_SECRET = "queue-digest-test-secret";
const TRIAL_ENDS_TEN_DAYS_OUT = "2026-06-20T12:00:00.000Z";
const TRIAL_ENDS_EIGHTY_HOURS_OUT = "2026-06-13T20:00:00.000Z";
const VERIFIED_CONTACT: UserContact = {
	email: "reader@example.com",
	emailVerified: true,
	queueDigestOptOutAt: undefined,
};

const hoursBefore = (hours: number, instant: Date = SEND_INSTANT) => new Date(instant.getTime() - hours * HOUR_MS);
const DAY_OLD_SAVE = hoursBefore(30);

interface LogLine {
	level: "info" | "warn" | "error" | "debug";
	message: unknown;
	data: unknown;
}

function createSubject(options: { contact?: UserContact | null; overrides?: Partial<SendQueueDigestDeps> } = {}) {
	const clock = { now: SEND_INSTANT };
	const articleStore = initInMemoryArticleStore();
	const summaries = initInMemoryGeneratedSummary();
	const readerReady = initInMemoryReaderReadyState();
	const subscriptions = initInMemorySubscriptionProviders({ now: () => clock.now });
	const email = initInMemoryEmail();
	const token = initQueueDigestUnsubscribeToken(UNSUBSCRIBE_SECRET);
	const markReadToken = initQueueDigestMarkReadToken(UNSUBSCRIBE_SECRET);
	const published: Array<{ detailType: string; detail: unknown }> = [];
	const pageReads: Array<{ limit: number; candidates: number }> = [];
	const events: QueueDigestLogEvent[] = [];
	const logs: LogLine[] = [];
	const contact = options.contact === undefined ? VERIFIED_CONTACT : options.contact;
	const deps: SendQueueDigestDeps = {
		enrollStarter: async () => {},
		processStarter: async () => false,
		findUserContactByUserId: async () => contact,
		findSubscriptionByUserId: subscriptions.findByUserId,
		findReaderReadyEmailState: readerReady.findReaderReadyEmailState,
		findUnreadSavesForDigest: async (query) => {
			const page = await articleStore.findUnreadSavesForDigest(query);
			pageReads.push({ limit: query.limit, candidates: page.candidates.length });
			return page;
		},
		findGeneratedSummary: summaries.findGeneratedSummary,
		claimReaderReadyEmailSlot: readerReady.claimReaderReadyEmailSlot,
		releaseReaderReadyEmailSlot: readerReady.releaseReaderReadyEmailSlot,
		claimPayDigest: subscriptions.claimPayDigest,
		releasePayDigest: subscriptions.releasePayDigest,
		markReaderReadyEmailSent: articleStore.markReaderReadyEmailSent,
		sendEmail: email.sendEmail,
		publishEvent: async (event, detail) => {
			published.push({ detailType: event.detailType, detail });
		},
		emitQueueDigestEvent: initEmitQueueDigestEvent({
			logger: {
				info: (line) => { events.push(line); },
				warn: () => {},
				error: () => {},
				debug: () => {},
			},
			now: () => clock.now,
		}),
		signUnsubscribeToken: token.sign,
		signMarkReadToken: markReadToken.sign,
		appOrigin: "https://readplace.com",
		cooldownMs: COOLDOWN_MS,
		regularDigestMinGapMs: REGULAR_DIGEST_MIN_GAP_MS,
		minSaveAgeMs: MIN_SAVE_AGE_MS,
		maxDigestItems: MAX_DIGEST_ITEMS,
		maxCandidatesRead: MAX_CANDIDATES_READ,
		now: () => clock.now,
		logger: {
			info: (message, data) => { logs.push({ level: "info", message, data }); },
			warn: (message, data) => { logs.push({ level: "warn", message, data }); },
			error: (message, data) => { logs.push({ level: "error", message, data }); },
			debug: (message, data) => { logs.push({ level: "debug", message, data }); },
		},
		...options.overrides,
	};
	const handler = initSendQueueDigestHandler(deps);
	const runBody = (record: { messageId: string; body: string }) =>
		handler(buildSqsEvent([record]), buildLambdaContext(), () => {});
	const run = (messageId: string = MESSAGE_ID) =>
		runBody({ messageId, body: JSON.stringify({ detail: { userId: USER_ID } }) });
	return {
		run,
		runBody,
		clock,
		articleStore,
		summaries,
		readerReady,
		subscriptions,
		email,
		token,
		markReadToken,
		published,
		pageReads,
		events,
		logs,
	};
}

type Subject = ReturnType<typeof createSubject>;

async function saveArticle(subject: Subject, input: { url: string; title: string; savedAt: Date }) {
	await subject.articleStore.saveArticle({
		userId: USER_ID,
		url: input.url,
		metadata: { title: input.title, siteName: "example.com", excerpt: "", wordCount: 400 },
		estimatedReadTime: MinutesSchema.parse(2),
		provenance: { kind: "web" },
		savedAt: input.savedAt,
	});
}

async function saveReadyArticle(subject: Subject, input: { url: string; title: string; savedAt: Date }) {
	await saveArticle(subject, input);
	await subject.articleStore.setReaderAvailableAt({ url: input.url, at: input.savedAt });
	await subject.summaries.markSummaryReady({
		url: input.url,
		summary: `${input.title} summary.`,
		excerpt: `${input.title} teaser.`,
		topics: [],
	});
}

async function emailSentAtByUrl(subject: Subject): Promise<Map<string, Date | undefined>> {
	const page = await subject.articleStore.findUnreadSavesForDigest({
		userId: USER_ID,
		savedAtOrBefore: new Date("2030-01-01T00:00:00.000Z"),
		emailFilter: { kind: "any" },
		limit: 100,
		cursor: undefined,
	});
	return new Map(page.candidates.map((candidate) => [candidate.article.url, candidate.emailSentAt]));
}

function onlySentEmail(subject: Subject) {
	const sent = subject.email.getSentEmails();
	assert.equal(sent.length, 1, "expected exactly one email");
	const [message] = sent;
	assert(message);
	return message;
}

function cardTitlesOf(text: string | undefined): string[] {
	assert(text, "the digest carries a text/plain part");
	return text
		.split("\n\n")
		.map((block) => block.split("\n"))
		.filter(([, url]) => url !== undefined && new URL(url).searchParams.get("utm_content") === "article")
		.map(([title]) => title ?? "");
}

function linkUrlsOf(html: string): URL[] {
	return [...new JSDOM(html).window.document.querySelectorAll("a[href]")].map(
		(anchor) => new URL(anchor.getAttribute("href") ?? ""),
	);
}

function campaignsOf(html: string): string[] {
	return [...new Set(linkUrlsOf(html).map((url) => url.searchParams.get("utm_campaign")))].map(String);
}

function skipReasonsOf(subject: Subject): unknown[] {
	return subject.logs
		.filter((line) => line.message === "[SendQueueDigest] skipped")
		.map((line) => line.data);
}

describe("initSendQueueDigestHandler", () => {
	it("sends a due pay digest before offering the starter", async () => {
		let starters = 0;
		const subject = createSubject({
			overrides: {
				processStarter: async () => {
					starters++;
					return true;
				},
			},
		});
		await subject.subscriptions.upsertTrialing({
			userId: USER_ID,
			trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT,
		});
		await saveReadyArticle(subject, {
			url: "https://example.com/payment",
			title: "Payment pick",
			savedAt: DAY_OLD_SAVE,
		});
		await subject.run();
		expect(starters).toBe(0);
		expect(subject.email.getSentEmails()).toHaveLength(1);
		await subject.run("starter-opportunity");
		expect(starters).toBe(1);
		expect(subject.email.getSentEmails()).toHaveLength(1);
	});
	it.each([
		{ starter: "takes this opportunity", handled: true, campaigns: [] },
		{ starter: "has nothing to send", handled: false, campaigns: [["regular"]] },
	])("sends the regular digest only when the starter $starter", async ({ handled, campaigns }) => {
		const subject = createSubject({ overrides: { processStarter: async () => handled } });
		await subject.subscriptions.upsertActive({ userId: USER_ID, subscriptionId: "sub", customerId: "customer" });
		await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

		await subject.run();

		expect(subject.email.getSentEmails().map((message) => campaignsOf(message.html))).toEqual(campaigns);
	});
	it.each<{ record: string; arrange: (subject: Subject) => Promise<unknown>; calls: Array<[string, string]> }>([
		{
			record: "an ordinary digest record",
			arrange: (subject) =>
				subject.subscriptions.upsertActive({ userId: USER_ID, subscriptionId: "sub", customerId: "customer" }),
			calls: [
				["enrollStarter", USER_ID],
				["processStarter", USER_ID],
			],
		},
		{
			record: "a record due a pay digest",
			arrange: (subject) =>
				subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT }),
			calls: [["enrollStarter", USER_ID]],
		},
		{
			record: "this message's own redrive",
			arrange: async (subject) => {
				await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
				await subject.readerReady.claimReaderReadyEmailSlot({
					userId: USER_ID,
					now: new Date(SEND_INSTANT.getTime() - 5 * 60 * 1000),
					cooldownMs: COOLDOWN_MS,
					messageId: MESSAGE_ID,
					urls: ["https://example.com/alpha"],
				});
			},
			calls: [],
		},
	])("enrolls the reader before offering the starter on $record", async ({ arrange, calls }) => {
		const starterCalls: Array<[string, string]> = [];
		const subject = createSubject({
			overrides: {
				enrollStarter: async (userId) => {
					starterCalls.push(["enrollStarter", userId]);
				},
				processStarter: async (userId) => {
					starterCalls.push(["processStarter", userId]);
					return false;
				},
			},
		});
		await arrange(subject);
		await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

		await subject.run();

		expect(starterCalls).toEqual(calls);
	});
	it("still sends a due pay digest when the starter insertion fails", async () => {
		const failure = new Error("transaction cancelled");
		const subject = createSubject({
			overrides: {
				enrollStarter: async () => {
					throw failure;
				},
			},
		});
		await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT });
		await saveReadyArticle(subject, {
			url: "https://example.com/payment",
			title: "Payment pick",
			savedAt: DAY_OLD_SAVE,
		});

		const result = await subject.run();

		expect(result).toEqual({ batchItemFailures: [] });
		expect(campaignsOf(onlySentEmail(subject).html)).toEqual(["pay"]);
		expect(subject.logs.filter((line) => line.level === "error")).toEqual([
			{
				level: "error",
				message: "[SendQueueDigest] starter enrollment failed",
				data: { userId: USER_ID, error: failure },
			},
		]);
	});
	it.each([
		"regular",
		"payment",
	])("excludes HN suggestions from %s while keeping ordinary Gmail articles", async (kind) => {
		const subject = createSubject();
		if (kind === "payment")
			await subject.subscriptions.upsertTrialing({
				userId: USER_ID,
				trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT,
			});
		else
			await subject.subscriptions.upsertActive({
				userId: USER_ID,
				subscriptionId: "sub",
				customerId: "customer",
			});
		for (const [slug, provenance] of [
			[
				"hn",
				{
					kind: "hn-suggestion",
					campaignId: "hn-starter-v1",
					snapshotAt: SEND_INSTANT.toISOString(),
					hnItemId: 1,
					rank: 1,
				},
			],
			["seed", { kind: "founder-seed" }],
			["gmail", { kind: "email", senderEmail: "newsletter@sender.com" }],
		] satisfies Array<[string, import("@packages/domain/article").SaveProvenance]>) {
			const url = `https://example.com/${slug}`;
			await subject.articleStore.saveArticle({
				userId: USER_ID,
				url,
				provenance,
				metadata: { title: slug, siteName: "Site", excerpt: "", wordCount: 200 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: DAY_OLD_SAVE,
			});
			await subject.articleStore.setReaderAvailableAt({ url, at: DAY_OLD_SAVE });
			await subject.summaries.markSummaryReady({ url, summary: "Summary", topics: [] });
		}
		await subject.run();
		expect(cardTitlesOf(onlySentEmail(subject).text)).toEqual(["gmail"]);
	});
	describe("regular digest", () => {
		it("emails the reader's own unread ready saves at least the minimum save age old, stamps them at the send instant, and records one send", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: hoursBefore(24) });
			await saveReadyArticle(subject, { url: "https://example.com/beta", title: "Beta", savedAt: hoursBefore(48) });
			await saveReadyArticle(subject, {
				url: "https://example.com/too-fresh",
				title: "Too fresh",
				savedAt: new Date(hoursBefore(24).getTime() + 1),
			});

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			const sent = onlySentEmail(subject);
			expect(sent.from).toBe("Readplace <readplace@readplace.com>");
			expect(sent.to).toBe("reader@example.com");
			expect(sent.replyTo).toBe("fayner@readplace.com");
			expect(sent.subject).toBe("Waiting in your readlist");
			expect(cardTitlesOf(sent.text)).toEqual(["Alpha", "Beta"]);
			expect(sent.html).toContain("Alpha teaser.");
			expect(campaignsOf(sent.html)).toEqual(["regular"]);
			expect(new Set(linkUrlsOf(sent.html).map((url) => url.searchParams.get("utm_term")))).toEqual(
				new Set([MESSAGE_ID]),
			);
			expect(sent.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
			const oneClick = new URL((sent.headers?.["List-Unsubscribe"] ?? "").replace(/^<|>$/g, ""));
			expect(subject.token.verify(oneClick.searchParams.get("t") ?? "")).toBe(USER_ID);
			const markAllRead = linkUrlsOf(sent.html).find((url) => url.pathname === "/email/queue-digest/mark-read");
			assert(markAllRead, "a regular digest carries the mark-all-read link");
			const marked = subject.markReadToken.verify(markAllRead.searchParams.get("t") ?? "");
			assert(marked, "the mark-all-read link carries a token signed for this digest");
			expect(marked.userId).toBe(USER_ID);
			expect(marked.articleIds.map((id) => id.value)).toEqual([
				ReaderArticleHashId.from("https://example.com/alpha").value,
				ReaderArticleHashId.from("https://example.com/beta").value,
			]);

			expect(await subject.readerReady.findReaderReadyEmailState(USER_ID)).toEqual({
				lastSentAt: SEND_INSTANT,
				lastMessageId: MESSAGE_ID,
			});
			expect(
				await subject.readerReady.claimReaderReadyEmailSlot({
					userId: USER_ID,
					now: SEND_INSTANT,
					cooldownMs: COOLDOWN_MS,
					messageId: MESSAGE_ID,
					urls: [],
				}),
			).toEqual({
				claimed: true,
				redelivery: true,
				claimedAt: SEND_INSTANT,
				urls: ["https://example.com/alpha", "https://example.com/beta"],
			});
			const stamps = await emailSentAtByUrl(subject);
			expect(stamps.get("https://example.com/alpha")).toEqual(SEND_INSTANT);
			expect(stamps.get("https://example.com/beta")).toEqual(SEND_INSTANT);
			expect(stamps.get("https://example.com/too-fresh")).toBeUndefined();
			expect(subject.published).toEqual([
				{
					detailType: ReaderReadyEmailSentEvent.detailType,
					detail: {
						userId: USER_ID,
						urls: ["https://example.com/alpha", "https://example.com/beta"],
						sentAt: SEND_INSTANT.toISOString(),
					},
				},
			]);
			expect(subject.events).toEqual([
				{
					stream: "analytics",
					event: "queue_digest_sent",
					timestamp: SEND_INSTANT.toISOString(),
					user_id: USER_ID,
					send_id: MESSAGE_ID,
					kind: "regular",
					item_count: 2,
					previously_emailed_count: 0,
					tier: "trial",
					trial_day: 5,
				},
			]);
		});

		it("sends the digest to the reader alone, so no other mailbox holds their one-click unsubscribe", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			await subject.run();

			const sent = onlySentEmail(subject);
			expect(sent.headers).toHaveProperty("List-Unsubscribe");
			expect(sent).not.toHaveProperty("bcc");
		});

		it("records a paying member's digest with no trial day", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertActive({ userId: USER_ID, subscriptionId: "sub_1", customerId: "cus_1" });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			await subject.run();

			expect(campaignsOf(onlySentEmail(subject).html)).toEqual(["regular"]);
			expect(subject.events).toEqual([
				expect.objectContaining({ event: "queue_digest_sent", kind: "regular", tier: "paid", trial_day: null }),
			]);
		});

		it("gives a trialist who pressed cancel a regular digest even inside the pay window", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT });
			await subject.subscriptions.markPendingCancellation({
				userId: USER_ID,
				cancellationEffectiveAt: TRIAL_ENDS_EIGHTY_HOURS_OUT,
			});
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			await subject.run();

			expect(campaignsOf(onlySentEmail(subject).html)).toEqual(["regular"]);
			expect((await subject.subscriptions.findByUserId(USER_ID))?.payDigestEmailSentAt).toBeUndefined();
			expect(subject.events).toEqual([
				expect.objectContaining({ event: "queue_digest_sent", kind: "regular", tier: "trial", trial_day: 11 }),
			]);
		});

		it("records no trial day for a trialist whose trial was extended past fourteen days", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: "2026-07-09T12:00:00.000Z" });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			await subject.run();

			expect(campaignsOf(onlySentEmail(subject).html)).toEqual(["regular"]);
			expect(subject.events).toEqual([
				expect.objectContaining({ event: "queue_digest_sent", kind: "regular", tier: "trial", trial_day: null }),
			]);
		});

		it.each<[string, number | null, string]>([
			["exactly fourteen days", 1, "2026-06-24T12:00:00.000Z"],
			["fourteen days and a millisecond", null, "2026-06-24T12:00:00.001Z"],
		])("records a trialist with %s left as trial day %p", async (_left, trialDay, trialEndsAt) => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			await subject.run();

			expect(subject.events).toEqual([
				expect.objectContaining({ event: "queue_digest_sent", kind: "regular", tier: "trial", trial_day: trialDay }),
			]);
		});
	});

	describe("item selection", () => {
		it("lists the ten newest ready saves, newest first, and leaves older ones for a later digest", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			for (let index = 1; index <= 12; index++) {
				await saveReadyArticle(subject, {
					url: `https://example.com/${index}`,
					title: `Article ${index}`,
					savedAt: hoursBefore(100 - index),
				});
			}

			await subject.run();

			expect(cardTitlesOf(onlySentEmail(subject).text)).toEqual([
				"Article 12",
				"Article 11",
				"Article 10",
				"Article 9",
				"Article 8",
				"Article 7",
				"Article 6",
				"Article 5",
				"Article 4",
				"Article 3",
			]);
			const stamps = await emailSentAtByUrl(subject);
			expect(stamps.get("https://example.com/2")).toBeUndefined();
			expect(stamps.get("https://example.com/1")).toBeUndefined();
			expect(stamps.get("https://example.com/3")).toEqual(SEND_INSTANT);
		});

		it("leaves out the welcome article seeded at signup and still fills ten cards from one page", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			for (let index = 1; index <= 10; index++) {
				await saveReadyArticle(subject, {
					url: `https://example.com/${index}`,
					title: `Article ${index}`,
					savedAt: hoursBefore(100 - index),
				});
			}
			await saveReadyArticle(subject, { url: CONSENT_SEED_ARTICLE_URL, title: "Welcome", savedAt: hoursBefore(30) });

			await subject.run();

			const titles = cardTitlesOf(onlySentEmail(subject).text);
			expect(titles).toHaveLength(10);
			expect(titles[0]).toBe("Article 10");
			expect(titles[9]).toBe("Article 1");
			expect(subject.pageReads).toEqual([{ limit: 11, candidates: 11 }]);
			expect((await emailSentAtByUrl(subject)).get(CONSENT_SEED_ARTICLE_URL)).toBeUndefined();
		});

		it("keeps paging past a page with nothing ready yet", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveReadyArticle(subject, { url: "https://example.com/ready", title: "Ready", savedAt: hoursBefore(80) });
			for (let index = 1; index <= 11; index++) {
				await saveArticle(subject, {
					url: `https://example.com/loading-${index}`,
					title: `Loading ${index}`,
					savedAt: hoursBefore(40 - index),
				});
			}

			await subject.run();

			expect(cardTitlesOf(onlySentEmail(subject).text)).toEqual(["Ready"]);
		});

		it("stops reading after fifty candidates when none of them is ready", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			for (let index = 1; index <= 60; index++) {
				await saveArticle(subject, {
					url: `https://example.com/loading-${index}`,
					title: `Loading ${index}`,
					savedAt: hoursBefore(100 - index),
				});
			}

			await subject.run();

			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.pageReads.map((read) => read.limit)).toEqual([11, 11, 11, 11, 6]);
			expect(subject.pageReads.reduce((sum, read) => sum + read.candidates, 0)).toBe(MAX_CANDIDATES_READ);
			expect(skipReasonsOf(subject)).toEqual([{ userId: USER_ID, reason: "no-eligible-items" }]);
		});
	});

	describe("read budget", () => {
		it("stops after the fifty-row read budget even when the index keeps handing back pages the filter emptied", async () => {
			const pageLimits: number[] = [];
			const subject = createSubject({
				overrides: {
					findUnreadSavesForDigest: async ({ limit }) => {
						pageLimits.push(limit);
						assert(pageLimits.length <= 20, "the handler must stop paging on its own");
						return { candidates: [], nextCursor: DigestPageCursorSchema.parse(`page-${pageLimits.length}`) };
					},
				},
			});
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(pageLimits).toEqual([11, 11, 11, 11, 6]);
			expect(skipReasonsOf(subject)).toEqual([{ userId: USER_ID, reason: "no-eligible-items" }]);
		});
	});

	describe("reader-ready gate", () => {
		const NOT_READY_URL = "https://example.com/not-ready";
		const failedSummary: GeneratedSummary = { status: "failed", reason: "model refused" };

		const notReadyCases: Array<[string, (subject: Subject) => Promise<void>, Partial<SendQueueDigestDeps>]> = [
			[
				"its reader view never loaded",
				async (subject) => {
					await subject.summaries.markSummaryReady({ url: NOT_READY_URL, summary: "Summarised.", topics: [] });
				},
				{},
			],
			[
				"its content was purged",
				async (subject) => {
					await subject.articleStore.setReaderAvailableAt({ url: NOT_READY_URL, at: hoursBefore(40) });
					await subject.summaries.markSummaryReady({ url: NOT_READY_URL, summary: "Gone.", topics: [] });
					await subject.articleStore.setPurgedAt({ url: NOT_READY_URL, at: hoursBefore(2) });
				},
				{},
			],
			[
				"its summary has no row yet",
				async (subject) => {
					await subject.articleStore.setReaderAvailableAt({ url: NOT_READY_URL, at: hoursBefore(40) });
				},
				{},
			],
			[
				"its summary is still pending",
				async (subject) => {
					await subject.articleStore.setReaderAvailableAt({ url: NOT_READY_URL, at: hoursBefore(40) });
					await subject.summaries.markSummaryPending({ url: NOT_READY_URL });
				},
				{},
			],
			[
				"its summary was skipped",
				async (subject) => {
					await subject.articleStore.setReaderAvailableAt({ url: NOT_READY_URL, at: hoursBefore(40) });
					await subject.summaries.markSummarySkipped({ url: NOT_READY_URL, reason: "too short" });
				},
				{},
			],
			[
				"its summary failed",
				async (subject) => {
					await subject.articleStore.setReaderAvailableAt({ url: NOT_READY_URL, at: hoursBefore(40) });
				},
				{ findGeneratedSummary: async () => failedSummary },
			],
		];

		it.each(notReadyCases)("neither lists nor stamps a save when %s", async (_label, arrange, overrides) => {
			const subject = createSubject({ overrides });
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveArticle(subject, { url: NOT_READY_URL, title: "Not ready", savedAt: hoursBefore(40) });
			await arrange(subject);

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(subject.email.getSentEmails()).toEqual([]);
			expect(skipReasonsOf(subject)).toEqual([{ userId: USER_ID, reason: "no-eligible-items" }]);
			expect((await emailSentAtByUrl(subject)).get(NOT_READY_URL)).toBeUndefined();
			expect(await subject.readerReady.findReaderReadyEmailState(USER_ID)).toEqual({
				lastSentAt: undefined,
				lastMessageId: undefined,
			});
		});

		it("lists a save that was still loading at one digest in the next digest once it is ready", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveReadyArticle(subject, { url: "https://example.com/ready", title: "Ready", savedAt: hoursBefore(50) });
			await saveArticle(subject, { url: NOT_READY_URL, title: "Loading", savedAt: hoursBefore(40) });
			await subject.run();
			await subject.articleStore.setReaderAvailableAt({ url: NOT_READY_URL, at: hoursBefore(1) });
			await subject.summaries.markSummaryReady({ url: NOT_READY_URL, summary: "Loaded.", excerpt: "Loaded teaser.", topics: [] });
			const nextTick = new Date(SEND_INSTANT.getTime() + 48 * HOUR_MS);
			subject.clock.now = nextTick;

			await subject.run("msg-2");

			const [first, second] = subject.email.getSentEmails();
			expect(cardTitlesOf(first?.text)).toEqual(["Ready"]);
			expect(cardTitlesOf(second?.text)).toEqual(["Loading"]);
			expect((await emailSentAtByUrl(subject)).get(NOT_READY_URL)).toEqual(nextTick);
		});
	});

	describe("streamed skips", () => {
		it("skips a reader with no contact row as unverified", async () => {
			const subject = createSubject({ contact: null });
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });

			await subject.run();

			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([
				{
					stream: "analytics",
					event: "queue_digest_skipped",
					timestamp: SEND_INSTANT.toISOString(),
					user_id: USER_ID,
					tier: "trial",
					reason: "no-verified-email",
				},
			]);
		});

		it("skips a reader whose email is not verified", async () => {
			const subject = createSubject({ contact: { ...VERIFIED_CONTACT, emailVerified: false } });
			await subject.subscriptions.upsertActive({ userId: USER_ID, subscriptionId: "sub_1", customerId: "cus_1" });

			await subject.run();

			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([
				expect.objectContaining({ event: "queue_digest_skipped", tier: "paid", reason: "no-verified-email" }),
			]);
		});

		it("skips a reader who unsubscribed from this digest", async () => {
			const subject = createSubject({
				contact: { ...VERIFIED_CONTACT, queueDigestOptOutAt: "2026-06-01T00:00:00.000Z" },
			});
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			await subject.run();

			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([
				expect.objectContaining({ event: "queue_digest_skipped", tier: "trial", reason: "unsubscribed" }),
			]);
		});

		it("skips a reader with no unread save old enough to list", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveReadyArticle(subject, { url: "https://example.com/fresh", title: "Fresh", savedAt: hoursBefore(2) });

			await subject.run();

			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([
				expect.objectContaining({ event: "queue_digest_skipped", tier: "trial", reason: "no-eligible-items" }),
			]);
			expect(await subject.readerReady.findReaderReadyEmailState(USER_ID)).toEqual({
				lastSentAt: undefined,
				lastMessageId: undefined,
			});
		});
	});

	describe("readers without trial or paid access", () => {
		const cases: Array<[string, (subject: Subject) => Promise<void>]> = [
			["a founding member with no subscription row", async () => {}],
			[
				"a trialist whose trial has ended",
				async (subject) => {
					await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: "2026-06-10T11:59:59.999Z" });
				},
			],
			[
				"a cancelled subscriber",
				async (subject) => {
					await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
					await subject.subscriptions.markCancelledByUserId({ userId: USER_ID });
				},
			],
			[
				"a cancellation that has taken effect",
				async (subject) => {
					await subject.subscriptions.upsertActive({ userId: USER_ID, subscriptionId: "sub_1", customerId: "cus_1" });
					await subject.subscriptions.markPendingCancellation({
						userId: USER_ID,
						cancellationEffectiveAt: "2026-06-10T12:00:00.000Z",
					});
				},
			],
		];

		it.each(cases)("sends nothing and streams nothing for %s", async (_label, arrange) => {
			const subject = createSubject();
			await arrange(subject);
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([]);
			expect(skipReasonsOf(subject)).toEqual([{ userId: USER_ID, reason: "not-eligible-tier" }]);
		});
	});

	describe("cadence", () => {
		async function readyTrialist(subject: Subject) {
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: hoursBefore(80) });
		}

		it("waits when another message sent a digest just inside the minimum gap, without claiming", async () => {
			const subject = createSubject();
			await readyTrialist(subject);
			await subject.readerReady.claimReaderReadyEmailSlot({
				userId: USER_ID,
				now: hoursBefore(47),
				cooldownMs: COOLDOWN_MS,
				messageId: "earlier-msg",
				urls: ["https://example.com/earlier"],
			});

			await subject.run();

			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([]);
			expect(skipReasonsOf(subject)).toEqual([{ userId: USER_ID, reason: "cadence" }]);
			expect(await subject.readerReady.findReaderReadyEmailState(USER_ID)).toEqual({
				lastSentAt: hoursBefore(47),
				lastMessageId: "earlier-msg",
			});
		});

		it("sends once the minimum gap has passed since the last digest", async () => {
			const subject = createSubject();
			await readyTrialist(subject);
			await subject.readerReady.claimReaderReadyEmailSlot({
				userId: USER_ID,
				now: hoursBefore(47.5),
				cooldownMs: COOLDOWN_MS,
				messageId: "earlier-msg",
				urls: ["https://example.com/earlier"],
			});

			await subject.run();

			expect(cardTitlesOf(onlySentEmail(subject).text)).toEqual(["Alpha"]);
		});

		it("waits when the pay digest went out 10 hours ago", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT });
			await subject.subscriptions.claimPayDigest({
				userId: USER_ID,
				trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT,
				messageId: "pay-msg",
				now: hoursBefore(10),
				urls: ["https://example.com/earlier"],
			});
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: hoursBefore(80) });

			await subject.run();

			expect(subject.email.getSentEmails()).toEqual([]);
			expect(skipReasonsOf(subject)).toEqual([{ userId: USER_ID, reason: "cadence" }]);
		});

		it("lets this message's own redrive through, finishing the stamps at the original instant without sending again", async () => {
			const subject = createSubject();
			const claimedAt = new Date(SEND_INSTANT.getTime() - 5 * 60 * 1000);
			await readyTrialist(subject);
			await saveReadyArticle(subject, { url: "https://example.com/beta", title: "Beta", savedAt: hoursBefore(70) });
			await subject.readerReady.claimReaderReadyEmailSlot({
				userId: USER_ID,
				now: claimedAt,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE_ID,
				urls: ["https://example.com/beta", "https://example.com/alpha"],
			});
			await subject.articleStore.markReaderReadyEmailSent({ userId: USER_ID, url: "https://example.com/beta", at: claimedAt });

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([]);
			const stamps = await emailSentAtByUrl(subject);
			expect(stamps.get("https://example.com/alpha")).toEqual(claimedAt);
			expect(stamps.get("https://example.com/beta")).toEqual(claimedAt);
			expect(subject.published).toEqual([
				{
					detailType: ReaderReadyEmailSentEvent.detailType,
					detail: {
						userId: USER_ID,
						urls: ["https://example.com/beta", "https://example.com/alpha"],
						sentAt: claimedAt.toISOString(),
					},
				},
			]);
		});

		it("finishes this message's own redrive even when the first receive already stamped every save it listed", async () => {
			const subject = createSubject();
			const claimedAt = new Date(SEND_INSTANT.getTime() - 5 * 60 * 1000);
			await readyTrialist(subject);
			await subject.readerReady.claimReaderReadyEmailSlot({
				userId: USER_ID,
				now: claimedAt,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE_ID,
				urls: ["https://example.com/alpha"],
			});
			await subject.articleStore.markReaderReadyEmailSent({ userId: USER_ID, url: "https://example.com/alpha", at: claimedAt });

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([]);
			expect(skipReasonsOf(subject)).toEqual([]);
			expect(subject.published).toEqual([
				expect.objectContaining({
					detail: { userId: USER_ID, urls: ["https://example.com/alpha"], sentAt: claimedAt.toISOString() },
				}),
			]);
			expect(subject.logs).toContainEqual({
				level: "info",
				message: "[SendQueueDigest] sent digest",
				data: { userId: USER_ID, kind: "regular", itemCount: 1, redelivery: true },
			});
		});

		it("stamps only the saves the first receive emailed, even when another save turned ready since", async () => {
			const subject = createSubject();
			const claimedAt = new Date(SEND_INSTANT.getTime() - 5 * 60 * 1000);
			await readyTrialist(subject);
			await saveReadyArticle(subject, {
				url: "https://example.com/ready-since",
				title: "Ready since",
				savedAt: hoursBefore(40),
			});
			await subject.readerReady.claimReaderReadyEmailSlot({
				userId: USER_ID,
				now: claimedAt,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE_ID,
				urls: ["https://example.com/alpha"],
			});

			await subject.run();

			const stamps = await emailSentAtByUrl(subject);
			expect(stamps.get("https://example.com/alpha")).toEqual(claimedAt);
			expect(stamps.get("https://example.com/ready-since")).toBeUndefined();
			expect(subject.published).toEqual([
				expect.objectContaining({
					detail: { userId: USER_ID, urls: ["https://example.com/alpha"], sentAt: claimedAt.toISOString() },
				}),
			]);
		});

		it("leaves a concurrent flush's claim alone and warns", async () => {
			const subject = createSubject({
				overrides: { claimReaderReadyEmailSlot: async () => ({ claimed: false }) },
			});
			await readyTrialist(subject);

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.logs).toContainEqual({
				level: "warn",
				message: "[SendQueueDigest] rate-limited",
				data: { userId: USER_ID, messageId: MESSAGE_ID },
			});
			expect((await emailSentAtByUrl(subject)).get("https://example.com/alpha")).toBeUndefined();
		});
	});

	describe("send failures", () => {
		async function readyTrialist(subject: Subject) {
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });
		}

		it("releases the claim when the provider rejects the email, so the redrive sends it", async () => {
			const subject = createSubject({
				overrides: {
					sendEmail: async () => {
						throw new EmailRejectedError({ statusCode: 422, message: "invalid to" });
					},
				},
			});
			await readyTrialist(subject);

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: MESSAGE_ID }] });
			expect(await subject.readerReady.findReaderReadyEmailState(USER_ID)).toEqual({
				lastSentAt: undefined,
				lastMessageId: undefined,
			});
			expect((await emailSentAtByUrl(subject)).get("https://example.com/alpha")).toBeUndefined();
			expect(subject.events).toEqual([]);
		});

		it("keeps the claim when the send fails ambiguously, so the redrive cannot send a second copy", async () => {
			const subject = createSubject({
				overrides: {
					sendEmail: async () => {
						throw new Error("socket hang up");
					},
				},
			});
			await readyTrialist(subject);

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: MESSAGE_ID }] });
			expect(await subject.readerReady.findReaderReadyEmailState(USER_ID)).toEqual({
				lastSentAt: SEND_INSTANT,
				lastMessageId: MESSAGE_ID,
			});
			expect((await emailSentAtByUrl(subject)).get("https://example.com/alpha")).toBeUndefined();
		});
	});

	describe("pay digest", () => {
		async function payWindowTrialist(subject: Subject) {
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT });
		}

		it("resurfaces every unread ready save, emailed before or saved within the day, with the keep button, and claims the once-per-trial marker", async () => {
			const subject = createSubject();
			await payWindowTrialist(subject);
			const earlierDigest = hoursBefore(60);
			await saveReadyArticle(subject, { url: "https://example.com/emailed", title: "Emailed", savedAt: hoursBefore(90) });
			await subject.articleStore.markReaderReadyEmailSent({
				userId: USER_ID,
				url: "https://example.com/emailed",
				at: earlierDigest,
			});
			await saveReadyArticle(subject, { url: "https://example.com/older", title: "Older", savedAt: hoursBefore(30) });
			await saveReadyArticle(subject, { url: "https://example.com/fresh", title: "Fresh", savedAt: hoursBefore(1) });

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			const sent = onlySentEmail(subject);
			expect(cardTitlesOf(sent.text)).toEqual(["Fresh", "Older", "Emailed"]);
			expect(campaignsOf(sent.html)).toEqual(["pay"]);
			expect(linkUrlsOf(sent.html).filter((url) => url.pathname === "/account/plans")).toHaveLength(1);
			const row = await subject.subscriptions.findByUserId(USER_ID);
			expect(row?.payDigestEmailSentAt).toBe(SEND_INSTANT.toISOString());
			expect(row?.payDigestMessageId).toBe(MESSAGE_ID);
			expect(
				await subject.subscriptions.claimPayDigest({
					userId: USER_ID,
					trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT,
					messageId: MESSAGE_ID,
					now: SEND_INSTANT,
					urls: [],
				}),
			).toEqual({
				claimed: true,
				redelivery: true,
				claimedAt: SEND_INSTANT,
				urls: ["https://example.com/fresh", "https://example.com/older", "https://example.com/emailed"],
			});
			expect(await subject.readerReady.findReaderReadyEmailState(USER_ID)).toEqual({
				lastSentAt: undefined,
				lastMessageId: undefined,
			});
			const stamps = await emailSentAtByUrl(subject);
			expect(stamps.get("https://example.com/emailed")).toEqual(earlierDigest);
			expect(stamps.get("https://example.com/older")).toEqual(SEND_INSTANT);
			expect(stamps.get("https://example.com/fresh")).toEqual(SEND_INSTANT);
			expect(subject.published).toEqual([
				expect.objectContaining({
					detail: {
						userId: USER_ID,
						urls: ["https://example.com/fresh", "https://example.com/older", "https://example.com/emailed"],
						sentAt: SEND_INSTANT.toISOString(),
					},
				}),
			]);
			expect(subject.events).toEqual([
				{
					stream: "analytics",
					event: "queue_digest_sent",
					timestamp: SEND_INSTANT.toISOString(),
					user_id: USER_ID,
					send_id: MESSAGE_ID,
					kind: "pay",
					hours_to_trial_end: 80,
					item_count: 3,
					previously_emailed_count: 1,
					tier: "trial",
					trial_day: 11,
				},
			]);
		});

		it("goes out even when a regular digest went out six hours earlier", async () => {
			const subject = createSubject();
			await payWindowTrialist(subject);
			await subject.readerReady.claimReaderReadyEmailSlot({
				userId: USER_ID,
				now: hoursBefore(6),
				cooldownMs: COOLDOWN_MS,
				messageId: "regular-msg",
				urls: ["https://example.com/earlier"],
			});
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			await subject.run();

			expect(campaignsOf(onlySentEmail(subject).html)).toEqual(["pay"]);
			expect(await subject.readerReady.findReaderReadyEmailState(USER_ID)).toEqual({
				lastSentAt: hoursBefore(6),
				lastMessageId: "regular-msg",
			});
		});

		it("finishes this message's own claimed pay digest by stamping what it listed at the claimed instant, without sending again", async () => {
			const subject = createSubject();
			const claimedAt = new Date(SEND_INSTANT.getTime() - 5 * 60 * 1000);
			await payWindowTrialist(subject);
			await subject.subscriptions.claimPayDigest({
				userId: USER_ID,
				trialEndsAt: TRIAL_ENDS_EIGHTY_HOURS_OUT,
				messageId: MESSAGE_ID,
				now: claimedAt,
				urls: ["https://example.com/alpha"],
			});
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });
			await saveReadyArticle(subject, { url: "https://example.com/ready-since", title: "Ready since", savedAt: hoursBefore(1) });

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([]);
			expect((await emailSentAtByUrl(subject)).get("https://example.com/alpha")).toEqual(claimedAt);
			expect((await emailSentAtByUrl(subject)).get("https://example.com/ready-since")).toBeUndefined();
			expect(subject.published).toEqual([
				expect.objectContaining({
					detail: { userId: USER_ID, urls: ["https://example.com/alpha"], sentAt: claimedAt.toISOString() },
				}),
			]);
		});

		it("sends nothing when another message holds the pay claim, and warns", async () => {
			const subject = createSubject({ overrides: { claimPayDigest: async () => ({ claimed: false }) } });
			await payWindowTrialist(subject);
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.logs).toContainEqual({
				level: "warn",
				message: "[SendQueueDigest] pay-already-claimed",
				data: { userId: USER_ID, messageId: MESSAGE_ID },
			});
		});

		it("releases the pay claim when the provider rejects the email", async () => {
			const subject = createSubject({
				overrides: {
					sendEmail: async () => {
						throw new EmailRejectedError({ statusCode: 422, message: "invalid to" });
					},
				},
			});
			await payWindowTrialist(subject);
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: MESSAGE_ID }] });
			const row = await subject.subscriptions.findByUserId(USER_ID);
			expect(row?.payDigestEmailSentAt).toBeUndefined();
			expect(row?.payDigestMessageId).toBeUndefined();
		});

		it("keeps the pay claim when the send fails ambiguously", async () => {
			const subject = createSubject({
				overrides: {
					sendEmail: async () => {
						throw new Error("socket hang up");
					},
				},
			});
			await payWindowTrialist(subject);
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: MESSAGE_ID }] });
			expect((await subject.subscriptions.findByUserId(USER_ID))?.payDigestMessageId).toBe(MESSAGE_ID);
		});

		it("skips without claiming when no unread save is ready, so the day-12 reminder still goes out", async () => {
			const subject = createSubject();
			await payWindowTrialist(subject);
			await saveArticle(subject, { url: "https://example.com/loading", title: "Loading", savedAt: DAY_OLD_SAVE });

			await subject.run();

			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([
				expect.objectContaining({ event: "queue_digest_skipped", tier: "trial", reason: "pay-no-ready-saves" }),
			]);
			expect((await subject.subscriptions.findByUserId(USER_ID))?.payDigestEmailSentAt).toBeUndefined();
		});
	});

	describe("a redrive of this message's own send, after the reader's state moved on", () => {
		const claimedAt = new Date(SEND_INSTANT.getTime() - 2 * 60 * 1000);
		const minutesAfter = (hours: number, minutes: number) =>
			new Date(SEND_INSTANT.getTime() + hours * HOUR_MS + minutes * 60 * 1000).toISOString();

		function expectFinishedWithoutSending(subject: Subject, kind: "regular" | "pay") {
			expect(subject.email.getSentEmails()).toEqual([]);
			expect(subject.events).toEqual([]);
			expect(skipReasonsOf(subject)).toEqual([]);
			expect(subject.published).toEqual([
				{
					detailType: ReaderReadyEmailSentEvent.detailType,
					detail: { userId: USER_ID, urls: ["https://example.com/alpha"], sentAt: claimedAt.toISOString() },
				},
			]);
			expect(subject.logs).toContainEqual({
				level: "info",
				message: "[SendQueueDigest] sent digest",
				data: { userId: USER_ID, kind, itemCount: 1, redelivery: true },
			});
		}

		async function claimRegularDigest(subject: Subject) {
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });
			await subject.readerReady.claimReaderReadyEmailSlot({
				userId: USER_ID,
				now: claimedAt,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE_ID,
				urls: ["https://example.com/alpha"],
			});
		}

		it("finishes a regular digest whose redrive lands after the pay window opened, without sending a pay digest", async () => {
			const subject = createSubject();
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: minutesAfter(96, -1) });
			await claimRegularDigest(subject);

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expectFinishedWithoutSending(subject, "regular");
			expect((await emailSentAtByUrl(subject)).get("https://example.com/alpha")).toEqual(claimedAt);
			const row = await subject.subscriptions.findByUserId(USER_ID);
			assert(row, "the trialist keeps their subscription row");
			expect(row.status).toBe("trialing");
			expect("payDigestEmailSentAt" in row).toBe(false);
		});

		it.each<[string, UserContact, string]>([
			["unsubscribed", { ...VERIFIED_CONTACT, queueDigestOptOutAt: "2026-06-10T11:59:00.000Z" }, TRIAL_ENDS_TEN_DAYS_OUT],
			["lost their verified email", { ...VERIFIED_CONTACT, emailVerified: false }, TRIAL_ENDS_TEN_DAYS_OUT],
			["seen their trial end", VERIFIED_CONTACT, minutesAfter(0, -1)],
		])("finishes a regular digest whose reader has since %s", async (_change, contact, trialEndsAt) => {
			const subject = createSubject({ contact });
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt });
			await claimRegularDigest(subject);

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expectFinishedWithoutSending(subject, "regular");
			expect((await emailSentAtByUrl(subject)).get("https://example.com/alpha")).toEqual(claimedAt);
		});

		it("finishes a pay digest whose redrive lands after the pay window closed", async () => {
			const subject = createSubject();
			const trialEndsAt = minutesAfter(60, -1);
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });
			await subject.subscriptions.claimPayDigest({
				userId: USER_ID,
				trialEndsAt,
				messageId: MESSAGE_ID,
				now: claimedAt,
				urls: ["https://example.com/alpha"],
			});

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expectFinishedWithoutSending(subject, "pay");
			expect((await emailSentAtByUrl(subject)).get("https://example.com/alpha")).toEqual(claimedAt);
		});

		it("finishes a pay digest whose reader chose a plan before the redrive, which ended the trial", async () => {
			const subject = createSubject();
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });
			subject.subscriptions.seedRow({
				userId: USER_ID,
				provider: "stripe",
				status: "active",
				subscriptionId: "sub_1",
				customerId: "cus_1",
				payDigestEmailSentAt: claimedAt.toISOString(),
				payDigestMessageId: MESSAGE_ID,
				payDigestUrls: ["https://example.com/alpha"],
				createdAt: hoursBefore(300).toISOString(),
				updatedAt: SEND_INSTANT.toISOString(),
			});

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expectFinishedWithoutSending(subject, "pay");
			expect((await emailSentAtByUrl(subject)).get("https://example.com/alpha")).toEqual(claimedAt);
		});
	});

	describe("bookkeeping after the send", () => {
		async function readyTrialist(subject: Subject) {
			await subject.subscriptions.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_TEN_DAYS_OUT });
			await saveReadyArticle(subject, { url: "https://example.com/alpha", title: "Alpha", savedAt: DAY_OLD_SAVE });
		}

		it("records the send as soon as the email is accepted, so a timeout while stamping cannot lose it", async () => {
			const subject = createSubject({
				overrides: { markReaderReadyEmailSent: () => new Promise<void>(() => {}) },
			});
			await readyTrialist(subject);

			void subject.run();
			await new Promise((resolve) => setImmediate(resolve));

			expect(subject.email.getSentEmails()).toHaveLength(1);
			expect(subject.published).toEqual([]);
			expect(subject.events).toEqual([expect.objectContaining({ event: "queue_digest_sent", send_id: MESSAGE_ID })]);
		});

		it("acks and still records the send when stamping a save fails", async () => {
			const stampFailure = new Error("dynamo down");
			const subject = createSubject({
				overrides: {
					markReaderReadyEmailSent: async () => {
						throw stampFailure;
					},
				},
			});
			await readyTrialist(subject);

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(subject.email.getSentEmails()).toHaveLength(1);
			expect(subject.published).toHaveLength(1);
			expect(subject.events).toEqual([expect.objectContaining({ event: "queue_digest_sent" })]);
			expect(subject.logs).toContainEqual({
				level: "error",
				message: "[SendQueueDigest] mark-email-sent failed",
				data: { userId: USER_ID, url: "https://example.com/alpha", error: stampFailure },
			});
		});

		it("acks and logs when publishing ReaderReadyEmailSent fails", async () => {
			const publishFailure = new Error("bus down");
			const subject = createSubject({
				overrides: {
					publishEvent: async () => {
						throw publishFailure;
					},
				},
			});
			await readyTrialist(subject);

			const result = await subject.run();

			expect(result).toEqual({ batchItemFailures: [] });
			expect(subject.email.getSentEmails()).toHaveLength(1);
			expect(subject.logs).toContainEqual({
				level: "error",
				message: "[SendQueueDigest] event publish failed",
				data: { userId: USER_ID, error: publishFailure },
			});
		});
	});

	describe("envelope validation", () => {
		it("reports a batch item failure for a command without a userId, before reading anything", async () => {
			const findUserContactByUserId = jest.fn();
			const subject = createSubject({ overrides: { findUserContactByUserId } });

			const result = await subject.runBody({ messageId: "msg-bad", body: JSON.stringify({ detail: {} }) });

			expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-bad" }] });
			expect(findUserContactByUserId).not.toHaveBeenCalled();
		});
	});
});
