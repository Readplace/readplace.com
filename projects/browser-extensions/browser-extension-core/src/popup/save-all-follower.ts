import type { HutchLogger } from "@packages/hutch-logger";
import { type BulkSaveRun, type BulkSaveRunId, compareRecords, isActive } from "../bulk-save-run/bulk-save-run";
import type { FollowSaveAllReply, SaveAllStartReply } from "../bulk-save-run/save-all-messages";

export type Lost = { lost: true };

export const LOST: Lost = { lost: true };

function isLost<T extends object>(reply: T | Lost): reply is Lost {
	return "lost" in reply;
}

export function initSaveAllFollower(deps: {
	sendFollow: (runId: BulkSaveRunId) => Promise<FollowSaveAllReply | Lost>;
	sendAcknowledge: (runId: BulkSaveRunId) => Promise<unknown>;
	paint: (run: BulkSaveRun) => void;
	showFailure: () => void;
	showLogin: () => void;
	mark: () => void;
	logger: HutchLogger;
}) {
	let boundId: BulkSaveRunId | null = null;
	let shown: BulkSaveRun | null = null;
	const marked = new Set<BulkSaveRunId>();

	function holds(run: BulkSaveRun, runId: BulkSaveRunId): boolean {
		return run.id === runId || run.joinedIds.includes(runId);
	}

	function show(run: BulkSaveRun, runId: BulkSaveRunId): void {
		shown = run;
		deps.paint(run);
		if (isActive(run) || marked.has(run.id)) return;
		marked.add(run.id);
		deps.sendAcknowledge(runId).catch((error) => deps.logger.error("Failed to acknowledge the save-all outcome:", error));
		deps.mark();
	}

	async function followUntilFinished(input: { runId: BulkSaveRunId; refollows: number }): Promise<void> {
		const reply = await deps.sendFollow(input.runId);
		if (boundId !== input.runId) return;
		if (isLost(reply) || !reply.ok) {
			if (input.refollows > 0) return followUntilFinished({ runId: input.runId, refollows: input.refollows - 1 });
			deps.showFailure();
			return;
		}
		if (reply.run === null) {
			deps.showFailure();
			return;
		}
		show(reply.run, input.runId);
	}

	return {
		bind(runId: BulkSaveRunId): void {
			boundId = runId;
			shown = null;
		},

		async started(input: { runId: BulkSaveRunId; reply: SaveAllStartReply | Lost }): Promise<void> {
			const { runId, reply } = input;
			if (boundId !== runId) return;
			if (!isLost(reply) && !reply.ok && reply.reason === "not-logged-in") {
				deps.showLogin();
				return;
			}
			if (!isLost(reply) && reply.ok) {
				show(reply.run, runId);
				if (!isActive(reply.run)) return;
			}
			await followUntilFinished({ runId, refollows: 1 });
		},

		async followRun(run: BulkSaveRun): Promise<void> {
			boundId = run.id;
			shown = null;
			show(run, run.id);
			await followUntilFinished({ runId: run.id, refollows: 1 });
		},

		recordsChanged(runs: readonly BulkSaveRun[]): void {
			const runId = boundId;
			if (runId === null) return;
			const run = runs.find((held) => holds(held, runId));
			if (run === undefined) return;
			if (shown !== null && shown.id === run.id && compareRecords(run, shown) <= 0) return;
			show(run, runId);
		},
	};
}
