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
	const listAllUserHighlights = async () => (overrides.highlighted ?? []).map(highlightOf);
	const removedLinks = initInMemoryRemovedLinks({
		readNewsletterLinkRows: store.readNewsletterLinkRows,
		readOpenedInReadlists: store.readOpenedInReadlists,
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
				listKeysOpenedInReadlists: removedLinks.listKeysOpenedInReadlists,
				listAllUserHighlights,
				moveNewsletterLinkToHold: (overrides.moveNewsletterLinkToHold ?? ((move) => move))(store.moveNewsletterLinkToHold),
				findOriginalUrls: store.findOriginalUrls,
				listUserSavesForUrls: store.listUserSavesForUrls,
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
				publishEvent,
				now,
			}),
			count: initCountSavedLinks({
				summariseNewsletterLinks: removedLinks.summariseNewsletterLinks,
				countNewsletterIssues: removedLinks.countNewsletterIssues,
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
	return { store, published, run, claim };
}

const dequeued = (published: { detailType: string; detail: unknown }[]) =>
	published.filter((event) => event.detailType === "LinkDequeued").map((event) => event.detail);

describe("saved-links job: remove", () => {
	it("holds the chosen links, counts every skip kind, and publishes a dequeue only where no copy remains", async () => {
		const { store, published, run, claim } = setup({ highlighted: ["a.com/highlighted"] });
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

		const counts = { held: 2, read: 1, opened: 2, highlighted: 1, changed: 1 };
		assert.deepEqual(dequeued(published), [{ url: "https://a.com/held", userId: READER }]);
		assert.deepEqual(published.at(-1), {
			detailType: "SavedLinksJobCompleted",
			detail: { userId: READER, jobId: JOB, action: "remove", counts, completedAt: NOW.toISOString() },
		});
		const job = await store.findSavedLinksJob({ userId: READER });
		assert.equal(job?.state, "completed");
		assert.deepEqual(job?.counts, counts);
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
		assert.deepEqual((await store.findSavedLinksJob({ userId: READER }))?.counts, { held: 2 });
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
		assert.equal(job?.counted?.issues, 0);
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
				{ senderEmail: "news@example.com", count: 2 },
				{ senderEmail: "dan@tldr.tech", count: 1 },
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
			bySender: [{ senderEmail: "dan@tldr.tech", count: 1 }],
			unrestorable: [],
		});
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
