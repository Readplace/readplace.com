import type { HutchLogger } from "@packages/hutch-logger";
import { UnauthorizedError } from "../auth/unauthorized-error";
import type { BulkSavePage, BulkSaveResult, SavePages } from "../reading-list/reading-list.types";
import {
	degradeOversizedPages,
	packRequests,
	type BulkSaveSession,
	type OpenBulkSaveSession,
} from "../reading-list/siren-reading-list";
import type { PayloadStore, WakeScheduler } from "../upload-queue/upload-queue.types";
import { type BulkSaveJob, parseBulkSaveJobs } from "./bulk-save-job";

const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000];

function backoffFor(attempts: number): number {
	return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];
}

export interface BulkSaveJobStore {
	read: () => Promise<unknown>;
	write: (jobs: BulkSaveJob[]) => Promise<void>;
}

export interface BulkSaveQueue {
	savePages: SavePages;
	resume: () => Promise<void>;
	purge: () => Promise<void>;
}

type PassReport = BulkSaveResult & {
	terminalUrls: string[];
	retriedUrls: string[];
	drained: boolean;
};

function emptyReport(): PassReport {
	return {
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

function buildSettleNotification(report: PassReport): { title: string; message: string } | null {
	if (report.unauthorized) {
		return {
			title: "Not signed in",
			message: "Sign in to Readplace and run Save all tabs again.",
		};
	}
	if (!report.drained) return null;
	if (report.terminalUrls.length > 0) {
		const listed = report.terminalUrls.slice(0, 3).join("\n");
		return {
			title: "Couldn't save some tabs",
			message: `${report.terminalUrls.length} tabs couldn't be saved after retrying.\n${listed}`,
		};
	}
	if (report.saved > 0) {
		let message = `Saved ${report.saved} after retrying`;
		if (report.pendingRetry > 0) message += ` · Retrying ${report.pendingRetry}`;
		return { title: "Tabs saved", message };
	}
	return null;
}

export function initBulkSaveQueue(deps: {
	jobs: BulkSaveJobStore;
	payloads: PayloadStore;
	scheduler: WakeScheduler;
	openSession: OpenBulkSaveSession;
	notify: (notification: { title: string; message: string }) => void;
	logger: HutchLogger;
}): BulkSaveQueue {
	let pending: Promise<unknown> = Promise.resolve();
	let resuming: Promise<void> | undefined;

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

	async function removeJobs(ids: Set<string>): Promise<void> {
		for (const id of ids) await deps.payloads.remove(id);
		await deps.jobs.write((await readJobs()).filter((job) => !ids.has(job.id)));
	}

	async function purgeAll(): Promise<void> {
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

	async function admitAll(pages: BulkSavePage[]): Promise<Set<string>> {
		const now = deps.scheduler.now();
		const jobs = await readJobs();
		const urls = new Set(pages.map((page) => page.url));
		for (const superseded of jobs.filter((job) => urls.has(job.url))) {
			await deps.payloads.remove(superseded.id);
		}
		const admitted: BulkSaveJob[] = [];
		for (const page of pages) {
			const job: BulkSaveJob = {
				id: crypto.randomUUID(),
				url: page.url,
				title: page.title,
				mediaType: page.content?.mediaType,
				attempts: 0,
				nextAttemptAt: now,
				createdAt: now,
			};
			if (page.content) {
				await deps.payloads.put({
					id: job.id,
					blob: new Blob([page.content.bytes], { type: page.content.mediaType }),
				});
			}
			admitted.push(job);
		}
		await deps.jobs.write([...jobs.filter((job) => !urls.has(job.url)), ...admitted]);
		return new Set(admitted.map((job) => job.id));
	}

	async function rehydrate(job: BulkSaveJob): Promise<BulkSavePage> {
		const page: BulkSavePage = { url: job.url, title: job.title };
		if (job.mediaType === undefined) return page;
		const blob = await deps.payloads.get(job.id);
		if (!blob) {
			deps.logger.warn(`[bulk-save-queue] captured bytes for ${job.url} are gone — saving URL-only`);
			return page;
		}
		return { ...page, content: { bytes: await blob.arrayBuffer(), mediaType: job.mediaType } };
	}

	async function rescheduleAll(due: BulkSaveJob[], report: PassReport): Promise<void> {
		const terminalIds = new Set<string>();
		const updates = new Map<string, BulkSaveJob>();
		for (const job of due) {
			const attempts = job.attempts + 1;
			if (attempts >= MAX_ATTEMPTS) {
				deps.logger.warn(`[bulk-save-queue] abandoning ${job.url} after ${attempts} attempts`);
				terminalIds.add(job.id);
				report.terminalUrls.push(job.url);
				report.failed += 1;
				report.failedUrls.push({ url: job.url });
			} else {
				updates.set(job.id, {
					...job,
					attempts,
					nextAttemptAt: deps.scheduler.now() + backoffFor(attempts),
				});
				report.pendingRetry += 1;
				report.retriedUrls.push(job.url);
			}
		}
		for (const id of terminalIds) await deps.payloads.remove(id);
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

	async function runPass(only?: Set<string>): Promise<PassReport> {
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
		const pages: BulkSavePage[] = [];
		for (const job of due) pages.push(await rehydrate(job));
		const degraded = degradeOversizedPages({
			pages,
			limits: session.limits,
			logger: deps.logger,
		});
		report.tooBig.push(...degraded.tooBig);
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
			try {
				const bulk = await session.sendChunk(chunk);
				progressed = true;
				report.saved += bulk.saved;
				report.skipped += bulk.skipped;
				report.tooBig.push(...bulk.tooBig);
				report.skippedUrls.push(...bulk.skippedUrls);
				const results = bulk.results;
				if (results) {
					report.alreadySaved += results.filter((entry) => entry.outcome === "merged").length;
					const outcomeByUrl = new Map(results.map((entry) => [entry.url, entry.outcome]));
					const settled = new Set<string>();
					const retry: BulkSaveJob[] = [];
					for (const job of chunkJobs) {
						const outcome = outcomeByUrl.get(job.url);
						if (outcome === undefined || outcome === "failed") {
							retry.push(job);
						} else {
							settled.add(job.id);
						}
					}
					await removeJobs(settled);
					await rescheduleAll(retry, report);
				} else {
					const shortfall = chunk.length - (bulk.saved + bulk.skipped + bulk.failed);
					report.failed += bulk.failed + Math.max(0, shortfall);
					await removeJobs(new Set(chunkJobs.map((job) => job.id)));
				}
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

	const savePages: SavePages = async ({ pages }) => {
		if (pages.length === 0) return toBulkSaveResult(emptyReport());
		try {
			const report = await chain(async () => runPass(await admitAll(pages)));
			return toBulkSaveResult(report);
		} catch (error) {
			if (error instanceof UnauthorizedError) await chain(purgeSafely);
			throw error;
		}
	};

	function clearResuming(): void {
		resuming = undefined;
	}

	function resume(): Promise<void> {
		if (!resuming) {
			resuming = chain(async () => {
				try {
					const report = await runPass();
					const notification = buildSettleNotification(report);
					if (notification) deps.notify(notification);
				} catch (error) {
					if (error instanceof UnauthorizedError) {
						deps.notify({
							title: "Not signed in",
							message: "Sign in to Readplace and run Save all tabs again.",
						});
						return;
					}
					deps.logger.error("[bulk-save-queue] resume failed", error);
				}
			}).then(clearResuming);
		}
		return resuming;
	}

	return {
		savePages,
		resume,
		purge: () => chain(purgeSafely),
	};
}
