import {
	addGmailMarkBackfillCounts,
	type GmailMarkBackfillJob,
	type GmailMarkBackfillRef,
	type GmailMarkBackfillStore,
	gmailAccountKey,
	planGmailMarkBackfillStart,
} from "@packages/domain/gmail";

const PAGE_LEASE_MS = 60_000;

function keyOf(ref: GmailMarkBackfillRef): string {
	return `${ref.userId}#${gmailAccountKey(ref.accountEmail)}#${ref.senderEmail}`;
}

function unfinished(job: GmailMarkBackfillJob | undefined): job is GmailMarkBackfillJob {
	return job?.state === "queued" || job?.state === "running";
}

export function initInMemoryGmailMarkBackfill(): GmailMarkBackfillStore {
	const jobs = new Map<string, GmailMarkBackfillJob>();
	const leases = new Map<string, number>();

	const onPage = (input: GmailMarkBackfillRef & { generation: number; page: number }) => {
		const job = jobs.get(keyOf(input));
		return job?.generation === input.generation && job.page === input.page && job.state === "running" ? job : undefined;
	};

	return {
		startBackfill: async ({ optionEnabledAt, now, ...ref }) => {
			const job = planGmailMarkBackfillStart({ existing: jobs.get(keyOf(ref)), ref, optionEnabledAt, now });
			if (job === undefined) return { started: false };
			jobs.set(keyOf(ref), job);
			leases.delete(keyOf(ref));
			return { started: true, job };
		},
		findBackfill: async (ref) => jobs.get(keyOf(ref)),
		listBackfillsByUserId: async (userId) => [...jobs.values()].filter((job) => job.userId === userId),
		claimPage: async ({ generation, page, now, ...ref }) => {
			const job = jobs.get(keyOf(ref));
			if (job?.generation !== generation || job.page !== page || !unfinished(job)) return false;
			if ((leases.get(keyOf(ref)) ?? 0) > now.getTime()) return false;
			leases.set(keyOf(ref), now.getTime() + PAGE_LEASE_MS);
			jobs.set(keyOf(ref), { ...job, state: "running", updatedAt: now.toISOString() });
			return true;
		},
		savePage: async ({ cursor, counts, now, ...input }) => {
			const job = onPage(input);
			if (job === undefined) return false;
			leases.delete(keyOf(job));
			jobs.set(keyOf(job), {
				...job,
				page: job.page + 1,
				cursor,
				counts: addGmailMarkBackfillCounts({ base: job.counts, added: counts }),
				updatedAt: now.toISOString(),
			});
			return true;
		},
		complete: async ({ counts, now, ...input }) => {
			const job = onPage(input);
			if (job === undefined) return false;
			leases.delete(keyOf(job));
			jobs.set(keyOf(job), {
				...job,
				state: "complete",
				counts: addGmailMarkBackfillCounts({ base: job.counts, added: counts }),
				finishedAt: now.toISOString(),
				updatedAt: now.toISOString(),
			});
			return true;
		},
		failBackfill: async ({ generation, reason, now, ...ref }) => {
			const job = jobs.get(keyOf(ref));
			if (!unfinished(job) || (generation !== undefined && job.generation !== generation)) return "unchanged";
			leases.delete(keyOf(ref));
			jobs.set(keyOf(ref), { ...job, state: "failed", failureReason: reason, finishedAt: now.toISOString(), updatedAt: now.toISOString() });
			return "failed";
		},
		cancelBackfill: async ({ generation, reason, now, ...ref }) => {
			const job = jobs.get(keyOf(ref));
			if (!unfinished(job) || (generation !== undefined && job.generation !== generation)) return "unchanged";
			leases.delete(keyOf(ref));
			jobs.set(keyOf(ref), { ...job, state: "cancelled", cancelReason: reason, finishedAt: now.toISOString(), updatedAt: now.toISOString() });
			return "cancelled";
		},
	};
}
