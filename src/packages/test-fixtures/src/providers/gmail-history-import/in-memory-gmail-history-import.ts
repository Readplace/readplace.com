import { ConditionalCheckFailedException } from "@packages/hutch-storage-client";
import {
	canRestartGmailHistoryImport,
	GMAIL_HISTORY_IMPORT_OUTCOME_COUNT,
	GMAIL_HISTORY_IMPORT_WINDOW_DAYS,
	type GmailHistoryImportJob,
	type GmailHistoryImportJobId,
	type GmailHistoryImportMessage,
	type GmailHistoryImportStore,
	type GmailMessageId,
	planFetchedRecording,
	restartedCounts,
	settledCount,
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

const PAGE_LEASE_MS = 60_000;
const DAY_MS = 86_400_000;
const NON_TERMINAL: ReadonlySet<GmailHistoryImportJob["state"]> = new Set(["awaiting-permission", "queued", "running"]);

function jobKey(input: { userId: UserId; jobId: GmailHistoryImportJobId }): string {
	return `${input.userId}#${input.jobId}`;
}

function messageKey(input: { userId: UserId; jobId: GmailHistoryImportJobId; gmailMessageId: GmailMessageId }): string {
	return `${jobKey(input)}#${input.gmailMessageId}`;
}

export function initInMemoryGmailHistoryImport(): GmailHistoryImportStore {
	const jobs = new Map<string, GmailHistoryImportJob>();
	const messages = new Map<string, GmailHistoryImportMessage>();
	const leases = new Map<string, { page: number; until: number }>();

	const save = (job: GmailHistoryImportJob): GmailHistoryImportJob => {
		jobs.set(jobKey(job), job);
		return job;
	};

	const inRun = (input: { userId: UserId; jobId: GmailHistoryImportJobId; generation: string }) => {
		const job = jobs.get(jobKey(input));
		return job?.generation === input.generation && job.state === "running" ? job : undefined;
	};

	const store: GmailHistoryImportStore = {
		createJob: async (job) => {
			if (jobs.has(jobKey(job))) {
				throw new ConditionalCheckFailedException({ $metadata: {}, message: "The conditional request failed" });
			}
			save(job);
		},
		findJob: async (input) => jobs.get(jobKey(input)),
		listJobsByUserId: async (userId) =>
			[...jobs.values()].filter((job) => job.userId === userId).sort((a, b) => a.jobId.localeCompare(b.jobId)),
		startJob: async ({ userId, jobId, generation, now }) => {
			const job = jobs.get(jobKey({ userId, jobId }));
			if (job === undefined || !canRestartGmailHistoryImport(job)) return undefined;
			leases.delete(jobKey(job));
			return save({
				...job,
				state: "queued",
				generation,
				window: job.window ?? {
					start: new Date(now.getTime() - GMAIL_HISTORY_IMPORT_WINDOW_DAYS * DAY_MS).toISOString(),
					end: now.toISOString(),
				},
				page: 0,
				pageToken: undefined,
				listingCompletedAt: undefined,
				failureReason: undefined,
				completedAt: undefined,
				counts: restartedCounts(job.counts),
				updatedAt: now.toISOString(),
			});
		},
		claimPage: async ({ userId, jobId, generation, page, now }) => {
			const job = jobs.get(jobKey({ userId, jobId }));
			if (job?.generation !== generation || job.page !== page) return false;
			if (job.state !== "queued" && job.state !== "running") return false;
			const lease = leases.get(jobKey(job));
			if (lease !== undefined && lease.page === page && lease.until > now.getTime()) return false;
			leases.set(jobKey(job), { page, until: now.getTime() + PAGE_LEASE_MS });
			save({ ...job, state: "running", updatedAt: now.toISOString() });
			return true;
		},
		recordFetched: async ({ userId, jobId, generation, gmailMessageId, rawS3Key, now }) => {
			const job = inRun({ userId, jobId, generation });
			if (job === undefined) return "stale";
			const key = messageKey({ userId, jobId, gmailMessageId });
			const recording = planFetchedRecording({ existing: messages.get(key), generation });
			if (recording === "already-settled") return "already-settled";
			messages.set(key, { userId, jobId, gmailMessageId, generation, rawS3Key, status: "fetched", recordedAt: now.toISOString() });
			if (recording === "count-new") save({ ...job, counts: { ...job.counts, listed: job.counts.listed + 1 } });
			return "recorded";
		},
		savePage: async ({ previous, pageToken, now }) => {
			const job = inRun(previous);
			if (job === undefined || job.page !== previous.page) return false;
			leases.delete(jobKey(job));
			save({
				...job,
				page: job.page + 1,
				pageToken,
				listingCompletedAt: pageToken === undefined ? now.toISOString() : undefined,
				updatedAt: now.toISOString(),
			});
			return true;
		},
		recordOutcome: async ({ userId, jobId, generation, gmailMessageId, outcome, now }) => {
			const key = messageKey({ userId, jobId, gmailMessageId });
			const message = messages.get(key);
			const job = jobs.get(jobKey({ userId, jobId }));
			if (message?.generation !== generation || job?.generation !== generation) return "stale";
			if (message.status !== "fetched") return "duplicate";
			messages.set(key, { ...message, status: outcome, recordedAt: now.toISOString() });
			const counted = GMAIL_HISTORY_IMPORT_OUTCOME_COUNT[outcome];
			save({ ...job, counts: { ...job.counts, [counted]: job.counts[counted] + 1 }, updatedAt: now.toISOString() });
			return "recorded";
		},
		completeIfSettled: async ({ userId, jobId, now }) => {
			const job = jobs.get(jobKey({ userId, jobId }));
			if (job?.state !== "running" || job.listingCompletedAt === undefined) return undefined;
			if (settledCount(job.counts) !== job.counts.listed) return undefined;
			return save({ ...job, state: "complete", completedAt: now.toISOString(), updatedAt: now.toISOString() });
		},
		failJob: async ({ userId, jobId, generation, reason, now }) => {
			const job = jobs.get(jobKey({ userId, jobId }));
			if (job === undefined) return undefined;
			if (job.generation !== generation || (job.state !== "queued" && job.state !== "running")) return undefined;
			return save({ ...job, state: "failed", failureReason: reason, updatedAt: now.toISOString() });
		},
		cancelJobs: async ({ userId, senderEmail, reason, now }) => {
			return [...jobs.values()]
				.filter((job) => job.userId === userId && NON_TERMINAL.has(job.state))
				.filter((job) => senderEmail === undefined || job.senderEmail === senderEmail)
				.map((job) => save({ ...job, state: "cancelled", cancelReason: reason, updatedAt: now.toISOString() }));
		},
		deleteAllByUserId: async (userId) => {
			for (const [key, job] of jobs) {
				if (job.userId === userId) jobs.delete(key);
			}
			for (const [key, message] of messages) {
				if (message.userId === userId) messages.delete(key);
			}
		},
	};

	return store;
}
