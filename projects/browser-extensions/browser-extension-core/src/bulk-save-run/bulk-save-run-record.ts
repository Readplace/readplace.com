import type { HutchLogger } from "@packages/hutch-logger";
import type { AdmittedJob } from "../bulk-save-queue/bulk-save-queue";
import type { WindowId } from "../domain/window-id";
import {
	BULK_SAVE_RUNS_KEY,
	type BulkSaveRun,
	type BulkSaveRunId,
	type LinkEvent,
	applyLinkEvents,
	parseBulkSaveRuns,
} from "./bulk-save-run";

export interface BulkSaveRunArea {
	get: (key: string) => Promise<Record<string, unknown>>;
	set: (items: Record<string, unknown>) => Promise<void>;
	remove: (key: string) => Promise<void>;
}

export interface BulkSaveRunRecord {
	load: () => Promise<BulkSaveRun[]>;
	all: () => BulkSaveRun[];
	ofWindow: (windowId: WindowId) => BulkSaveRun | undefined;
	byRunId: (runId: BulkSaveRunId) => BulkSaveRun | undefined;
	set: (run: BulkSaveRun) => Promise<BulkSaveRun>;
	apply: (change: { runId: BulkSaveRunId; update: (run: BulkSaveRun) => BulkSaveRun }) => Promise<BulkSaveRun | undefined>;
	applyEvents: (events: LinkEvent[]) => Promise<void>;
	admitted: (input: { runId: BulkSaveRunId; jobs: AdmittedJob[] }) => Promise<void>;
	clear: () => Promise<void>;
}

export function initBulkSaveRunRecord(deps: { area: BulkSaveRunArea; logger: HutchLogger }): BulkSaveRunRecord {
	let runs: BulkSaveRun[] = [];
	let writing: Promise<void> | undefined;
	let waiting: Promise<void> | undefined;

	async function writeNow(): Promise<void> {
		const snapshot = runs;
		try {
			if (snapshot.length === 0) await deps.area.remove(BULK_SAVE_RUNS_KEY);
			else await deps.area.set({ [BULK_SAVE_RUNS_KEY]: snapshot });
		} catch (error) {
			deps.logger.error("[bulk-save-run] could not write the run record", error);
		}
	}

	function startWrite(): Promise<void> {
		writing = writeNow().then(() => {
			writing = undefined;
		});
		return writing;
	}

	function persist(): Promise<void> {
		if (waiting) return waiting;
		if (!writing) return startWrite();
		const queued = writing.then(() => {
			waiting = undefined;
			return startWrite();
		});
		waiting = queued;
		return queued;
	}

	function replace(next: BulkSaveRun[]): void {
		runs = next;
	}

	function bumped(run: BulkSaveRun): BulkSaveRun {
		return { ...run, revision: run.revision + 1 };
	}

	function byRunId(runId: BulkSaveRunId): BulkSaveRun | undefined {
		return runs.find((run) => run.id === runId || run.joinedIds.includes(runId));
	}

	return {
		async load() {
			const stored = await deps.area.get(BULK_SAVE_RUNS_KEY);
			replace(parseBulkSaveRuns(stored[BULK_SAVE_RUNS_KEY]));
			return runs;
		},
		all: () => runs,
		ofWindow: (windowId) => runs.find((run) => run.windowId === windowId),
		byRunId,
		async set(run) {
			const stored = bumped(run);
			replace([...runs.filter((held) => held.windowId !== run.windowId), stored]);
			await persist();
			return stored;
		},
		async apply({ runId, update }) {
			const held = byRunId(runId);
			if (held === undefined) return undefined;
			const stored = bumped(update(held));
			replace(runs.map((run) => (run === held ? stored : run)));
			await persist();
			return stored;
		},
		async applyEvents(events) {
			let changed = false;
			replace(
				runs.map((run) => {
					const moved = applyLinkEvents(run, events);
					if (moved === run) return run;
					changed = true;
					return bumped(moved);
				}),
			);
			if (changed) await persist();
		},
		async admitted({ runId, jobs }) {
			const bindings: LinkEvent[] = jobs.map((job) => ({ kind: "admitted", url: job.url, jobId: job.jobId }));
			const adoptions: LinkEvent[] = jobs.flatMap((job) =>
				job.supersededJobIds.map((supersededJobId): LinkEvent => ({ kind: "adopted", supersededJobId, jobId: job.jobId })),
			);
			const admitting = byRunId(runId);
			let changed = false;
			replace(
				runs.map((run) => {
					const moved = applyLinkEvents(run, run === admitting ? bindings : adoptions);
					if (moved === run) return run;
					changed = true;
					return bumped(moved);
				}),
			);
			if (changed) await persist();
		},
		async clear() {
			replace([]);
			await persist();
		},
	};
}
