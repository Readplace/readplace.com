import type { HutchLogger } from "@packages/hutch-logger";
import { UnauthorizedError } from "../auth/unauthorized-error";
import type { TabContent, UploadContent, UploadContentResult } from "../reading-list/reading-list.types";
import { type UploadJob, parseUploadJobs } from "./upload-job";
import type {
	CaptureForJob,
	PayloadStore,
	UploadJobStore,
	UploadQueue,
	WakeScheduler,
} from "./upload-queue.types";

const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000];

function backoffFor(attempts: number): number {
	return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];
}

type Refusal = Extract<UploadContentResult, { ok: false }>["reason"];

type SendOutcome =
	| { state: "uploaded" }
	| { state: "retry" }
	| { state: "purged" }
	| { state: "terminal"; reason: Refusal };

/** Whether the pass may keep walking its jobs. A purge ends it: the session that
 * authorised these captures is gone, so a later job must not capture a
 * logged-out page and write its bytes into the store the purge just emptied. */
type PassOutcome = "continue" | "purged";

type UploadTarget = { url: string; title?: string; tabId?: number };

export function initUploadQueue(deps: {
	jobs: UploadJobStore;
	payloads: PayloadStore;
	scheduler: WakeScheduler;
	capture: CaptureForJob;
	uploadContent: UploadContent;
	logger: HutchLogger;
}): UploadQueue {
	let pending: Promise<void> = Promise.resolve();
	let resuming: Promise<void> | undefined;

	/** Every whole-array write happens inside this one chain, so two operations
	 * can never read-modify-write the same key concurrently. `work` MUST settle
	 * successfully — a rejection becomes the new tail and every later operation
	 * inherits it, which is why each entry point catches and logs its own
	 * failures rather than letting them escape. */
	function chain(work: () => Promise<void>): Promise<void> {
		const result = pending.then(work);
		pending = result;
		return result;
	}

	async function readJobs(): Promise<UploadJob[]> {
		return parseUploadJobs(await deps.jobs.read());
	}

	async function replace(change: (jobs: UploadJob[]) => UploadJob[]): Promise<void> {
		await deps.jobs.write(change(await readJobs()));
	}

	async function drop(id: string): Promise<void> {
		await deps.payloads.remove(id);
		await replace((jobs) => jobs.filter((job) => job.id !== id));
	}

	async function purgeAll(): Promise<void> {
		await deps.payloads.clear();
		await deps.jobs.write([]);
		await deps.scheduler.cancel();
	}

	/** An UnauthorizedError here has already been through the upload's own
	 * refresh-and-replay, so the session is genuinely gone rather than merely
	 * stale — retrying or refreshing again would only spend a second refresh
	 * token against a session that no longer exists. */
	async function send(payload: {
		url: string;
		title?: string;
		content: TabContent;
	}): Promise<SendOutcome> {
		try {
			const result = await deps.uploadContent(payload);
			return result.ok ? { state: "uploaded" } : { state: "terminal", reason: result.reason };
		} catch (error) {
			if (!(error instanceof UnauthorizedError)) {
				deps.logger.warn(`[upload-queue] upload of ${payload.url} failed`, error);
				return { state: "retry" };
			}
			deps.logger.warn("[upload-queue] purging queued page bytes: the session is gone");
			await purgeAll();
			return { state: "purged" };
		}
	}

	async function reschedule(job: UploadJob): Promise<void> {
		const attempts = job.attempts + 1;
		if (attempts >= MAX_ATTEMPTS) {
			deps.logger.warn(`[upload-queue] abandoning ${job.url} after ${attempts} attempts`);
			await drop(job.id);
			return;
		}
		const nextAttemptAt = deps.scheduler.now() + backoffFor(attempts);
		await replace((jobs) =>
			jobs.map((entry) => (entry.id === job.id ? { ...entry, attempts, nextAttemptAt } : entry)),
		);
	}

	async function attempt(params: { job: UploadJob; content: TabContent }): Promise<PassOutcome> {
		const outcome = await send({
			url: params.job.url,
			title: params.job.title,
			content: params.content,
		});
		if (outcome.state === "purged") return "purged";
		if (outcome.state === "retry") {
			await reschedule(params.job);
			return "continue";
		}
		if (outcome.state === "terminal") {
			deps.logger.warn(
				`[upload-queue] abandoning ${params.job.url}: the server refused the captured page as ${outcome.reason}`,
			);
		}
		await drop(params.job.id);
		return "continue";
	}

	async function captureInto(job: Extract<UploadJob, { state: "capturing" }>): Promise<PassOutcome> {
		const captured = await deps.capture({ url: job.url, tabId: job.tabId });
		if (!captured) {
			deps.logger.warn(`[upload-queue] abandoning ${job.url}: the page can no longer be captured`);
			await drop(job.id);
			return "continue";
		}
		await deps.payloads.put({
			id: job.id,
			blob: new Blob([captured.bytes], { type: captured.mediaType }),
		});
		const ready: UploadJob = {
			id: job.id,
			url: job.url,
			title: job.title,
			attempts: job.attempts,
			nextAttemptAt: job.nextAttemptAt,
			createdAt: job.createdAt,
			state: "ready",
			mediaType: captured.mediaType,
		};
		await replace((jobs) => jobs.map((entry) => (entry.id === job.id ? ready : entry)));
		return attempt({ job: ready, content: captured });
	}

	async function processJob(job: UploadJob): Promise<PassOutcome> {
		if (job.nextAttemptAt > deps.scheduler.now()) return "continue";
		if (job.state === "capturing") return captureInto(job);
		const blob = await deps.payloads.get(job.id);
		if (!blob) {
			deps.logger.warn(`[upload-queue] abandoning ${job.url}: its captured bytes are gone`);
			await drop(job.id);
			return "continue";
		}
		return attempt({
			job,
			content: { bytes: await blob.arrayBuffer(), mediaType: job.mediaType },
		});
	}

	async function rearm(): Promise<void> {
		const jobs = await readJobs();
		if (jobs.length === 0) {
			await deps.scheduler.cancel();
			return;
		}
		await deps.scheduler.wakeAt(Math.min(...jobs.map((job) => job.nextAttemptAt)));
	}

	async function walk(): Promise<void> {
		const jobs = await readJobs();
		for (const job of [...jobs].sort((a, b) => a.createdAt - b.createdAt)) {
			// A purge has already cancelled the wake, so re-arming would resurrect it.
			if ((await processJob(job)) === "purged") return;
		}
		await rearm();
	}

	async function drain(): Promise<void> {
		try {
			await walk();
		} catch (error) {
			deps.logger.error("[upload-queue] resume failed", error);
		}
	}

	function clearResuming(): void {
		resuming = undefined;
	}

	function resume(): Promise<void> {
		if (!resuming) resuming = chain(drain).then(clearResuming);
		return resuming;
	}

	async function admit(target: UploadTarget): Promise<void> {
		try {
			const now = deps.scheduler.now();
			const jobs = await readJobs();
			for (const superseded of jobs.filter((job) => job.url === target.url)) {
				await deps.payloads.remove(superseded.id);
			}
			const job: UploadJob = {
				id: crypto.randomUUID(),
				url: target.url,
				title: target.title,
				state: "capturing",
				tabId: target.tabId,
				attempts: 0,
				nextAttemptAt: now,
				createdAt: now,
			};
			await deps.jobs.write([...jobs.filter((entry) => entry.url !== target.url), job]);
		} catch (error) {
			deps.logger.error(`[upload-queue] failed to record a deferred upload for ${target.url}`, error);
		}
	}

	async function purgeSafely(): Promise<void> {
		try {
			await purgeAll();
		} catch (error) {
			deps.logger.error("[upload-queue] purge failed", error);
		}
	}

	return {
		async enqueue(target) {
			await chain(() => admit(target));
			await resume();
		},
		resume,
		purge: () => chain(purgeSafely),
	};
}
