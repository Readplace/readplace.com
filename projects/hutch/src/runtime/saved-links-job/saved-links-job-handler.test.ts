import assert from "node:assert/strict";
import { HighlightIdSchema, type Highlight, MinutesSchema, SavedLinksJobIdSchema } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { RunSavedLinksJobDetail } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import type {
	FindSavedLinksJob,
	FinishSavedLinksJob,
	MoveNewsletterLinkToHold,
	RecordCountedNewsletterLinks,
	RecordSavedLinksJobProgress,
	RestoreHeldLink,
} from "@packages/provider-contracts/article-store";
import { initInMemoryArticleStore, initInMemoryRemovedLinks } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryInboxEmail } from "@packages/test-fixtures/providers/inbox-email";
import { emailIssueArticleUrl, emailIssueStoredKey, InboxAddressSchema, MessageIdSchema } from "@packages/domain/inbox";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initCountSavedLinks } from "./count-saved-links";
import { initRemoveSavedLinks } from "./remove-saved-links";
import { initRestoreSavedLinks } from "./restore-saved-links";
import { initSavedLinksJobHandler } from "./saved-links-job-handler";

const READER = UserIdSchema.parse("reader-1");
const SAVED_AT = new Date("2026-11-20T00:00:00.000Z");
const CUTOFF = new Date("2026-12-01T00:00:00.000Z");
const NOW = new Date("2026-12-02T00:00:00.000Z");
const JOB = SavedLinksJobIdSchema.parse("2026-12-02T00:00:00.000Z#a");
const WORK = ReadlistSlugSchema.parse("work");

function highlightOf(storedKey: string): Highlight {
	return {
		highlightId: HighlightIdSchema.parse("6f9a2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b"),
		highlightOf: storedKey,
		exact: "quote",
		prefix: "",
		suffix: "",
		start: 0,
		end: 5,
		anchoredContentHash: "hash",
		anchorState: "anchored",
		orderKey: 0,
		createdAt: SAVED_AT,
		updatedAt: SAVED_AT,
		anchorRevision: 0,
	};
}

function emailSave(params: { url: string; senderEmail?: string; savedAt?: Date }) {
	return {
		userId: READER,
		url: params.url,
		metadata: { title: "Post", siteName: "example.com", excerpt: "", wordCount: 100 },
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "email" as const, senderEmail: params.senderEmail ?? "dan@tldr.tech" },
		savedAt: params.savedAt ?? SAVED_AT,
		saveTrigger: "automatic" as const,
	};
}

function removeDetail(overrides: Partial<RunSavedLinksJobDetail> = {}): RunSavedLinksJobDetail {
	return {
		userId: READER,
		jobId: JOB,
		requestedAt: NOW.toISOString(),
		job: { action: "remove", cutoff: CUTOFF.toISOString(), senders: { kind: "all" } },
		...overrides,
	};
}

function restoreDetail(senders: Extract<RunSavedLinksJobDetail["job"], { action: "restore" }>["senders"] = { kind: "all" }): RunSavedLinksJobDetail {
	return { userId: READER, jobId: JOB, requestedAt: NOW.toISOString(), job: { action: "restore", senders } };
}

function sqsEvent(params: { detail: RunSavedLinksJobDetail; receiveCount?: number }) {
	const event = buildSqsEvent([
		{
			messageId: "m-1",
			body: JSON.stringify({ source: "hutch.api", "detail-type": "RunSavedLinksJobCommand", detail: params.detail }),
		},
	]);
	for (const record of event.Records) record.attributes.ApproximateReceiveCount = String(params.receiveCount ?? 1);
	return event;
}

function setup(overrides: {
	highlighted?: string[];
	findSavedLinksJob?: (find: FindSavedLinksJob) => FindSavedLinksJob;
	moveNewsletterLinkToHold?: (move: MoveNewsletterLinkToHold) => MoveNewsletterLinkToHold;
	restoreHeldLink?: (restore: RestoreHeldLink) => RestoreHeldLink;
	recordSavedLinksJobProgress?: (record: RecordSavedLinksJobProgress) => RecordSavedLinksJobProgress;
	finishSavedLinksJob?: (finish: FinishSavedLinksJob) => FinishSavedLinksJob;
	recordCountedNewsletterLinks?: (record: RecordCountedNewsletterLinks) => RecordCountedNewsletterLinks;
	pages?: number;
} = {}) {
	const store = initInMemoryArticleStore();
	const inbox = initInMemoryInboxEmail();
	const scheduledPurges: { userId: string; jobId: string; runStartedAt: Date }[] = [];
	const listAllUserHighlights = async () => (overrides.highlighted ?? []).map(highlightOf);
	const removedLinks = initInMemoryRemovedLinks({
		readNewsletterLinkRows: store.readNewsletterLinkRows,
		listAllUserHighlights,
	});
	const published: { detailType: string; detail: unknown }[] = [];
	const publishEvent: PublishEvent = async (definition, detail) => {
		published.push({ detailType: definition.detailType, detail });
	};
	const now = () => NOW;
	const pages = overrides.pages ?? 1;
	const handler = initSavedLinksJobHandler({
		findSavedLinksJob: (overrides.findSavedLinksJob ?? ((find) => find))(store.findSavedLinksJob),
		recordSavedLinksJobProgress: (overrides.recordSavedLinksJobProgress ?? ((record) => record))(
			store.recordSavedLinksJobProgress,
		),
		finishSavedLinksJob: (overrides.finishSavedLinksJob ?? ((finish) => finish))(store.finishSavedLinksJob),
		runners: {
			remove: initRemoveSavedLinks({
				forEachRemovalCandidatePage: async (params) => {
					for (let page = 0; page < pages; page++) await removedLinks.forEachRemovalCandidatePage(params);
				},
				forEachHeldLinkPage: store.forEachHeldLinkPage,
				listReadlistDefinitions: store.listReadlistDefinitions,
				listAllUserHighlights,
				moveNewsletterLinkToHold: (overrides.moveNewsletterLinkToHold ?? ((move) => move))(store.moveNewsletterLinkToHold),
				findOriginalUrls: store.findOriginalUrls,
				forEachRemovableEmailPage: inbox.forEachRemovableEmailPage,
				markEmailRemoved: inbox.markEmailRemoved,
				scheduleRemovedIssuesPurge: async (params) => void scheduledPurges.push(params),
				publishEvent,
				now,
			}),
			restore: initRestoreSavedLinks({
				forEachHeldLinkPage: store.forEachHeldLinkPage,
				forEachRemovalCandidatePage: (params) =>
					removedLinks.forEachRemovalCandidatePage({
						userId: params.userId,
						onPage: (candidates) => params.onPage([...candidates, { kind: "unreadable" }]),
					}),
				restoreHeldLink: (overrides.restoreHeldLink ?? ((restore) => restore))(store.restoreHeldLink),
				findOriginalUrls: store.findOriginalUrls,
				forEachRemovableEmailPage: inbox.forEachRemovableEmailPage,
				clearEmailRemoval: inbox.clearEmailRemoval,
				publishEvent,
				now,
			}),
			count: initCountSavedLinks({
				summariseNewsletterLinks: removedLinks.summariseNewsletterLinks,
				findNewsletterIssueStates: removedLinks.findNewsletterIssueStates,
				forEachRemovableEmailPage: inbox.forEachRemovableEmailPage,
				forEachHeldLinkPage: store.forEachHeldLinkPage,
				findUnrestorableArticles: store.findUnrestorableArticles,
				findKeysInAll: store.findKeysInAll,
				now,
				recordCountedNewsletterLinks: (overrides.recordCountedNewsletterLinks ?? ((record) => record))(
					store.recordCountedNewsletterLinks,
				),
			}),
		},
		publishEvent,
		logger: Logger.from(noopLogger),
		now,
	});
	const run = async (params: { detail: RunSavedLinksJobDetail; receiveCount?: number }) => {
		const result = await handler(sqsEvent(params), buildLambdaContext(), () => {});
		assert(result, "the batch handler answers");
		return result.batchItemFailures.length;
	};
	const claim = (action: "remove" | "restore" | "count") =>
		store.requestSavedLinksJob({ userId: READER, jobId: JOB, action, requestedAt: NOW });
	const receive = async (params: { id: string; senderEmail?: string; receivedAt?: string; issue?: "unread" | "read" }) => {
		const receivedAt = params.receivedAt ?? SAVED_AT.toISOString();
		const receivedAtMessageId = `${receivedAt}#<${params.id}@x>`;
		const senderEmail = params.senderEmail ?? "dan@tldr.tech";
		await inbox.putEmail({
			userId: READER,
			receivedAtMessageId,
			messageId: MessageIdSchema.parse(`<${params.id}@x>`),
			recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
			senderEmail,
			subject: "Issue",
			status: "received",
			receivedAt,
			rawEmailS3Key: `inbound/${params.id}`,
			bodyS3Key: undefined,
			linkCounts: undefined,
		});
		if (params.issue !== undefined) {
			const { saved } = await store.saveArticle(
				emailSave({ url: emailIssueArticleUrl({ userId: READER, receivedAtMessageId }), senderEmail }),
			);
			if (params.issue === "read") await store.updateArticleStatus(saved.id, READER, "read");
		}
		return { userId: READER, receivedAtMessageId };
	};
	return { store, inbox, published, run, claim, receive, scheduledPurges };
}

const dequeued = (published: { detailType: string; detail: unknown }[]) =>
	published.filter((event) => event.detailType === "LinkDequeued").map((event) => event.detail);

describe("saved-links job: remove", () => {
	it("holds the chosen links with their readlist copies, counts every skip kind, and dequeues each held link", async () => {
		const { store, published, run, claim } = setup({ highlighted: ["a.com/highlighted"] });
		await store.createReadlistDefinition({ userId: READER, slug: WORK, label: "Work", createdAt: SAVED_AT });
		await store.saveArticle(emailSave({ url: "https://a.com/held" }));
		await store.saveArticle(emailSave({ url: "https://a.com/in-readlist" }));
		await store.saveReadlistArticle({ ...emailSave({ url: "https://a.com/in-readlist" }), readlist: WORK });
		const { saved: read } = await store.saveArticle(emailSave({ url: "https://a.com/read" }));
		await store.updateArticleStatus(read.id, READER, "read");
		await store.saveArticle(emailSave({ url: "https://a.com/opened" }));
		await store.markArticleViewed({ userId: READER, url: "https://a.com/opened", at: SAVED_AT });
		await store.saveArticle(emailSave({ url: "https://a.com/opened-in-readlist" }));
		await store.saveReadlistArticle({ ...emailSave({ url: "https://a.com/opened-in-readlist" }), readlist: WORK });
		await store.markReadlistArticleViewed({ userId: READER, readlist: WORK, url: "https://a.com/opened-in-readlist", at: SAVED_AT });
		await store.saveArticle(emailSave({ url: "https://a.com/highlighted" }));
		await store.saveArticle(emailSave({ url: "https://a.com/changed", savedAt: new Date("2026-12-01T12:00:00.000Z") }));
		await claim("remove");

		assert.equal(await run({ detail: removeDetail() }), 0);

		const counts = { held: 4, read: 1, highlighted: 1, changed: 1 };
		assert.deepEqual(dequeued(published), [
			{ url: "https://a.com/held", userId: READER },
			{ url: "https://a.com/in-readlist", userId: READER },
			{ url: "https://a.com/opened", userId: READER },
			{ url: "https://a.com/opened-in-readlist", userId: READER },
		]);
		const inWork = await store.listUserSavesForUrls({
			userId: READER,
			urls: ["https://a.com/in-readlist", "https://a.com/opened-in-readlist"],
			readlists: [WORK],
		});
		assert.deepEqual([...inWork.values()], [[], []]);
		assert.deepEqual(published.at(-1), {
			detailType: "SavedLinksJobCompleted",
			detail: { userId: READER, jobId: JOB, action: "remove", counts, completedAt: NOW.toISOString() },
		});
		const job = await store.findSavedLinksJob({ userId: READER });
		assert.equal(job?.state, "completed");
		assert.deepEqual(job?.counts, counts);
	});

	it("removes each chosen issue from All and hides its email, leaving read, highlighted, later and unchosen ones", async () => {
		const { store, inbox, published, run, claim, receive, scheduledPurges } = setup({
			highlighted: [emailIssueStoredKey({ userId: READER, receivedAtMessageId: `${SAVED_AT.toISOString()}#<highlighted@x>` })],
		});
		const held = await receive({ id: "held", issue: "unread" });
		const noIssue = await receive({ id: "no-issue" });
		const read = await receive({ id: "read", issue: "read" });
		const highlighted = await receive({ id: "highlighted", issue: "unread" });
		const later = await receive({ id: "later", issue: "unread", receivedAt: "2026-12-01T12:00:00.000Z" });
		const unchosen = await receive({ id: "unchosen", issue: "unread", senderEmail: "x@y.com" });
		await claim("remove");

		await run({
			detail: removeDetail({
				job: { action: "remove", cutoff: CUTOFF.toISOString(), senders: { kind: "chosen", senderEmails: ["dan@tldr.tech"] } },
			}),
		});

		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, { "held-issue": 1, read: 1, highlighted: 1 });
		assert.equal((await inbox.getEmail(held))?.removedAt, NOW.toISOString());
		assert.equal((await inbox.getEmail(noIssue))?.removedAt, NOW.toISOString());
		for (const kept of [read, highlighted, later, unchosen]) assert.equal((await inbox.getEmail(kept))?.removedAt, undefined);
		assert.deepEqual(await store.findKeysInAll({ userId: READER, storedKeys: [emailIssueStoredKey(held)] }), new Set());
		assert.deepEqual(dequeued(published), [{ url: emailIssueArticleUrl(held), userId: READER }]);
		assert.deepEqual(scheduledPurges, [{ userId: READER, jobId: JOB, runStartedAt: NOW }]);
	});

	it("schedules no purge when no email is chosen", async () => {
		const { run, claim, receive, scheduledPurges } = setup();
		await receive({ id: "later", receivedAt: "2026-12-01T12:00:00.000Z" });
		await claim("remove");

		await run({ detail: removeDetail() });

		assert.deepEqual(scheduledPurges, []);
	});

	it("hides again, without counting, an email whose issue an earlier receive of the job held", async () => {
		const { store, inbox, run, claim, receive } = setup();
		const email = await receive({ id: "earlier", issue: "unread" });
		await store.moveNewsletterLinkToHold({
			userId: READER,
			jobId: JOB,
			storedKey: emailIssueStoredKey(email),
			cutoff: CUTOFF,
			senders: { kind: "all" },
			readlists: [],
			kind: "issue",
			now: NOW,
		});
		await claim("remove");
		await store.recordSavedLinksJobProgress({ userId: READER, jobId: JOB, counts: { held: 0, "held-issue": 4 } });

		await run({ detail: removeDetail() });

		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, { held: 0, "held-issue": 1 });
		assert.equal((await inbox.getEmail(email))?.removedAt, NOW.toISOString());
	});

	it("stops before the issues when the job moves on during the links", async () => {
		const { store, inbox, run, claim, receive } = setup({
			recordSavedLinksJobProgress: (record) => async (params) =>
				params.counts.held === undefined ? record(params) : { outcome: "stale" },
		});
		await store.saveArticle(emailSave({ url: "https://a.com/held" }));
		const email = await receive({ id: "kept", issue: "unread" });
		await claim("remove");

		await run({ detail: removeDetail() });

		assert.equal((await inbox.getEmail(email))?.removedAt, undefined);
	});

	it("moves in chunks of ten and counts a move a changed row cancelled", async () => {
		const { store, published, run, claim } = setup({
			moveNewsletterLinkToHold: (move) => async (params) =>
				/\/1[01]$/.test(params.storedKey) ? { outcome: "skipped", reason: "changed" } : move(params),
		});
		for (let index = 0; index < 12; index++) await store.saveArticle(emailSave({ url: `https://a.com/${index}` }));
		await claim("remove");

		await run({ detail: removeDetail() });

		assert.equal(dequeued(published).length, 10);
		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, { held: 10, changed: 2 });
	});

	it("does not count a link from a sender the reader did not choose", async () => {
		const { store, run, claim } = setup();
		await store.saveArticle(emailSave({ url: "https://a.com/chosen" }));
		await store.saveArticle(emailSave({ url: "https://a.com/other", senderEmail: "x@y.com" }));
		await claim("remove");

		await run({
			detail: removeDetail({
				job: { action: "remove", cutoff: CUTOFF.toISOString(), senders: { kind: "chosen", senderEmails: ["dan@tldr.tech"] } },
			}),
		});

		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, { held: 1 });
	});

	it("counts and dequeues again the links an earlier receive of the job held", async () => {
		const { store, published, run, claim } = setup();
		const holdUnder = async (params: { url: string; jobId: typeof JOB }) => {
			await store.saveArticle(emailSave({ url: params.url }));
			await store.moveNewsletterLinkToHold({
				userId: READER,
				jobId: params.jobId,
				storedKey: params.url.replace("https://", ""),
				cutoff: CUTOFF,
				senders: { kind: "all" },
				readlists: [],
				kind: "link",
				now: NOW,
			});
		};
		await holdUnder({ url: "https://a.com/earlier", jobId: JOB });
		await holdUnder({ url: "https://a.com/other-job", jobId: SavedLinksJobIdSchema.parse("2026-11-01T00:00:00.000Z#z") });
		await store.saveArticle(emailSave({ url: "https://a.com/next" }));
		await claim("remove");
		await store.recordSavedLinksJobProgress({ userId: READER, jobId: JOB, counts: { held: 3, read: 1 } });

		await run({ detail: removeDetail() });

		assert.deepEqual(dequeued(published), [
			{ url: "https://a.com/earlier", userId: READER },
			{ url: "https://a.com/next", userId: READER },
		]);
		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, { held: 2, "held-issue": 0 });
	});

	it("runs a failed job again when it is redriven", async () => {
		const { store, published, run, claim } = setup();
		await store.saveArticle(emailSave({ url: "https://a.com/held" }));
		await claim("remove");
		await store.finishSavedLinksJob({ userId: READER, jobId: JOB, state: "failed", counts: {}, finishedAt: NOW });

		assert.equal(await run({ detail: removeDetail() }), 0);

		assert.deepEqual(dequeued(published), [{ url: "https://a.com/held", userId: READER }]);
		assert.equal((await store.findSavedLinksJob({ userId: READER }))?.state, "completed");
	});

	it("acknowledges a command for a job that is not the reader's current one", async () => {
		const { store, published, run } = setup();
		await store.saveArticle(emailSave({ url: "https://a.com/held" }));
		assert.equal(await run({ detail: removeDetail() }), 0);
		await store.requestSavedLinksJob({
			userId: READER,
			jobId: SavedLinksJobIdSchema.parse("2026-12-03T00:00:00.000Z#b"),
			action: "remove",
			requestedAt: NOW,
		});

		assert.equal(await run({ detail: removeDetail() }), 0);

		assert.deepEqual(published, []);
		assert.equal(store.readNewsletterLinkRows(READER).length, 1);
	});

	it("acknowledges a command for a job that already completed", async () => {
		const { published, run, claim } = setup();
		await claim("remove");
		await run({ detail: removeDetail() });
		published.length = 0;

		assert.equal(await run({ detail: removeDetail() }), 0);

		assert.deepEqual(published, []);
	});

	it("stops without finishing when the job moves on before the run starts", async () => {
		const { store, published, run, claim } = setup({
			recordSavedLinksJobProgress: () => async () => ({ outcome: "stale" }),
		});
		await store.saveArticle(emailSave({ url: "https://a.com/held" }));
		await claim("remove");

		await run({ detail: removeDetail() });

		assert.deepEqual(published, []);
		assert.equal((await store.findSavedLinksJob({ userId: READER }))?.state, "requested");
	});

	it("stops after the chunk whose progress the job refused", async () => {
		let calls = 0;
		const { store, published, run, claim } = setup({
			pages: 2,
			recordSavedLinksJobProgress: (record) => async (params) => {
				calls++;
				return calls === 1 ? record(params) : { outcome: "stale" };
			},
		});
		for (let index = 0; index < 12; index++) await store.saveArticle(emailSave({ url: `https://a.com/${index}` }));
		await claim("remove");

		await run({ detail: removeDetail() });

		assert.equal(dequeued(published).length, 10);
		assert.equal(published.some((event) => event.detailType === "SavedLinksJobCompleted"), false);
	});

	it("publishes no completed fact when the job was finished elsewhere", async () => {
		const { published, run, claim } = setup({ finishSavedLinksJob: () => async () => ({ outcome: "stale" }) });
		await claim("remove");

		await run({ detail: removeDetail() });

		assert.deepEqual(published, []);
	});

	it("fails the record on a store error and leaves the job running before the final receive", async () => {
		const { store, published, run, claim } = setup({
			moveNewsletterLinkToHold: () => async () => {
				throw new Error("throttled");
			},
		});
		await store.saveArticle(emailSave({ url: "https://a.com/held" }));
		await claim("remove");

		assert.equal(await run({ detail: removeDetail(), receiveCount: 11 }), 1);

		assert.deepEqual(published, []);
		assert.equal((await store.findSavedLinksJob({ userId: READER }))?.state, "running");
	});

	it("marks the job failed and publishes the failed fact on receive 12", async () => {
		const { store, published, run, claim } = setup({
			moveNewsletterLinkToHold: () => async () => {
				throw new Error("throttled");
			},
		});
		await store.saveArticle(emailSave({ url: "https://a.com/held" }));
		await claim("remove");

		assert.equal(await run({ detail: removeDetail(), receiveCount: 12 }), 1);

		assert.deepEqual(published, [
			{
				detailType: "SavedLinksJobFailed",
				detail: { userId: READER, jobId: JOB, action: "remove", failedAt: NOW.toISOString() },
			},
		]);
		assert.equal((await store.findSavedLinksJob({ userId: READER }))?.state, "failed");
	});

	it("marks the job failed on receive 12 when the job cannot be read", async () => {
		let reads = 0;
		const { store, published, run, claim } = setup({
			findSavedLinksJob: (find) => async (params) => {
				reads++;
				if (reads === 1) throw new Error("throttled");
				return find(params);
			},
		});
		await claim("remove");

		assert.equal(await run({ detail: removeDetail(), receiveCount: 12 }), 1);

		assert.deepEqual(
			published.map((event) => event.detailType),
			["SavedLinksJobFailed"],
		);
		assert.equal((await store.findSavedLinksJob({ userId: READER }))?.state, "failed");
	});

	it("publishes no failed fact on receive 12 when the job was finished elsewhere", async () => {
		const { store, published, run, claim } = setup({
			moveNewsletterLinkToHold: () => async () => {
				throw new Error("throttled");
			},
			finishSavedLinksJob: () => async () => ({ outcome: "stale" }),
		});
		await store.saveArticle(emailSave({ url: "https://a.com/held" }));
		await claim("remove");

		assert.equal(await run({ detail: removeDetail(), receiveCount: 12 }), 1);

		assert.deepEqual(published, []);
	});
});

describe("saved-links job: restore", () => {
	it("writes back each chosen held link and counts every restore outcome", async () => {
		const { store, published, run, claim } = setup({
			restoreHeldLink: (restore) => async (params) =>
				params.heldKey.includes("gone") ? { outcome: "gone" } : restore(params),
		});
		await hold(store, { url: "https://a.com/back" });
		await hold(store, { url: "https://a.com/in-all" });
		await store.saveArticle(emailSave({ url: "https://a.com/in-all" }));
		await hold(store, { url: "https://a.com/purged" });
		await store.setPurgedAt({ url: "https://a.com/purged", at: SAVED_AT });
		await hold(store, { url: "https://a.com/later", at: new Date("2026-12-03T00:00:00.000Z") });
		await hold(store, { url: "https://a.com/other", senderEmail: "x@y.com" });
		await claim("restore");

		assert.equal(await run({ detail: restoreDetail({ kind: "chosen", senderEmails: ["dan@tldr.tech"] }) }), 0);

		const counts = { restored: 1, "already-in-all": 1, unrestorable: 1 };
		assert.deepEqual(
			published.filter((event) => event.detailType === "LinkQueued").map((event) => event.detail),
			[{ url: "https://a.com/back", userId: READER }],
		);
		assert.deepEqual(published.at(-1), {
			detailType: "SavedLinksJobCompleted",
			detail: { userId: READER, jobId: JOB, action: "restore", counts, completedAt: NOW.toISOString() },
		});
	});

	it("puts a removed link back in All and in the readlist it was filed in", async () => {
		const { store, run, claim } = setup();
		await store.createReadlistDefinition({ userId: READER, slug: WORK, label: "Work", createdAt: SAVED_AT });
		await store.saveArticle(emailSave({ url: "https://a.com/filed" }));
		await store.saveReadlistArticle({ ...emailSave({ url: "https://a.com/filed" }), readlist: WORK });
		await claim("remove");
		await run({ detail: removeDetail() });
		await claim("restore");

		await run({ detail: restoreDetail() });

		const saves = await store.listUserSavesForUrls({ userId: READER, urls: ["https://a.com/filed"] });
		assert.deepEqual(saves.get("https://a.com/filed"), [{}, { readlist: WORK }]);
	});

	it("brings back each removed issue of a chosen sender still inside its 30 days", async () => {
		const { store, inbox, run, claim, receive } = setup();
		const back = await receive({ id: "back", issue: "unread" });
		const noIssue = await receive({ id: "no-issue" });
		const unchosen = await receive({ id: "unchosen", issue: "unread", senderEmail: "x@y.com" });
		const expired = await receive({ id: "expired" });
		const afterRequest = await receive({ id: "after-request" });
		await claim("remove");
		await run({ detail: removeDetail() });
		await inbox.clearEmailRemoval(expired);
		await inbox.markEmailRemoved({ ...expired, jobId: "old", at: new Date("2026-10-01T00:00:00.000Z") });
		await inbox.clearEmailRemoval(afterRequest);
		await inbox.markEmailRemoved({ ...afterRequest, jobId: "later", at: new Date("2026-12-03T00:00:00.000Z") });
		await claim("restore");

		await run({ detail: restoreDetail({ kind: "chosen", senderEmails: ["dan@tldr.tech"] }) });

		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, { "restored-issue": 2 });
		assert.equal((await inbox.getEmail(back))?.removedAt, undefined);
		assert.equal((await inbox.getEmail(noIssue))?.removedAt, undefined);
		for (const kept of [unchosen, expired, afterRequest]) assert.notEqual((await inbox.getEmail(kept))?.removedAt, undefined);
		assert.deepEqual(await store.findKeysInAll({ userId: READER, storedKeys: [emailIssueStoredKey(back)] }), new Set([emailIssueStoredKey(back)]));
	});

	it("stops clearing issues when the job moves on", async () => {
		const { store, inbox, run, claim, receive } = setup({
			recordSavedLinksJobProgress: (record) => async (params) =>
				params.counts["restored-issue"] === undefined ? record(params) : { outcome: "stale" },
		});
		const email = await receive({ id: "back" });
		await claim("remove");
		await run({ detail: removeDetail() });
		await claim("restore");

		await run({ detail: restoreDetail() });

		assert.equal((await inbox.getEmail(email))?.removedAt, undefined);
		assert.equal((await store.findSavedLinksJob({ userId: READER }))?.state, "running");
	});

	it("does not count a held link that went away before it was written back", async () => {
		const { store, run, claim } = setup({ restoreHeldLink: () => async () => ({ outcome: "gone" }) });
		await hold(store, { url: "https://a.com/back" });
		await claim("restore");

		await run({ detail: restoreDetail() });

		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, {});
	});

	it("queues and counts again the links an earlier receive of the restore wrote back", async () => {
		const { store, published, run, claim } = setup();
		const restoreAt = async (params: { url: string; at: Date }) => {
			await hold(store, { url: params.url });
			const held = await store.findHeldLink({ userId: READER, storedKey: params.url.replace("https://", ""), now: NOW });
			assert(held, "the link is held");
			await store.restoreHeldLink({ userId: READER, heldKey: held.heldKey, now: params.at });
		};
		await restoreAt({ url: "https://a.com/earlier", at: NOW });
		await restoreAt({ url: "https://a.com/older-restore", at: SAVED_AT });
		await store.saveArticle(emailSave({ url: "https://a.com/never-held" }));
		await hold(store, { url: "https://a.com/next" });
		await claim("restore");
		await store.recordSavedLinksJobProgress({ userId: READER, jobId: JOB, counts: { restored: 5 } });

		await run({ detail: restoreDetail() });

		assert.deepEqual(
			published.filter((event) => event.detailType === "LinkQueued").map((event) => event.detail),
			[
				{ url: "https://a.com/earlier", userId: READER },
				{ url: "https://a.com/next", userId: READER },
			],
		);
		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, { restored: 2 });
	});

	it("keeps the links a redelivered restore already wrote back and stops when the job moves on", async () => {
		let calls = 0;
		const { store, published, run, claim } = setup({
			recordSavedLinksJobProgress: (record) => async (params) => {
				calls++;
				return calls === 1 ? record(params) : { outcome: "stale" };
			},
		});
		await hold(store, { url: "https://a.com/back" });
		await claim("restore");
		await store.recordSavedLinksJobProgress({ userId: READER, jobId: JOB, counts: { restored: 2 } });

		await run({ detail: restoreDetail() });

		assert.equal(published.some((event) => event.detailType === "SavedLinksJobCompleted"), false);
		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, { restored: 2 });
	});
});

async function hold(store: ReturnType<typeof setup>["store"], params: { url: string; senderEmail?: string; at?: Date }) {
	await store.saveArticle(emailSave(params));
	const storedKey = params.url.replace("https://", "");
	const outcome = await store.moveNewsletterLinkToHold({
		userId: READER,
		jobId: SavedLinksJobIdSchema.parse("2026-12-01T00:00:00.000Z#old"),
		storedKey,
		cutoff: CUTOFF,
		senders: { kind: "all" },
		readlists: [],
		kind: "link",
		now: params.at ?? SAVED_AT,
	});
	assert.deepEqual(outcome, { outcome: "held" });
}

function countDetail(): RunSavedLinksJobDetail {
	return { userId: READER, jobId: JOB, requestedAt: CUTOFF.toISOString(), job: { action: "count" } };
}

describe("saved-links job: count", () => {
	it("writes the newsletter links counted at the request time, completes, and moves no link", async () => {
		const { store, published, run, claim } = setup();
		await store.saveArticle(emailSave({ url: "https://a.com/one" }));
		await store.saveArticle(emailSave({ url: "https://a.com/two", senderEmail: "news@example.com" }));
		await store.saveArticle(emailSave({ url: "https://a.com/later", savedAt: new Date("2026-12-01T12:00:00.000Z") }));
		await claim("count");

		assert.equal(await run({ detail: countDetail() }), 0);

		const job = await store.findSavedLinksJob({ userId: READER });
		assert.equal(job?.state, "completed");
		assert.deepEqual(job?.counts, {});
		assert.equal(job?.counted?.cutoff.toISOString(), CUTOFF.toISOString());
		assert.equal(job?.counted?.summary.selected, 2);
		assert.equal(job?.counted?.summary.skipped.changed, 1);
		assert.deepEqual(job?.counted?.issues, { selected: 0, bySender: [], skipped: { read: 0, highlighted: 0 } });
		assert.equal(dequeued(published).length, 0);
		assert.deepEqual(
			published.map((event) => event.detailType),
			["SavedLinksJobCompleted"],
		);
	});

	it("writes the held links Restore would take by newsletter and lists the ones it cannot restore", async () => {
		const { store, run, claim } = setup();
		await hold(store, { url: "https://a.com/one" });
		await hold(store, { url: "https://a.com/two", senderEmail: "news@example.com" });
		await hold(store, { url: "https://a.com/three", senderEmail: "news@example.com" });
		await hold(store, { url: "https://a.com/purged" });
		await store.setPurgedAt({ url: "https://a.com/purged", at: SAVED_AT });
		await claim("count");

		assert.equal(await run({ detail: countDetail() }), 0);

		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counted?.held, {
			bySender: [
				{ senderEmail: "news@example.com", count: 2, issues: 0 },
				{ senderEmail: "dan@tldr.tech", count: 1, issues: 0 },
			],
			unrestorable: ["a.com/purged"],
		});
	});

	it("leaves out a held link the reader has saved to All again, because Restore leaves it where it is", async () => {
		const { store, run, claim } = setup();
		await hold(store, { url: "https://a.com/one" });
		await hold(store, { url: "https://a.com/again" });
		await store.saveArticle(emailSave({ url: "https://a.com/again" }));
		await claim("count");

		assert.equal(await run({ detail: countDetail() }), 0);

		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counted?.held, {
			bySender: [{ senderEmail: "dan@tldr.tech", count: 1, issues: 0 }],
			unrestorable: [],
		});
	});

	it("writes the issues a removal would take by newsletter and the read ones apart, and the held issues by newsletter", async () => {
		const { store, run, claim, receive } = setup();
		await receive({ id: "one", issue: "unread" });
		await receive({ id: "no-issue" });
		await receive({ id: "read", issue: "read" });
		const removed = await receive({ id: "removed", issue: "unread" });
		await store.moveNewsletterLinkToHold({
			userId: READER,
			jobId: SavedLinksJobIdSchema.parse("2026-11-30T00:00:00.000Z#old"),
			storedKey: emailIssueStoredKey(removed),
			cutoff: CUTOFF,
			senders: { kind: "all" },
			readlists: [],
			kind: "issue",
			now: SAVED_AT,
		});
		await claim("count");

		assert.equal(await run({ detail: countDetail() }), 0);

		const counted = (await store.findSavedLinksJob({ userId: READER }))?.counted;
		assert.deepEqual(counted?.issues, {
			selected: 3,
			bySender: [{ senderEmail: "dan@tldr.tech", count: 3 }],
			skipped: { read: 1, highlighted: 0 },
		});
		assert.deepEqual(counted?.held.bySender, [{ senderEmail: "dan@tldr.tech", count: 0, issues: 1 }]);
	});

	it("stops without finishing when another job replaced the count while it ran", async () => {
		const { store, published, run, claim } = setup({
			recordCountedNewsletterLinks: () => async () => ({ outcome: "stale" }),
		});
		await claim("count");

		assert.equal(await run({ detail: countDetail() }), 0);

		assert.equal((await store.findSavedLinksJob({ userId: READER }))?.state, "running");
		assert.deepEqual(published, []);
	});

	it("marks the count failed on receive 12", async () => {
		const { store, published, run, claim } = setup({
			recordCountedNewsletterLinks: () => async () => {
				throw new Error("throttled");
			},
		});
		await claim("count");

		assert.equal(await run({ detail: countDetail(), receiveCount: 12 }), 1);

		assert.equal((await store.findSavedLinksJob({ userId: READER }))?.state, "failed");
		assert.deepEqual(
			published.map((event) => event.detailType),
			["SavedLinksJobFailed"],
		);
	});
});
