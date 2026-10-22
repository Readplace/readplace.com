import type { HutchLogger } from "@packages/hutch-logger";
import { UnauthorizedError } from "../auth/unauthorized-error";
import type { BulkSavePage, BulkSaveResult } from "../reading-list/reading-list.types";
import {
	type BulkChunkSummary,
	degradeOversizedPages,
	packRequests,
	type BulkSaveSession,
	type OpenBulkSaveSession,
} from "../reading-list/siren-reading-list";
import type { BulkPayloadStore, WakeScheduler } from "../upload-queue/upload-queue.types";
import { type BulkSaveJob, type BulkSaveJobId, BulkSaveJobIdSchema, parseBulkSaveJobs } from "./bulk-save-job";

const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000];

function backoffFor(attempts: number): number {
	return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];
}

export interface BulkSaveJobStore {
	read: () => Promise<unknown>;
	write: (jobs: BulkSaveJob[]) => Promise<void>;
}

type SettledOutcome =
	| { state: "saved" | "already-saved" | "queued" }
	| { state: "skipped"; code: string; message: string | null };

export type QueueEvent =
	| { kind: "sending"; jobId: BulkSaveJobId; url: string; tooBigMb: number | null }
	| { kind: "settled"; jobId: BulkSaveJobId; url: string; outcome: SettledOutcome; tooBigMb: number | null }
	| { kind: "retrying"; jobId: BulkSaveJobId; url: string }
	| { kind: "failed"; jobId: BulkSaveJobId; url: string; unauthorized: boolean };

export type AdmittedJob = { url: string; jobId: BulkSaveJobId; supersededJobIds: BulkSaveJobId[] };

type SaveAdmittedPages = (params: {
	pages: BulkSavePage[];
	admitted: (jobs: AdmittedJob[]) => Promise<void>;
}) => Promise<BulkSaveResult>;

export type PassReport = BulkSaveResult & {
	terminalUrls: string[];
	retriedUrls: string[];
	drained: boolean;
};

export type ResumeOutcome = { kind: "pass"; report: PassReport } | { kind: "unauthorized" };

export interface BulkSaveQueue {
	savePages: SaveAdmittedPages;
	resume: () => Promise<ResumeOutcome>;
	purge: () => Promise<void>;
	pendingJobs: () => Promise<{ url: string; jobId: BulkSaveJobId; dueNow: boolean }[]>;
	withdraw: (url: string) => Promise<void>;
}

function emptyReport(): PassReport {
	return {
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
		terminalUrls: [],
		retriedUrls: [],
		drained: false,
	};
}

function toBulkSaveResult(report: PassReport): BulkSaveResult {
	const { terminalUrls: _terminalUrls, retriedUrls: _retriedUrls, drained: _drained, ...result } = report;
	return result;
}

type ChunkResult = NonNullable<BulkChunkSummary["results"]>[number];

function settledOutcomeOf(entry: ChunkResult | undefined, skip: { code: string; message?: string } | undefined): SettledOutcome | null {
	if (entry === undefined || entry.outcome === "failed") return null;
	if (entry.outcome === "merged") return { state: "already-saved" };
	if (entry.outcome === "created") return { state: entry.code === "queued" ? "queued" : "saved" };
	if (skip === undefined) return null;
	return { state: "skipped", code: skip.code, message: skip.message ?? null };
}

export function initBulkSaveQueue(deps: {
	jobs: BulkSaveJobStore;
	payloads: BulkPayloadStore;
	scheduler: WakeScheduler;
	openSession: OpenBulkSaveSession;
	progress: (events: QueueEvent[]) => Promise<void>;
	logger: HutchLogger;
}): BulkSaveQueue {
	let pending: Promise<unknown> = Promise.resolve();
	let resuming: Promise<ResumeOutcome> | undefined;

	function chain<T>(work: () => Promise<T>): Promise<T> {
		const result = pending.then(work);
		pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async function readJobs(): Promise<BulkSaveJob[]> {
		return parseBulkSaveJobs(await deps.jobs.read());
	}

	async function removeJobs(settled: BulkSaveJob[]): Promise<void> {
		if (settled.length === 0) return;
		await deps.payloads.removeAll(
			settled.filter((job) => job.mediaType !== undefined).map((job) => job.id),
		);
		const ids = new Set(settled.map((job) => job.id));
		await deps.jobs.write((await readJobs()).filter((job) => !ids.has(job.id)));
	}

	async function purgeAll(): Promise<void> {
		const jobs = await readJobs();
		await deps.progress(
			jobs.map((job) => ({ kind: "failed", jobId: job.id, url: job.url, unauthorized: true })),
		);
		await deps.payloads.clear();
		await deps.jobs.write([]);
		await deps.scheduler.cancel();
	}

	async function purgeSafely(): Promise<void> {
		try {
			await purgeAll();
		} catch (error) {
			deps.logger.error("[bulk-save-queue] purge failed", error);
		}
	}

	async function admitAll(pages: BulkSavePage[]): Promise<AdmittedJob[]> {
		const now = deps.scheduler.now();
		const jobs = await readJobs();
		const urls = new Set(pages.map((page) => page.url));
		const superseded = jobs.filter((job) => urls.has(job.url));
		await deps.payloads.removeAll(superseded.map((job) => job.id));
		const admitted: BulkSaveJob[] = [];
		const captured: { id: string; bytes: ArrayBuffer }[] = [];
		for (const page of pages) {
			const job: BulkSaveJob = {
				id: BulkSaveJobIdSchema.parse(crypto.randomUUID()),
				url: page.url,
				title: page.title,
				mediaType: page.content?.mediaType,
				attempts: 0,
				nextAttemptAt: now,
				createdAt: now,
			};
			if (page.content) {
				captured.push({ id: job.id, bytes: page.content.bytes });
			}
			admitted.push(job);
		}
		await deps.payloads.putAll(captured);
		await deps.jobs.write([...jobs.filter((job) => !urls.has(job.url)), ...admitted]);
		return admitted.map((job) => ({
			url: job.url,
			jobId: job.id,
			supersededJobIds: superseded.filter((old) => old.url === job.url).map((old) => old.id),
		}));
	}

	async function rehydrateAll(due: BulkSaveJob[]): Promise<BulkSavePage[]> {
		const stored = await deps.payloads.getAll(
			due.filter((job) => job.mediaType !== undefined).map((job) => job.id),
		);
		return due.map((job) => rehydrate(job, stored));
	}

	function rehydrate(job: BulkSaveJob, stored: Map<string, ArrayBuffer>): BulkSavePage {
		const page: BulkSavePage = { url: job.url, title: job.title };
		if (job.mediaType === undefined) return page;
		const bytes = stored.get(job.id);
		if (!bytes) {
			deps.logger.warn(`[bulk-save-queue] captured bytes for ${job.url} are gone — saving URL-only`);
			return page;
		}
		return { ...page, content: { bytes, mediaType: job.mediaType } };
	}

	async function rescheduleAll(due: BulkSaveJob[], report: PassReport): Promise<void> {
		if (due.length === 0) return;
		const terminal: BulkSaveJob[] = [];
		const updates = new Map<string, BulkSaveJob>();
		const events: QueueEvent[] = [];
		for (const job of due) {
			const attempts = job.attempts + 1;
			if (attempts >= MAX_ATTEMPTS) {
				deps.logger.warn(`[bulk-save-queue] abandoning ${job.url} after ${attempts} attempts`);
				terminal.push(job);
				report.terminalUrls.push(job.url);
				report.failed += 1;
				report.failedUrls.push({ url: job.url });
				events.push({ kind: "failed", jobId: job.id, url: job.url, unauthorized: false });
			} else {
				updates.set(job.id, {
					...job,
					attempts,
					nextAttemptAt: deps.scheduler.now() + backoffFor(attempts),
				});
				report.pendingRetry += 1;
				report.retriedUrls.push(job.url);
				events.push({ kind: "retrying", jobId: job.id, url: job.url });
			}
		}
		await deps.progress(events);
		await deps.payloads.removeAll(terminal.map((job) => job.id));
		const terminalIds = new Set(terminal.map((job) => job.id));
		await deps.jobs.write(
			(await readJobs())
				.filter((job) => !terminalIds.has(job.id))
				.map((job) => updates.get(job.id) ?? job),
		);
	}

	async function rearm(): Promise<void> {
		const jobs = await readJobs();
		if (jobs.length === 0) {
			await deps.scheduler.cancel();
			return;
		}
		await deps.scheduler.wakeAt(Math.min(...jobs.map((job) => job.nextAttemptAt)));
	}

	async function runPass(only?: Set<BulkSaveJobId>): Promise<PassReport> {
		const report = emptyReport();
		const now = deps.scheduler.now();
		const jobs = await readJobs();
		const due = jobs.filter(
			(job) => job.nextAttemptAt <= now && (only === undefined || only.has(job.id)),
		);
		if (due.length === 0) {
			await rearm();
			return report;
		}
		report.drained = true;
		let session: BulkSaveSession;
		try {
			session = await deps.openSession();
		} catch (error) {
			if (error instanceof UnauthorizedError) throw error;
			deps.logger.warn("[bulk-save-queue] could not reach the server — will retry", error);
			await rescheduleAll(due, report);
			await rearm();
			return report;
		}
		const pages = await rehydrateAll(due);
		const degraded = degradeOversizedPages({
			pages,
			limits: session.limits,
			logger: deps.logger,
		});
		report.tooBig.push(...degraded.tooBig);
		const degradedMb = new Map(degraded.tooBig.map((page) => [page.url, page.mb]));
		const chunks = packRequests(degraded.pages, {
			maxItems: session.limits.maxItems,
			maxBytes: Math.min(session.limits.maxBytes, session.limits.requestBudget),
		});
		let progressed = false;
		/** degradeOversizedPages maps and packRequests partitions in input order,
		 * so the chunks concatenate back to the due list position for position. */
		let jobCursor = 0;
		for (const [index, chunk] of chunks.entries()) {
			const chunkJobs = due.slice(jobCursor, jobCursor + chunk.length);
			jobCursor += chunk.length;
			void deps.progress(
				chunkJobs.map((job) => ({
					kind: "sending",
					jobId: job.id,
					url: job.url,
					tooBigMb: degradedMb.get(job.url) ?? null,
				})),
			).catch((error) => deps.logger.error("[bulk-save-queue] reporting a chunk sending failed", error));
			try {
				const bulk = await session.sendChunk(chunk);
				progressed = true;
				report.saved += bulk.saved - bulk.queued;
				report.queued += bulk.queued;
				report.skipped += bulk.skipped;
				report.tooBig.push(...bulk.tooBig);
				report.skippedUrls.push(...bulk.skippedUrls);
				const results = bulk.results ?? [];
				report.alreadySaved += results.filter((entry) => entry.outcome === "merged").length;
				const resultByUrl = new Map(results.map((entry) => [entry.url, entry]));
				const skipByUrl = new Map(bulk.skippedUrls.map((entry) => [entry.url, entry]));
				const serverMb = new Map(bulk.tooBig.map((page) => [page.url, page.mb]));
				const settled: BulkSaveJob[] = [];
				const outcomes: QueueEvent[] = [];
				const retry: BulkSaveJob[] = [];
				for (const job of chunkJobs) {
					const outcome = settledOutcomeOf(resultByUrl.get(job.url), skipByUrl.get(job.url));
					if (outcome === null) {
						retry.push(job);
						continue;
					}
					settled.push(job);
					outcomes.push({
						kind: "settled",
						jobId: job.id,
						url: job.url,
						outcome,
						tooBigMb: serverMb.get(job.url) ?? null,
					});
				}
				await deps.progress(outcomes);
				await removeJobs(settled);
				await rescheduleAll(retry, report);
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					await purgeAll();
					const remaining = chunks.slice(index).flat();
					report.failed += remaining.length + report.pendingRetry;
					report.failedUrls.push(...remaining.map((page) => ({ url: page.url })));
					report.failedUrls.push(...report.retriedUrls.map((url) => ({ url })));
					report.pendingRetry = 0;
					report.unauthorized = true;
					if (!progressed) throw error;
					return report;
				}
				deps.logger.warn(`[bulk-save-queue] a chunk of ${chunk.length} pages failed — will retry`, error);
				await rescheduleAll(chunkJobs, report);
			}
		}
		await rearm();
		return report;
	}

	const savePages: SaveAdmittedPages = async ({ pages, admitted }) => {
		if (pages.length === 0) return toBulkSaveResult(emptyReport());
		try {
			const report = await chain(async () => {
				const jobs = await admitAll(pages);
				await admitted(jobs);
				return runPass(new Set(jobs.map((job) => job.jobId)));
			});
			return toBulkSaveResult(report);
		} catch (error) {
			if (error instanceof UnauthorizedError) await chain(purgeSafely);
			throw error;
		}
	};

	function clearResuming(outcome: ResumeOutcome): ResumeOutcome {
		resuming = undefined;
		return outcome;
	}

	function resume(): Promise<ResumeOutcome> {
		if (!resuming) {
			resuming = chain(async (): Promise<ResumeOutcome> => {
				try {
					return { kind: "pass", report: await runPass() };
				} catch (error) {
					if (error instanceof UnauthorizedError) return { kind: "unauthorized" };
					deps.logger.error("[bulk-save-queue] resume failed", error);
					return { kind: "pass", report: emptyReport() };
				}
			}).then(clearResuming);
		}
		return resuming;
	}

	return {
		savePages,
		resume,
		purge: () => chain(purgeSafely),
		pendingJobs: () =>
			chain(async () => {
				const now = deps.scheduler.now();
				return (await readJobs()).map((job) => ({ url: job.url, jobId: job.id, dueNow: job.nextAttemptAt <= now }));
			}),
		withdraw: (url) =>
			chain(async () => {
				const withdrawn = (await readJobs()).filter((job) => job.url === url);
				await removeJobs(withdrawn);
				await rearm();
			}),
	};
}
