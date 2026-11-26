import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import {
	type SavedLinksJobAction,
	type SavedLinksJobCountCode,
	type SavedLinksJobCounts,
	SavedLinksJobIdSchema,
} from "@packages/domain/article";
import { RunSavedLinksJobCommand, SavedLinksJobCompletedEvent, SavedLinksJobFailedEvent } from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type {
	FindSavedLinksJob,
	FinishSavedLinksJob,
	RecordSavedLinksJobProgress,
} from "@packages/provider-contracts/article-store";
import { USER_DATA_JOBS_MAX_RECEIVE_COUNT } from "./max-receive-count";
import type { RunSavedLinksJobAction } from "./saved-links-job.types";

const KEPT_ON_RESUME: Record<SavedLinksJobAction, readonly SavedLinksJobCountCode[]> = {
	remove: ["held", "held-issue"],
	restore: ["restored", "restored-issue"],
	count: [],
};

export function initSavedLinksJobHandler(deps: {
	findSavedLinksJob: FindSavedLinksJob;
	recordSavedLinksJobProgress: RecordSavedLinksJobProgress;
	finishSavedLinksJob: FinishSavedLinksJob;
	runners: Record<SavedLinksJobAction, RunSavedLinksJobAction>;
	publishEvent: PublishEvent;
	logger: Logger;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: RunSavedLinksJobCommand,
		logger: deps.logger,
		failure: { message: "[saved-links-job] record failed" },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { userId } = detail;
			const jobId = SavedLinksJobIdSchema.parse(detail.jobId);
			const action: SavedLinksJobAction = detail.job.action;
			let counts: SavedLinksJobCounts = {};
			const recordProgress = async (next: SavedLinksJobCounts) => {
				counts = next;
				return deps.recordSavedLinksJobProgress({ userId, jobId, counts: next });
			};
			try {
				const job = await deps.findSavedLinksJob({ userId });
				if (job === undefined || job.jobId !== jobId || job.state === "completed") {
					deps.logger.info("[saved-links-job] stale job", { jobId, state: job?.state });
					return;
				}
				const prior = Object.fromEntries(
					KEPT_ON_RESUME[action].flatMap((code) => (job.counts[code] === undefined ? [] : [[code, job.counts[code]]])),
				);
				const started = await recordProgress(prior);
				const resumed = job.state !== "requested";
				const run =
					started.outcome === "stale"
						? started
						: await deps.runners[action]({ userId, jobId, detail, counts, resumed, recordProgress });
				if (run.outcome === "stale") {
					deps.logger.info("[saved-links-job] job moved on while running", { jobId });
					return;
				}
				const finished = await deps.finishSavedLinksJob({
					userId,
					jobId,
					state: "completed",
					counts: run.counts,
					finishedAt: deps.now(),
				});
				if (finished.outcome === "stale") {
					deps.logger.info("[saved-links-job] job moved on before it finished", { jobId });
					return;
				}
				await deps.publishEvent(SavedLinksJobCompletedEvent, {
					userId,
					jobId,
					action,
					counts: run.counts,
					completedAt: deps.now().toISOString(),
				});
			} catch (error) {
				if (record.receiveCount >= USER_DATA_JOBS_MAX_RECEIVE_COUNT) {
					const failedAt = deps.now();
					const failed = await deps.finishSavedLinksJob({ userId, jobId, state: "failed", counts, finishedAt: failedAt });
					if (failed.outcome === "recorded") {
						await deps.publishEvent(SavedLinksJobFailedEvent, { userId, jobId, action, failedAt: failedAt.toISOString() });
					}
				}
				throw error;
			}
		},
	});
}
