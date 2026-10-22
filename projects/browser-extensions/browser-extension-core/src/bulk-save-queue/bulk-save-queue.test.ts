import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { BulkSavePage } from "../reading-list/reading-list.types";
import type { BulkChunkSummary, BulkSaveSession } from "../reading-list/siren-reading-list";
import { UnauthorizedError } from "../auth/unauthorized-error";
import {
	type AdmittedJob,
	type BulkSaveJobStore,
	type BulkSaveQueue,
	type QueueEvent,
	type ResumeOutcome,
	initBulkSaveQueue,
} from "./bulk-save-queue";
import { parseBulkSaveJobs, type BulkSaveJob } from "./bulk-save-job";

function createFakeJobStore(): BulkSaveJobStore & { data: unknown } {
	const store: BulkSaveJobStore & { data: unknown } = {
		data: [],
		read: async () => store.data,
		write: async (jobs: BulkSaveJob[]) => {
			store.data = jobs;
		},
	};
	return store;
}

function createFakePayloads() {
	const buffers = new Map<string, ArrayBuffer>();
	return {
		buffers,
		putAll: async (items: { id: string; bytes: ArrayBuffer }[]) => {
			for (const { id, bytes } of items) buffers.set(id, bytes);
		},
		getAll: async (ids: string[]) => {
			const found = new Map<string, ArrayBuffer>();
			for (const id of ids) {
				const bytes = buffers.get(id);
				if (bytes) found.set(id, bytes);
			}
			return found;
		},
		removeAll: async (ids: string[]) => {
			for (const id of ids) buffers.delete(id);
		},
		clear: async () => {
			buffers.clear();
		},
	};
}

function createFakeScheduler() {
	const wakes: number[] = [];
	const scheduler = {
		time: 1_000,
		wakes,
		cancels: 0,
		now: () => scheduler.time,
		wakeAt: async (timestamp: number) => {
			scheduler.wakes.push(timestamp);
		},
		cancel: async () => {
			scheduler.cancels += 1;
		},
	};
	return scheduler;
}

const WIDE_LIMITS = { maxItems: 20, maxBytes: 4_587_520, requestBudget: 4_702_208 };

function createFakeSession(respond: (chunk: BulkSavePage[]) => BulkChunkSummary | Promise<BulkChunkSummary>) {
	const chunks: BulkSavePage[][] = [];
	let opens = 0;
	const openSession = async (): Promise<BulkSaveSession> => {
		opens += 1;
		return {
			limits: WIDE_LIMITS,
			sendChunk: async (pages) => {
				chunks.push(pages);
				return respond(pages);
			},
		};
	};
	return { chunks, openSession, openCount: () => opens };
}

function allCreated(chunk: BulkSavePage[]): BulkChunkSummary {
	return {
		saved: chunk.length,
		queued: 0,
		skipped: 0,
		failed: 0,
		tooBig: [],
		skippedUrls: [],
		results: chunk.map((page) => ({ url: page.url, outcome: "created" as const })),
	};
}

function createQueue(overrides?: {
	respond?: (chunk: BulkSavePage[]) => BulkChunkSummary | Promise<BulkChunkSummary>;
	openSession?: () => Promise<BulkSaveSession>;
}) {
	const jobs = createFakeJobStore();
	const payloads = createFakePayloads();
	const scheduler = createFakeScheduler();
	const session = createFakeSession(overrides?.respond ?? allCreated);
	const reports: QueueEvent[][] = [];
	const queue = initBulkSaveQueue({
		jobs,
		payloads,
		scheduler,
		openSession: overrides?.openSession ?? session.openSession,
		progress: async (events) => {
			reports.push(events);
		},
		logger: HutchLogger.from(noopLogger),
	});
	return { queue, jobs, payloads, scheduler, session, reports };
}

async function savePages(queue: BulkSaveQueue, pages: BulkSavePage[], admittedCalls: AdmittedJob[][] = []) {
	return queue.savePages({
		pages,
		admitted: async (jobs) => {
			admittedCalls.push(jobs);
		},
	});
}

function passReport(outcome: ResumeOutcome) {
	assert(outcome.kind === "pass", "the resume ran a pass");
	return outcome.report;
}

function urlOnlyPages(count: number, prefix = "https://example.com/tab-"): BulkSavePage[] {
	return Array.from({ length: count }, (_v, i) => ({ url: `${prefix}${i}` }));
}

function storedJobs(jobs: BulkSaveJobStore & { data: unknown }): BulkSaveJob[] {
	return parseBulkSaveJobs(jobs.data);
}

describe("initBulkSaveQueue savePages", () => {
	it("returns a zero summary without opening a session when the window is empty", async () => {
		const { queue, session } = createQueue();

		const result = await savePages(queue, [] );

		expect(result).toEqual({
			queued: 0,
			saved: 0,
			skipped: 0,
			failed: 0,
			tooBig: [],
			skippedUrls: [],
			failedUrls: [],
			alreadySaved: 0,
			pendingRetry: 0,
			unauthorized: false,
		});
		expect(session.openCount()).toBe(0);
	});

	it("persists every page before dispatch and settles them all on a clean first pass", async () => {
		const { queue, jobs, payloads, scheduler } = createQueue();
		const pages: BulkSavePage[] = [
			{ url: "https://example.com/a", title: "A", content: { bytes: new ArrayBuffer(8), mediaType: "text/html" } },
			{ url: "https://example.com/b" },
		];

		const result = await savePages(queue, pages);

		expect(result.saved).toBe(2);
		expect(result.pendingRetry).toBe(0);
		expect(storedJobs(jobs)).toEqual([]);
		expect(payloads.buffers.size).toBe(0);
		expect(scheduler.cancels).toBeGreaterThan(0);
	});

	it("keeps the first pass in maxItems-sized chunks", async () => {
		const { queue, session } = createQueue();

		const result = await savePages(queue, urlOnlyPages(45));

		expect(session.chunks.map((chunk) => chunk.length)).toEqual([20, 20, 5]);
		expect(result.saved).toBe(45);
	});

	it("keeps a server-failed page queued with backoff and reports it as retrying", async () => {
		const { queue, jobs, scheduler } = createQueue({
			respond: (chunk) => ({
				saved: chunk.length - 1,
				queued: 0,
				skipped: 0,
				failed: 1,
				tooBig: [],
				skippedUrls: [],
				results: chunk.map((page, index) => ({
					url: page.url,
					outcome: index === 0 ? ("failed" as const) : ("created" as const),
				})),
			}),
		});

		const result = await savePages(queue, urlOnlyPages(3));

		expect(result.saved).toBe(2);
		expect(result.failed).toBe(0);
		expect(result.pendingRetry).toBe(1);
		const remaining = storedJobs(jobs);
		expect(remaining.map((job) => [job.url, job.attempts])).toEqual([
			["https://example.com/tab-0", 1],
		]);
		expect(scheduler.wakes).toEqual([scheduler.time + 60_000]);
	});

	it("counts merged pages from the server results", async () => {
		const { queue } = createQueue({
			respond: (chunk) => ({
				saved: chunk.length,
				queued: 0,
				skipped: 0,
				failed: 0,
				tooBig: [],
				skippedUrls: [],
				results: chunk.map((page, index) => ({
					url: page.url,
					outcome: index === 0 ? ("merged" as const) : ("created" as const),
				})),
			}),
		});

		const result = await savePages(queue, urlOnlyPages(2));

		expect(result.alreadySaved).toBe(1);
		expect(result.saved).toBe(2);
	});

	it("retries every page of a chunk the server answered without per-page results", async () => {
		const { queue, jobs } = createQueue({
			respond: (chunk) => ({
				saved: chunk.length,
				queued: 0,
				skipped: 0,
				failed: 0,
				tooBig: [],
				skippedUrls: [],
			}),
		});

		const result = await savePages(queue, urlOnlyPages(3));

		expect(result.pendingRetry).toBe(3);
		expect(storedJobs(jobs).map((job) => job.attempts)).toEqual([1, 1, 1]);
	});

	it("keeps a fresh window's summary intact when an alarm resume lands mid-admission", async () => {
		const { queue, scheduler } = createQueue();

		scheduler.time += 60_000;
		const [result, resumed] = await Promise.all([
			savePages(queue, urlOnlyPages(3)),
			queue.resume(),
		]);

		expect(result.saved).toBe(3);
		expect(passReport(resumed).drained).toBe(false);
	});

	it("reschedules a whole chunk when its request fails and retries it on the next resume", async () => {
		let failFirst = true;
		const { queue, jobs, scheduler } = createQueue({
			respond: (chunk) => {
				if (failFirst) {
					failFirst = false;
					throw new Error("boom");
				}
				return allCreated(chunk);
			},
		});

		const first = await savePages(queue, urlOnlyPages(2));

		expect(first.saved).toBe(0);
		expect(first.pendingRetry).toBe(2);
		expect(storedJobs(jobs)).toHaveLength(2);

		scheduler.time += 60_000;
		const resumed = passReport(await queue.resume());

		expect(storedJobs(jobs)).toEqual([]);
		expect(resumed).toMatchObject({ drained: true, saved: 2, pendingRetry: 0 });
	});

	it("supersedes an earlier job for the same url and drops its stored bytes", async () => {
		const { queue, jobs, payloads } = createQueue({
			respond: (chunk) => ({
				saved: 0,
				queued: 0,
				skipped: 0,
				failed: chunk.length,
				tooBig: [],
				skippedUrls: [],
				results: chunk.map((page) => ({ url: page.url, outcome: "failed" as const })),
			}),
		});
		const page: BulkSavePage = {
			url: "https://example.com/a",
			content: { bytes: new ArrayBuffer(4), mediaType: "text/html" },
		};

		await savePages(queue, [page]);
		expect(storedJobs(jobs)).toHaveLength(1);
		expect(payloads.buffers.size).toBe(1);

		await savePages(queue, [page]);

		const remaining = storedJobs(jobs);
		expect(remaining).toHaveLength(1);
		expect(remaining.map((job) => job.attempts)).toEqual([1]);
		expect(payloads.buffers.size).toBe(1);
	});

	it("excludes still-pending leftovers from an earlier window's save from the fresh summary", async () => {
		let fail = true;
		const { queue, jobs } = createQueue({
			respond: (chunk) => {
				if (fail) {
					fail = false;
					throw new Error("boom");
				}
				return allCreated(chunk);
			},
		});

		await savePages(queue, [{ url: "https://example.com/old" }]);
		expect(storedJobs(jobs)).toHaveLength(1);

		const second = await savePages(queue, [{ url: "https://example.com/new" }]);

		expect(second.saved).toBe(1);
		expect(second.pendingRetry).toBe(0);
		expect(storedJobs(jobs).map((job) => job.url)).toEqual(["https://example.com/old"]);
	});

	it("rejects a 401 on the first chunk and purges the persisted window", async () => {
		const { queue, jobs, payloads, scheduler } = createQueue({
			respond: () => {
				throw new UnauthorizedError();
			},
		});

		await expect(
			savePages(queue, [
					{ url: "https://example.com/a", content: { bytes: new ArrayBuffer(4), mediaType: "text/html" } },
				]),
		).rejects.toBeInstanceOf(UnauthorizedError);
		expect(storedJobs(jobs)).toEqual([]);
		expect(payloads.buffers.size).toBe(0);
		expect(scheduler.cancels).toBeGreaterThan(0);
	});

	it("resolves the partial summary when the session dies after progress, naming the purged pages", async () => {
		let call = 0;
		const { queue, jobs } = createQueue({
			respond: (chunk) => {
				call += 1;
				if (call === 1) return allCreated(chunk);
				throw new UnauthorizedError();
			},
		});

		const result = await savePages(queue, urlOnlyPages(45));

		expect(result.saved).toBe(20);
		expect(result.failed).toBe(25);
		expect(result.unauthorized).toBe(true);
		expect(result.failedUrls).toHaveLength(25);
		expect(storedJobs(jobs)).toEqual([]);
	});

	it("rejects when opening the session finds no living session, purging the window", async () => {
		const { queue, jobs } = createQueue({
			openSession: async () => {
				throw new UnauthorizedError();
			},
		});

		await expect(savePages(queue, urlOnlyPages(1))).rejects.toBeInstanceOf(
			UnauthorizedError,
		);
		expect(storedJobs(jobs)).toEqual([]);
	});

	it("sends a job whose stored bytes were evicted as a URL-only save", async () => {
		const { queue, session, payloads } = createQueue();
		payloads.getAll = async () => new Map();

		const result = await savePages(queue, [
				{ url: "https://example.com/a", content: { bytes: new ArrayBuffer(4), mediaType: "text/html" } },
			]);

		expect(result.saved).toBe(1);
		const sent = session.chunks[0];
		assert(sent, "the degraded page still rides in one chunk");
		expect(sent).toEqual([{ url: "https://example.com/a", title: undefined }]);
	});
});

describe("initBulkSaveQueue resume", () => {
	it("does nothing when no job is due", async () => {
		const { queue, session } = createQueue();

		const resumed = passReport(await queue.resume());

		expect(session.openCount()).toBe(0);
		expect(resumed.drained).toBe(false);
	});

	it("abandons a job after its attempts exhaust and reports its url", async () => {
		const { queue, jobs, scheduler, reports } = createQueue({
			respond: (chunk) => ({
				saved: 0,
				queued: 0,
				skipped: 0,
				failed: chunk.length,
				tooBig: [],
				skippedUrls: [],
				results: chunk.map((page) => ({ url: page.url, outcome: "failed" as const })),
			}),
		});

		await savePages(queue, [{ url: "https://example.com/doomed" }]);
		let last: ResumeOutcome = { kind: "unauthorized" };
		for (let round = 0; round < 7; round += 1) {
			scheduler.time += 22_000_000;
			last = await queue.resume();
		}

		expect(storedJobs(jobs)).toEqual([]);
		expect(passReport(last).terminalUrls).toEqual(["https://example.com/doomed"]);
		expect(reports.at(-1)).toEqual([
			{ kind: "failed", jobId: expect.any(String), url: "https://example.com/doomed", unauthorized: false },
		]);
	});

	it("reports both the settled and the still-retrying counts when a retry pass lands partially", async () => {
		let seeding = true;
		const { queue, scheduler } = createQueue({
			respond: (chunk) => {
				if (seeding) throw new Error("boom");
				return {
					saved: chunk.length - 1,
					queued: 0,
					skipped: 0,
					failed: 1,
					tooBig: [],
					skippedUrls: [],
					results: chunk.map((page, index) => ({
						url: page.url,
						outcome: index === 0 ? ("failed" as const) : ("created" as const),
					})),
				};
			},
		});

		await savePages(queue, urlOnlyPages(2));
		seeding = false;
		scheduler.time += 60_000;
		const resumed = passReport(await queue.resume());

		expect(resumed).toMatchObject({ drained: true, saved: 1, pendingRetry: 1 });
	});

	it("reports a retry pass that failed again as nothing saved", async () => {
		const { queue, scheduler } = createQueue({
			respond: () => {
				throw new Error("still down");
			},
		});

		await savePages(queue, urlOnlyPages(1));
		scheduler.time += 60_000;
		const resumed = passReport(await queue.resume());

		expect(resumed).toMatchObject({ drained: true, saved: 0, pendingRetry: 1, terminalUrls: [] });
	});

	it("reports signed-out when the session dies mid-resume after progress", async () => {
		let seeding = true;
		let call = 0;
		const { queue, scheduler, jobs } = createQueue({
			respond: (chunk) => {
				if (seeding) throw new Error("boom");
				call += 1;
				if (call === 1) return allCreated(chunk);
				throw new UnauthorizedError();
			},
		});

		await savePages(queue, urlOnlyPages(45));
		seeding = false;
		scheduler.time += 60_000;
		const resumed = passReport(await queue.resume());

		expect(resumed.unauthorized).toBe(true);
		expect(storedJobs(jobs)).toEqual([]);
	});

	it("answers signed-out when the session is gone at resume time", async () => {
		let fail = true;
		const { queue, scheduler, jobs } = createQueue({
			respond: () => {
				if (fail) {
					fail = false;
					throw new Error("boom");
				}
				throw new UnauthorizedError();
			},
		});

		await savePages(queue, urlOnlyPages(1));
		scheduler.time += 60_000;
		const resumed = await queue.resume();

		expect(resumed).toEqual({ kind: "unauthorized" });
		expect(storedJobs(jobs)).toEqual([]);
	});

	it("shares one in-flight pass between concurrent resume calls", async () => {
		let seeding = true;
		const { queue, scheduler, session } = createQueue({
			respond: (chunk) => {
				if (seeding) throw new Error("boom");
				return allCreated(chunk);
			},
		});

		await savePages(queue, urlOnlyPages(1));
		seeding = false;
		scheduler.time += 60_000;
		await Promise.all([queue.resume(), queue.resume()]);

		expect(session.openCount()).toBe(2);
	});
});

describe("initBulkSaveQueue purge", () => {
	it("clears jobs, bytes and the wake", async () => {
		const { queue, jobs, payloads, scheduler } = createQueue({
			respond: () => {
				throw new Error("down");
			},
		});

		await savePages(queue, [
				{ url: "https://example.com/a", content: { bytes: new ArrayBuffer(4), mediaType: "text/html" } },
			]);
		expect(storedJobs(jobs)).toHaveLength(1);

		await queue.purge();

		expect(storedJobs(jobs)).toEqual([]);
		expect(payloads.buffers.size).toBe(0);
		expect(scheduler.cancels).toBeGreaterThan(0);
	});

	it("drops stored records a previous build wrote in another shape", async () => {
		const { queue, jobs, session } = createQueue();
		jobs.data = [{ garbage: true }, "nonsense"];

		await queue.resume();

		expect(session.openCount()).toBe(0);
	});

	it("treats a store holding something other than a list as empty", async () => {
		const { queue, jobs, session } = createQueue();
		jobs.data = "not-a-list";

		await queue.resume();

		expect(session.openCount()).toBe(0);
	});

	it("logs and resolves when the purge itself fails", async () => {
		const { queue, payloads } = createQueue();
		payloads.clear = async () => {
			throw new Error("indexeddb gone");
		};

		await expect(queue.purge()).resolves.toBeUndefined();
	});

	it("logs and resolves when the job store itself fails during a resume", async () => {
		const { queue, jobs } = createQueue();
		jobs.read = async () => {
			throw new Error("storage gone");
		};

		const resumed = passReport(await queue.resume());

		expect(resumed.drained).toBe(false);
	});

	it("reschedules the due jobs and re-arms the wake when the server is unreachable", async () => {
		const { queue, jobs, scheduler } = createQueue({
			openSession: async () => {
				throw new Error("network down");
			},
		});
		jobs.data = [
			{ id: "j1", url: "https://example.com/a", attempts: 1, nextAttemptAt: 0, createdAt: 0 },
		];

		const resumed = passReport(await queue.resume());

		expect(resumed).toMatchObject({ drained: true, saved: 0, pendingRetry: 1 });
		const remaining = storedJobs(jobs);
		expect(remaining.map((job) => job.attempts)).toEqual([2]);
		expect(scheduler.wakes).toEqual([scheduler.time + 300_000]);
	});

	it("folds jobs an earlier chunk rescheduled into the failures when a later chunk hits a 401", async () => {
		let call = 0;
		const { queue, jobs } = createQueue({
			respond: (chunk) => {
				call += 1;
				if (call === 1) return allCreated(chunk);
				if (call === 2) throw new Error("boom");
				throw new UnauthorizedError();
			},
		});

		const result = await savePages(queue, urlOnlyPages(45));

		expect(result.saved).toBe(20);
		expect(result.pendingRetry).toBe(0);
		expect(result.failed).toBe(25);
		expect(result.failedUrls).toHaveLength(25);
		expect(result.unauthorized).toBe(true);
		expect(storedJobs(jobs)).toEqual([]);
	});
});


it("settles queued wrappers without scheduling browser retries", async () => {
	const { queue, jobs } = createQueue({ respond: (chunk) => ({ saved: chunk.length, queued: chunk.length, skipped: 0, failed: 0, tooBig: [], skippedUrls: [], results: chunk.map((page) => ({ url: page.url, outcome: "created", code: "queued" })) }) });
	const result = await savePages(queue, urlOnlyPages(21));
	expect(result).toMatchObject({ saved: 0, queued: 21, failed: 0, pendingRetry: 0 });
	expect(storedJobs(jobs)).toEqual([]);
});

describe("initBulkSaveQueue progress", () => {
	it("hands every admitted job to the caller, before any of them is reported sending", async () => {
		const order: string[] = [];
		const jobs = createFakeJobStore();
		const session = createFakeSession(allCreated);
		const queue = initBulkSaveQueue({
			jobs,
			payloads: createFakePayloads(),
			scheduler: createFakeScheduler(),
			openSession: session.openSession,
			progress: async (events) => {
				order.push(...events.map((event) => `${event.kind}:${event.url}`));
			},
			logger: HutchLogger.from(noopLogger),
		});

		await queue.savePages({
			pages: [{ url: "https://example.com/a" }],
			admitted: async (admitted) => {
				order.push(...admitted.map((job) => `admitted:${job.url}`));
			},
		});

		expect(order).toEqual([
			"admitted:https://example.com/a",
			"sending:https://example.com/a",
			"settled:https://example.com/a",
		]);
	});

	it("names the job a fresh admission supersedes for the same url", async () => {
		const { queue, jobs } = createQueue({
			respond: () => {
				throw new Error("down");
			},
		});
		await savePages(queue, [{ url: "https://example.com/a" }]);
		const [older] = storedJobs(jobs);
		assert(older, "the failed save left a job");
		const admittedCalls: AdmittedJob[][] = [];

		await savePages(queue, [{ url: "https://example.com/a" }, { url: "https://example.com/b" }], admittedCalls);

		const [fresh] = storedJobs(jobs).filter((job) => job.url === "https://example.com/a");
		assert(fresh, "the fresh admission replaced the older job");
		expect(admittedCalls).toEqual([
			[
				{ url: "https://example.com/a", jobId: fresh.id, supersededJobIds: [older.id] },
				{ url: "https://example.com/b", jobId: expect.any(String), supersededJobIds: [] },
			],
		]);
	});

	it("reports each chunk sending with its job ids, naming a page sent link-only for its size", async () => {
		const { queue, reports } = createQueue();
		const admittedCalls: AdmittedJob[][] = [];

		await savePages(
			queue,
			[
				{ url: "https://example.com/huge", content: { bytes: new ArrayBuffer(5_000_000), mediaType: "text/html" } },
				{ url: "https://example.com/small" },
			],
			admittedCalls,
		);

		const ids = (admittedCalls[0] ?? []).map((job) => job.jobId);
		expect(reports[0]).toEqual([
			{ kind: "sending", jobId: ids[0], url: "https://example.com/huge", tooBigMb: 4.8 },
			{ kind: "sending", jobId: ids[1], url: "https://example.com/small", tooBigMb: null },
		]);
	});

	it("logs a rejected sending report and still saves the chunk", async () => {
		const errors: string[] = [];
		const jobs = createFakeJobStore();
		const queue = initBulkSaveQueue({
			jobs,
			payloads: createFakePayloads(),
			scheduler: createFakeScheduler(),
			openSession: createFakeSession(allCreated).openSession,
			progress: async (events) => {
				if (events.some((event) => event.kind === "sending")) throw new Error("store down");
			},
			logger: HutchLogger.from({
				...noopLogger,
				error: (...args) => errors.push(String(args[0])),
			}),
		});

		const report = await savePages(queue, [{ url: "https://example.com/a" }]);

		expect(errors).toEqual(["[bulk-save-queue] reporting a chunk sending failed"]);
		expect(report.saved).toBe(1);
		expect(storedJobs(jobs)).toEqual([]);
	});

	it("settles each page with the outcome the server named for it", async () => {
		const { queue, reports } = createQueue({
			respond: () => ({
				saved: 3,
				queued: 1,
				skipped: 2,
				failed: 0,
				tooBig: [{ url: "https://example.com/created", mb: 9 }],
				skippedUrls: [
					{ url: "https://example.com/skipped", code: "unsupported_scheme", message: "Not a page" },
					{ url: "https://example.com/quiet", code: "blocked" },
				],
				results: [
					{ url: "https://example.com/created", outcome: "created" },
					{ url: "https://example.com/merged", outcome: "merged" },
					{ url: "https://example.com/queued", outcome: "created", code: "queued" },
					{ url: "https://example.com/skipped", outcome: "skipped", code: "unsupported_scheme" },
					{ url: "https://example.com/quiet", outcome: "skipped", code: "blocked" },
				],
			}),
		});

		await savePages(
			queue,
			["created", "merged", "queued", "skipped", "quiet"].map((name) => ({ url: `https://example.com/${name}` })),
		);

		expect(reports[1]?.map((event) => (event.kind === "settled" ? [event.url, event.outcome, event.tooBigMb] : []))).toEqual([
			["https://example.com/created", { state: "saved" }, 9],
			["https://example.com/merged", { state: "already-saved" }, null],
			["https://example.com/queued", { state: "queued" }, null],
			["https://example.com/skipped", { state: "skipped", code: "unsupported_scheme", message: "Not a page" }, null],
			["https://example.com/quiet", { state: "skipped", code: "blocked", message: null }, null],
		]);
	});

	it("retries a page the server skipped without naming why", async () => {
		const { queue, jobs } = createQueue({
			respond: (chunk) => ({
				saved: 0,
				queued: 0,
				skipped: 1,
				failed: 0,
				tooBig: [],
				skippedUrls: [],
				results: chunk.map((page) => ({ url: page.url, outcome: "skipped" as const, code: "blocked" })),
			}),
		});

		const result = await savePages(queue, urlOnlyPages(1));

		expect(result.pendingRetry).toBe(1);
		expect(storedJobs(jobs)).toHaveLength(1);
	});

	it("reports a failed chunk's pages retrying", async () => {
		const { queue, reports } = createQueue({
			respond: () => {
				throw new Error("boom");
			},
		});

		await savePages(queue, [{ url: "https://example.com/a" }]);

		expect(reports[1]).toEqual([{ kind: "retrying", jobId: expect.any(String), url: "https://example.com/a" }]);
	});

	it("reports every outcome before the job store or the stored bytes change", async () => {
		const log: string[] = [];
		const jobs = createFakeJobStore();
		const write = jobs.write;
		jobs.write = async (written) => {
			log.push("jobs.write");
			await write(written);
		};
		const payloads = createFakePayloads();
		const removeAll = payloads.removeAll;
		payloads.removeAll = async (ids) => {
			log.push("payloads.removeAll");
			await removeAll(ids);
		};
		let call = 0;
		const session = createFakeSession((chunk) => {
			call += 1;
			if (call === 1) return allCreated(chunk);
			throw new Error("boom");
		});
		const queue = initBulkSaveQueue({
			jobs,
			payloads,
			scheduler: createFakeScheduler(),
			openSession: session.openSession,
			progress: async (events) => {
				const kinds = new Set(events.map((event) => event.kind));
				kinds.delete("sending");
				log.push(...kinds);
			},
			logger: HutchLogger.from(noopLogger),
		});

		await savePages(queue, urlOnlyPages(21));

		const admission = log.indexOf("jobs.write");
		expect(log.slice(admission + 1)).toEqual([
			"settled",
			"payloads.removeAll",
			"jobs.write",
			"retrying",
			"payloads.removeAll",
			"jobs.write",
		]);
	});

	it("reports every job failed signed-out before a purge clears them", async () => {
		const { queue, jobs, reports } = createQueue({
			respond: () => {
				throw new Error("down");
			},
		});
		await savePages(queue, [{ url: "https://example.com/a" }]);
		const [held] = storedJobs(jobs);
		assert(held, "the failed save left a job");

		await queue.purge();

		expect(reports.at(-1)).toEqual([{ kind: "failed", jobId: held.id, url: "https://example.com/a", unauthorized: true }]);
		expect(storedJobs(jobs)).toEqual([]);
	});

	it("lists the queued jobs and which of them are due", async () => {
		const { queue, jobs, scheduler } = createQueue();
		jobs.data = [
			{ id: "due", url: "https://example.com/a", attempts: 1, nextAttemptAt: scheduler.time, createdAt: 0 },
			{ id: "later", url: "https://example.com/b", attempts: 1, nextAttemptAt: scheduler.time + 1, createdAt: 0 },
		];

		expect(await queue.pendingJobs()).toEqual([
			{ url: "https://example.com/a", jobId: "due", dueNow: true },
			{ url: "https://example.com/b", jobId: "later", dueNow: false },
		]);
	});
});

describe("initBulkSaveQueue withdraw", () => {
	it("removes the url's job and bytes and moves the wake to what is left", async () => {
		const { queue, jobs, payloads, scheduler } = createQueue();
		jobs.data = [
			{ id: "a", url: "https://example.com/a", mediaType: "text/html", attempts: 1, nextAttemptAt: 5_000, createdAt: 0 },
			{ id: "b", url: "https://example.com/b", attempts: 1, nextAttemptAt: 9_000, createdAt: 0 },
		];
		payloads.buffers.set("a", new ArrayBuffer(4));

		await queue.withdraw("https://example.com/a");

		expect(storedJobs(jobs).map((job) => job.id)).toEqual(["b"]);
		expect(payloads.buffers.size).toBe(0);
		expect(scheduler.wakes).toEqual([9_000]);
	});

	it("cancels the wake once nothing is left", async () => {
		const { queue, jobs, scheduler } = createQueue();
		jobs.data = [{ id: "a", url: "https://example.com/a", attempts: 1, nextAttemptAt: 5_000, createdAt: 0 }];

		await queue.withdraw("https://example.com/a");

		expect(storedJobs(jobs)).toEqual([]);
		expect(scheduler.cancels).toBe(1);
	});

	it("leaves every job in place for a url it does not hold", async () => {
		const { queue, jobs } = createQueue();
		jobs.data = [{ id: "a", url: "https://example.com/a", attempts: 1, nextAttemptAt: 5_000, createdAt: 0 }];

		await queue.withdraw("https://example.com/other");

		expect(storedJobs(jobs).map((job) => job.id)).toEqual(["a"]);
	});

	it("waits for a pass in flight, so it removes the job that pass rescheduled", async () => {
		let release: () => void = () => {};
		const { queue, jobs } = createQueue({
			respond: () =>
				new Promise((_resolve, reject) => {
					release = () => reject(new Error("boom"));
				}),
		});

		const saving = savePages(queue, [{ url: "https://example.com/a" }]);
		const withdrawing = queue.withdraw("https://example.com/a");
		await new Promise((resolve) => setTimeout(resolve, 0));
		release();
		await saving;
		await withdrawing;

		expect(storedJobs(jobs)).toEqual([]);
	});
});
