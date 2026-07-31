import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { UnauthorizedError } from "../auth/unauthorized-error";
import type { CapturedContent } from "../capture-active-tab-bytes";
import type { UploadContent, UploadContentResult } from "../reading-list/reading-list.types";
import { type UploadJob, parseUploadJobs } from "./upload-job";
import { initUploadQueue } from "./upload-queue";
import type { CaptureForJob, PayloadStore, UploadJobStore } from "./upload-queue.types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function bytesOf(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer;
}

function capturedHtml(text = "<html>page</html>"): CapturedContent {
	return { bytes: bytesOf(text), mediaType: "text/html" };
}

function capturingJob(job: { id: string; url: string; createdAt: number }): UploadJob {
	return {
		...job,
		state: "capturing",
		attempts: 0,
		nextAttemptAt: job.createdAt,
	};
}

interface Harness {
	queue: ReturnType<typeof initUploadQueue>;
	storage: { value: unknown };
	payloads: Map<string, Blob>;
	uploads: { url: string; title?: string; bytes: number; mediaType: string }[];
	captures: { url: string; tabId?: number }[];
	wakes: number[];
	getCancelCount: () => number;
	setNow: (value: number) => void;
	jobs: () => UploadJob[];
	warns: string[];
	errors: string[];
}

function createHarness(
	options: {
		now?: number;
		capture?: CaptureForJob;
		upload?: UploadContent;
		jobStore?: Partial<UploadJobStore>;
		payloadStore?: Partial<PayloadStore>;
	} = {},
): Harness {
	const storage: { value: unknown } = { value: undefined };
	const payloads = new Map<string, Blob>();
	const uploads: Harness["uploads"] = [];
	const captures: Harness["captures"] = [];
	const wakes: number[] = [];
	const warns: string[] = [];
	const errors: string[] = [];
	let cancelCount = 0;
	let now = options.now ?? 1_000_000;

	const jobStore: UploadJobStore = {
		read: async () => storage.value,
		write: async (jobs) => {
			storage.value = JSON.parse(JSON.stringify(jobs));
		},
		...options.jobStore,
	};

	const payloadStore: PayloadStore = {
		put: async ({ id, blob }) => {
			payloads.set(id, blob);
		},
		get: async (id) => payloads.get(id),
		remove: async (id) => {
			payloads.delete(id);
		},
		clear: async () => {
			payloads.clear();
		},
		...options.payloadStore,
	};

	const queue = initUploadQueue({
		jobs: jobStore,
		payloads: payloadStore,
		scheduler: {
			now: () => now,
			wakeAt: async (timestamp) => {
				wakes.push(timestamp);
			},
			cancel: async () => {
				cancelCount += 1;
			},
		},
		capture:
			options.capture ??
			(async (target) => {
				captures.push(target);
				return capturedHtml();
			}),
		uploadContent:
			options.upload ??
			(async ({ url, title, content }) => {
				uploads.push({ url, title, bytes: content.bytes.byteLength, mediaType: content.mediaType });
				return { ok: true };
			}),
		logger: HutchLogger.from({
			...noopLogger,
			warn: (...args) => warns.push(String(args[0])),
			error: (...args) => errors.push(String(args[0])),
		}),
	});

	return {
		queue,
		storage,
		payloads,
		uploads,
		captures,
		wakes,
		getCancelCount: () => cancelCount,
		setNow: (value) => {
			now = value;
		},
		jobs: () => parseUploadJobs(storage.value),
		warns,
		errors,
	};
}

describe("initUploadQueue enqueue", () => {
	it("captures the page and uploads it against the URL the link save used", async () => {
		const harness = createHarness();

		await harness.queue.enqueue({
			url: "https://example.com/a",
			title: "A",
			tabId: 7,
		});

		expect(harness.captures).toEqual([{ url: "https://example.com/a", tabId: 7 }]);
		expect(harness.uploads).toEqual([
			{
				url: "https://example.com/a",
				title: "A",
				bytes: bytesOf("<html>page</html>").byteLength,
				mediaType: "text/html",
			},
		]);
		expect(harness.jobs()).toEqual([]);
		expect(harness.payloads.size).toBe(0);
		expect(harness.getCancelCount()).toBe(1);
	});

	it("records a resumable job before the capture starts so a worker death mid-capture is recoverable", async () => {
		let observed: UploadJob[] = [];
		const harness = createHarness({
			capture: async () => {
				observed = parseUploadJobs(harness.storage.value);
				return capturedHtml();
			},
		});

		await harness.queue.enqueue({ url: "https://example.com/a", title: "A", tabId: 7 });

		expect(observed).toHaveLength(1);
		expect(observed[0].state).toBe("capturing");
		expect(observed[0].url).toBe("https://example.com/a");
	});

	it("supersedes an earlier job for the same URL, dropping its captured bytes", async () => {
		const harness = createHarness({
			upload: async () => {
				throw new Error("server down");
			},
		});

		await harness.queue.enqueue({ url: "https://example.com/a", title: "First" });
		const first = harness.jobs()[0];
		await harness.queue.enqueue({ url: "https://example.com/a", title: "Second" });

		const jobs = harness.jobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0].title).toBe("Second");
		expect(harness.payloads.has(first.id)).toBe(false);
	});

	it("abandons a page that can no longer be captured", async () => {
		const harness = createHarness({ capture: async () => undefined });

		await harness.queue.enqueue({ url: "https://example.com/a" });

		expect(harness.uploads).toEqual([]);
		expect(harness.jobs()).toEqual([]);
		expect(harness.warns.some((line) => line.includes("can no longer be captured"))).toBe(true);
	});

	it("logs and keeps serving when recording the job fails", async () => {
		const harness = createHarness({
			jobStore: {
				write: async () => {
					throw new Error("storage full");
				},
			},
		});

		await harness.queue.enqueue({ url: "https://example.com/a" });

		expect(harness.errors.some((line) => line.includes("failed to record"))).toBe(true);
		expect(harness.uploads).toEqual([]);
	});
});

describe("initUploadQueue resume", () => {
	/** A dead worker runs no catch, so it leaves the `capturing` record enqueue
	 * wrote before the capture began — seeded here directly, rather than by
	 * throwing, which is a failed attempt and is backed off instead. */
	it("re-captures a job whose worker died mid-capture", async () => {
		const recaptured: { url: string; tabId?: number }[] = [];
		const resumed = createHarness({
			capture: async (target) => {
				recaptured.push(target);
				return capturedHtml();
			},
		});
		resumed.storage.value = [
			{ ...capturingJob({ id: "a", url: "https://example.com/a", createdAt: 1_000 }), tabId: 3 },
		];

		await resumed.queue.resume();

		expect(recaptured).toEqual([{ url: "https://example.com/a", tabId: 3 }]);
		expect(resumed.uploads).toHaveLength(1);
	});

	it("runs due jobs oldest first", async () => {
		const harness = createHarness({
			upload: async ({ url, content }) => {
				harness.uploads.push({ url, bytes: content.bytes.byteLength, mediaType: content.mediaType });
				return { ok: true };
			},
		});
		harness.setNow(1_000);
		await harness.queue.enqueue({ url: "https://example.com/older" });
		harness.setNow(2_000);
		await harness.queue.enqueue({ url: "https://example.com/newer" });

		expect(harness.uploads.map((upload) => upload.url)).toEqual([
			"https://example.com/older",
			"https://example.com/newer",
		]);
	});

	it("leaves a job alone until its next attempt is due", async () => {
		let failNext = true;
		const harness = createHarness({
			upload: async () => {
				if (failNext) throw new Error("server down");
				return { ok: true };
			},
		});
		await harness.queue.enqueue({ url: "https://example.com/a" });
		failNext = false;
		harness.uploads.length = 0;

		await harness.queue.resume();

		expect(harness.uploads).toEqual([]);
		expect(harness.jobs()).toHaveLength(1);
	});

	it("shares one pass between concurrent resumes", async () => {
		const harness = createHarness({
			upload: async () => {
				throw new Error("server down");
			},
		});
		await harness.queue.enqueue({ url: "https://example.com/a" });
		harness.wakes.length = 0;

		await Promise.all([harness.queue.resume(), harness.queue.resume()]);

		expect(harness.wakes).toHaveLength(1);
	});

	it("drops records a previous build wrote in another shape", async () => {
		const harness = createHarness();
		harness.storage.value = [{ id: "x", state: "unknown" }, "not-a-job"];

		await harness.queue.resume();

		expect(harness.jobs()).toEqual([]);
		expect(harness.getCancelCount()).toBe(1);
	});

	it("ignores a stored value that is not a list of jobs", async () => {
		const harness = createHarness();
		harness.storage.value = { jobs: "gone" };

		await harness.queue.resume();

		expect(harness.getCancelCount()).toBe(1);
	});

	it("abandons a ready job whose captured bytes went missing", async () => {
		const harness = createHarness({
			upload: async () => {
				throw new Error("server down");
			},
		});
		await harness.queue.enqueue({ url: "https://example.com/a" });
		harness.payloads.clear();
		harness.setNow(2_000_000);

		await harness.queue.resume();

		expect(harness.jobs()).toEqual([]);
		expect(harness.warns.some((line) => line.includes("captured bytes are gone"))).toBe(true);
	});

	it("logs when the pass itself fails", async () => {
		let reads = 0;
		const harness = createHarness({
			jobStore: {
				read: async () => {
					reads += 1;
					if (reads > 1) throw new Error("storage unavailable");
					return undefined;
				},
			},
		});

		await harness.queue.resume();
		await harness.queue.resume();

		expect(harness.errors.some((line) => line.includes("resume failed"))).toBe(true);
	});
});

describe("initUploadQueue retries", () => {
	async function queueOneFailing(): Promise<Harness> {
		const harness = createHarness({
			now: 1_000_000,
			upload: async () => {
				throw new Error("server down");
			},
		});
		await harness.queue.enqueue({ url: "https://example.com/a" });
		return harness;
	}

	it("backs off through the advertised table before abandoning", async () => {
		const harness = await queueOneFailing();
		const delays: number[] = [];
		let clock = 1_000_000;

		for (let pass = 1; pass < 8; pass += 1) {
			const [job] = harness.jobs();
			assert(job, `job should still be queued on pass ${pass}`);
			delays.push(job.nextAttemptAt - clock);
			clock = job.nextAttemptAt;
			harness.setNow(clock);
			await harness.queue.resume();
		}

		expect(delays).toEqual([MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 6 * HOUR]);
		expect(harness.jobs()).toEqual([]);
		expect(harness.warns.some((line) => line.includes("after 8 attempts"))).toBe(true);
	});

	it("reschedules one failing job without disturbing the others", async () => {
		const harness = createHarness({
			upload: async () => {
				throw new Error("server down");
			},
		});
		harness.setNow(1_000);
		await harness.queue.enqueue({ url: "https://example.com/a" });
		harness.setNow(2_000);
		await harness.queue.enqueue({ url: "https://example.com/b" });

		const jobs = harness.jobs();
		expect(jobs.map((job) => job.url)).toEqual([
			"https://example.com/a",
			"https://example.com/b",
		]);
		expect(jobs.map((job) => job.attempts)).toEqual([1, 1]);
		expect(jobs.map((job) => job.nextAttemptAt)).toEqual([1_000 + MINUTE, 2_000 + MINUTE]);
	});

	it("arms the wake at the earliest queued attempt", async () => {
		const harness = await queueOneFailing();

		const [job] = harness.jobs();
		expect(harness.wakes.at(-1)).toBe(job.nextAttemptAt);
	});


	it("drops a job the server refused outright rather than retrying it", async () => {
		const refusals: Extract<UploadContentResult, { ok: false }>[] = [
			{ ok: false, reason: "unsupported" },
			{ ok: false, reason: "rejected" },
		];
		for (const refusal of refusals) {
			const harness = createHarness({ upload: async () => refusal });

			await harness.queue.enqueue({ url: "https://example.com/a" });

			expect(harness.jobs()).toEqual([]);
			expect(harness.payloads.size).toBe(0);
			expect(
				harness.warns.some(
					(line) => line.includes("https://example.com/a") && line.includes(refusal.reason),
				),
			).toBe(true);
		}
	});
});

describe("initUploadQueue session loss", () => {
	/** The upload refreshes and replays for itself, so an UnauthorizedError
	 * reaching the queue is a session that is already gone: the queue spends no
	 * second refresh on it and never retries. */
	it("purges every queued page without attempting the upload again", async () => {
		let attempts = 0;
		const harness = createHarness({
			upload: async () => {
				attempts += 1;
				throw new UnauthorizedError();
			},
		});
		harness.setNow(1_000);
		await harness.queue.enqueue({ url: "https://example.com/first" });
		harness.setNow(2_000);

		await harness.queue.enqueue({ url: "https://example.com/second" });

		expect(attempts).toBe(2);
		expect(harness.jobs()).toEqual([]);
		expect(harness.payloads.size).toBe(0);
		expect(harness.warns.some((line) => line.includes("the session is gone"))).toBe(true);
	});

	it("ends the pass at the purge so a later job never captures a logged-out page", async () => {
		const harness = createHarness({
			upload: async () => {
				throw new UnauthorizedError();
			},
		});
		harness.storage.value = [
			capturingJob({ id: "first", url: "https://example.com/first", createdAt: 1_000 }),
			capturingJob({ id: "second", url: "https://example.com/second", createdAt: 2_000 }),
		];

		await harness.queue.resume();

		expect(harness.captures.map((capture) => capture.url)).toEqual(["https://example.com/first"]);
		expect(harness.payloads.size).toBe(0);
		expect(harness.jobs()).toEqual([]);
	});
});

describe("initUploadQueue purge", () => {
	it("clears the queued jobs, their bytes and the pending wake", async () => {
		const harness = createHarness({
			upload: async () => {
				throw new Error("server down");
			},
		});
		await harness.queue.enqueue({ url: "https://example.com/a" });
		expect(harness.payloads.size).toBe(1);

		await harness.queue.purge();

		expect(harness.jobs()).toEqual([]);
		expect(harness.payloads.size).toBe(0);
	});

	it("logs when the purge itself fails", async () => {
		const harness = createHarness({
			payloadStore: {
				clear: async () => {
					throw new Error("indexeddb unavailable");
				},
			},
		});

		await harness.queue.purge();

		expect(harness.errors.some((line) => line.includes("purge failed"))).toBe(true);
	});
});
