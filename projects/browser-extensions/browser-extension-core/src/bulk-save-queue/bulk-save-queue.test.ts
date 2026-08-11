import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { BulkSavePage } from "../reading-list/reading-list.types";
import type { BulkChunkSummary, BulkSaveSession } from "../reading-list/siren-reading-list";
import { UnauthorizedError } from "../auth/unauthorized-error";
import { initBulkSaveQueue, type BulkSaveJobStore } from "./bulk-save-queue";
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
	const blobs = new Map<string, Blob>();
	return {
		blobs,
		put: async ({ id, blob }: { id: string; blob: Blob }) => {
			blobs.set(id, blob);
		},
		get: async (id: string) => blobs.get(id),
		remove: async (id: string) => {
			blobs.delete(id);
		},
		clear: async () => {
			blobs.clear();
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
	const notifications: { title: string; message: string }[] = [];
	const queue = initBulkSaveQueue({
		jobs,
		payloads,
		scheduler,
		openSession: overrides?.openSession ?? session.openSession,
		notify: (notification) => {
			notifications.push(notification);
		},
		logger: HutchLogger.from(noopLogger),
	});
	return { queue, jobs, payloads, scheduler, session, notifications };
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

		const result = await queue.savePages({ pages: [] });

		expect(result).toEqual({
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

		const result = await queue.savePages({ pages });

		expect(result.saved).toBe(2);
		expect(result.pendingRetry).toBe(0);
		expect(storedJobs(jobs)).toEqual([]);
		expect(payloads.blobs.size).toBe(0);
		expect(scheduler.cancels).toBeGreaterThan(0);
	});

	it("keeps the first pass in maxItems-sized chunks", async () => {
		const { queue, session } = createQueue();

		const result = await queue.savePages({ pages: urlOnlyPages(45) });

		expect(session.chunks.map((chunk) => chunk.length)).toEqual([20, 20, 5]);
		expect(result.saved).toBe(45);
	});

	it("keeps a server-failed page queued with backoff and reports it as retrying", async () => {
		const { queue, jobs, scheduler } = createQueue({
			respond: (chunk) => ({
				saved: chunk.length - 1,
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

		const result = await queue.savePages({ pages: urlOnlyPages(3) });

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

		const result = await queue.savePages({ pages: urlOnlyPages(2) });

		expect(result.alreadySaved).toBe(1);
		expect(result.saved).toBe(2);
	});

	it("settles a resultless chunk wholly, counting failures without naming pages it cannot identify", async () => {
		const { queue, jobs } = createQueue({
			respond: (chunk) => ({
				saved: chunk.length - 1,
				skipped: 0,
				failed: 1,
				tooBig: [],
				skippedUrls: [],
			}),
		});

		const result = await queue.savePages({ pages: urlOnlyPages(3) });

		expect(result.saved).toBe(2);
		expect(result.failed).toBe(1);
		expect(result.pendingRetry).toBe(0);
		expect(result.failedUrls).toEqual([]);
		expect(storedJobs(jobs)).toEqual([]);
	});

	it("keeps a fresh window's summary intact when an alarm resume lands mid-admission", async () => {
		const { queue, scheduler, notifications } = createQueue();

		scheduler.time += 60_000;
		const [result] = await Promise.all([
			queue.savePages({ pages: urlOnlyPages(3) }),
			queue.resume(),
		]);

		expect(result.saved).toBe(3);
		expect(notifications).toEqual([]);
	});

	it("reschedules a whole chunk when its request fails and retries it on the next resume", async () => {
		let failFirst = true;
		const { queue, jobs, scheduler, notifications } = createQueue({
			respond: (chunk) => {
				if (failFirst) {
					failFirst = false;
					throw new Error("boom");
				}
				return allCreated(chunk);
			},
		});

		const first = await queue.savePages({ pages: urlOnlyPages(2) });

		expect(first.saved).toBe(0);
		expect(first.pendingRetry).toBe(2);
		expect(storedJobs(jobs)).toHaveLength(2);

		scheduler.time += 60_000;
		await queue.resume();

		expect(storedJobs(jobs)).toEqual([]);
		expect(notifications).toEqual([{ title: "Tabs saved", message: "Saved 2 after retrying" }]);
	});

	it("supersedes an earlier job for the same url and drops its stored bytes", async () => {
		const { queue, jobs, payloads } = createQueue({
			respond: (chunk) => ({
				saved: 0,
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

		await queue.savePages({ pages: [page] });
		expect(storedJobs(jobs)).toHaveLength(1);
		expect(payloads.blobs.size).toBe(1);

		await queue.savePages({ pages: [page] });

		const remaining = storedJobs(jobs);
		expect(remaining).toHaveLength(1);
		expect(remaining.map((job) => job.attempts)).toEqual([1]);
		expect(payloads.blobs.size).toBe(1);
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

		await queue.savePages({ pages: [{ url: "https://example.com/old" }] });
		expect(storedJobs(jobs)).toHaveLength(1);

		const second = await queue.savePages({ pages: [{ url: "https://example.com/new" }] });

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
			queue.savePages({
				pages: [
					{ url: "https://example.com/a", content: { bytes: new ArrayBuffer(4), mediaType: "text/html" } },
				],
			}),
		).rejects.toBeInstanceOf(UnauthorizedError);
		expect(storedJobs(jobs)).toEqual([]);
		expect(payloads.blobs.size).toBe(0);
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

		const result = await queue.savePages({ pages: urlOnlyPages(45) });

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

		await expect(queue.savePages({ pages: urlOnlyPages(1) })).rejects.toBeInstanceOf(
			UnauthorizedError,
		);
		expect(storedJobs(jobs)).toEqual([]);
	});

	it("sends a job whose stored bytes were evicted as a URL-only save", async () => {
		const { queue, session, payloads } = createQueue();
		payloads.get = async () => undefined;

		const result = await queue.savePages({
			pages: [
				{ url: "https://example.com/a", content: { bytes: new ArrayBuffer(4), mediaType: "text/html" } },
			],
		});

		expect(result.saved).toBe(1);
		const sent = session.chunks[0];
		assert(sent, "the degraded page still rides in one chunk");
		expect(sent).toEqual([{ url: "https://example.com/a", title: undefined }]);
	});
});

describe("initBulkSaveQueue resume", () => {
	it("does nothing when no job is due", async () => {
		const { queue, session, notifications } = createQueue();

		await queue.resume();

		expect(session.openCount()).toBe(0);
		expect(notifications).toEqual([]);
	});

	it("abandons a job after its attempts exhaust and notifies with its url", async () => {
		const { queue, jobs, scheduler, notifications } = createQueue({
			respond: (chunk) => ({
				saved: 0,
				skipped: 0,
				failed: chunk.length,
				tooBig: [],
				skippedUrls: [],
				results: chunk.map((page) => ({ url: page.url, outcome: "failed" as const })),
			}),
		});

		await queue.savePages({ pages: [{ url: "https://example.com/doomed" }] });
		for (let round = 0; round < 7; round += 1) {
			scheduler.time += 22_000_000;
			await queue.resume();
		}

		expect(storedJobs(jobs)).toEqual([]);
		const last = notifications.at(-1);
		expect(last).toEqual({
			title: "Couldn't save some tabs",
			message: "1 tabs couldn't be saved after retrying.\nhttps://example.com/doomed",
		});
	});

	it("names both the settled and the still-retrying counts when a retry pass lands partially", async () => {
		let seeding = true;
		const { queue, scheduler, notifications } = createQueue({
			respond: (chunk) => {
				if (seeding) throw new Error("boom");
				return {
					saved: chunk.length - 1,
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

		await queue.savePages({ pages: urlOnlyPages(2) });
		seeding = false;
		scheduler.time += 60_000;
		await queue.resume();

		expect(notifications).toEqual([
			{ title: "Tabs saved", message: "Saved 1 after retrying · Retrying 1" },
		]);
	});

	it("stays quiet when a retry pass fails again, so each backoff round does not toast", async () => {
		const { queue, scheduler, notifications } = createQueue({
			respond: () => {
				throw new Error("still down");
			},
		});

		await queue.savePages({ pages: urlOnlyPages(1) });
		scheduler.time += 60_000;
		await queue.resume();

		expect(notifications).toEqual([]);
	});

	it("notifies signed-out when the session dies mid-resume after progress", async () => {
		let seeding = true;
		let call = 0;
		const { queue, scheduler, notifications, jobs } = createQueue({
			respond: (chunk) => {
				if (seeding) throw new Error("boom");
				call += 1;
				if (call === 1) return allCreated(chunk);
				throw new UnauthorizedError();
			},
		});

		await queue.savePages({ pages: urlOnlyPages(45) });
		seeding = false;
		scheduler.time += 60_000;
		await queue.resume();

		expect(notifications).toEqual([
			{ title: "Not signed in", message: "Sign in to Readplace and run Save all tabs again." },
		]);
		expect(storedJobs(jobs)).toEqual([]);
	});

	it("notifies signed-out when the session is gone at resume time", async () => {
		let fail = true;
		const { queue, scheduler, notifications, jobs } = createQueue({
			respond: () => {
				if (fail) {
					fail = false;
					throw new Error("boom");
				}
				throw new UnauthorizedError();
			},
		});

		await queue.savePages({ pages: urlOnlyPages(1) });
		scheduler.time += 60_000;
		await queue.resume();

		expect(notifications).toEqual([
			{ title: "Not signed in", message: "Sign in to Readplace and run Save all tabs again." },
		]);
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

		await queue.savePages({ pages: urlOnlyPages(1) });
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

		await queue.savePages({
			pages: [
				{ url: "https://example.com/a", content: { bytes: new ArrayBuffer(4), mediaType: "text/html" } },
			],
		});
		expect(storedJobs(jobs)).toHaveLength(1);

		await queue.purge();

		expect(storedJobs(jobs)).toEqual([]);
		expect(payloads.blobs.size).toBe(0);
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
		const { queue, jobs, notifications } = createQueue();
		jobs.read = async () => {
			throw new Error("storage gone");
		};

		await expect(queue.resume()).resolves.toBeUndefined();
		expect(notifications).toEqual([]);
	});

	it("reschedules the due jobs and re-arms the wake when the server is unreachable", async () => {
		const { queue, jobs, scheduler, notifications } = createQueue({
			openSession: async () => {
				throw new Error("network down");
			},
		});
		jobs.data = [
			{ id: "j1", url: "https://example.com/a", attempts: 1, nextAttemptAt: 0, createdAt: 0 },
		];

		await expect(queue.resume()).resolves.toBeUndefined();

		expect(notifications).toEqual([]);
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

		const result = await queue.savePages({ pages: urlOnlyPages(45) });

		expect(result.saved).toBe(20);
		expect(result.pendingRetry).toBe(0);
		expect(result.failed).toBe(25);
		expect(result.failedUrls).toHaveLength(25);
		expect(result.unauthorized).toBe(true);
		expect(storedJobs(jobs)).toEqual([]);
	});
});
