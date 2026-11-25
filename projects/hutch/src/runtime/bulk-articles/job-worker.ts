import { USER_DATA_JOBS_MAX_RECEIVE_COUNT } from "../saved-links-job/max-receive-count";
import type { SQSBatchResponse, SQSEvent, Context } from "aws-lambda";
import { z } from "zod";
import { RunBulkArticlesCommand, BulkArticlesProgressedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { BulkSelection, BulkSelectionStore, SelectionTarget } from "./selection";

export interface BulkWork {
	prepare(job: BulkSelection, remainingMs: () => number): Promise<{ targets: SelectionTarget[]; next?: string }>;
	execute(job: BulkSelection, remainingMs: () => number): Promise<void>;
}

export function initBulkWorker(deps: {
	store: BulkSelectionStore; work: BulkWork; publishEvent: PublishEvent; now: () => Date; logger: Logger;
}) {
	const envelope = z.discriminatedUnion("detail-type", [
		z.object({ "detail-type": z.literal(RunBulkArticlesCommand.detailType), detail: RunBulkArticlesCommand.detailSchema }),
		z.object({ "detail-type": z.literal(BulkArticlesProgressedEvent.detailType), detail: BulkArticlesProgressedEvent.detailSchema }),
	]);
	return async (event: SQSEvent, context: Pick<Context, "getRemainingTimeInMillis">): Promise<SQSBatchResponse> => {
		const batchItemFailures = [];
		for (const record of event.Records) {
			let attempted: BulkSelection | undefined;
			try {
				const message = envelope.parse(JSON.parse(record.body));
				const { userId, id, generation } = message.detail;
				let job = await deps.store.get(userId, id);
				if (!job || job.expiresAt <= Math.floor(deps.now().getTime() / 1000)) continue;
				// A redriven command may have committed one checkpoint before its publication failed.
				const canResume = generation === job.generation || (message["detail-type"] === RunBulkArticlesCommand.detailType && generation + 1 === job.generation);
				if (job.state === "failed" && canResume && (Number(record.attributes.ApproximateReceiveCount) === 1 || ("intent" in message.detail && message.detail.intent === "retry"))) {
					await deps.store.retry(job);
					job = await deps.store.get(userId, id);
					if (!job) continue;
				}
				attempted = job;
				if (message["detail-type"] === RunBulkArticlesCommand.detailType && "intent" in message.detail && generation === job.generation) {
					if (message.detail.intent === "confirm") await deps.store.confirm(job, deps.now());
					if (message.detail.intent === "restore") await deps.store.restore(job, deps.now());
					job = await deps.store.get(userId, id);
				}
				if (!job || !["preparing", "running", "restoring"].includes(job.state)) continue;
				if (generation > job.generation) throw new Error("bulk command precedes its checkpoint");
				const signal = { userId, id, generation: job.generation };
				if (message["detail-type"] === BulkArticlesProgressedEvent.detailType) {
					if (job.generation === generation) await deps.publishEvent(RunBulkArticlesCommand, signal);
					continue;
				}
				if (generation === job.generation) {
					if (context.getRemainingTimeInMillis() < 10_000) throw new Error("insufficient time for another bulk step");
					if (job.state === "preparing") {
						const { targets, next } = await deps.work.prepare(job, () => context.getRemainingTimeInMillis());
						await deps.store.append(job, targets, next, deps.now());
					} else {
						await deps.work.execute(job, () => context.getRemainingTimeInMillis());
					}
				}
				const next = await deps.store.get(userId, id);
				// A redelivered command repairs a lost publication after its checkpoint committed.
				if (next && next.generation === generation + 1 && ["preparing", "running", "restoring"].includes(next.state)) {
					attempted = next;
					await deps.publishEvent(BulkArticlesProgressedEvent, { userId, id, generation: next.generation });
				}
			} catch (error) {
				if (attempted && Number(record.attributes.ApproximateReceiveCount) >= USER_DATA_JOBS_MAX_RECEIVE_COUNT) {
					const current = await deps.store.get(attempted.userId, attempted.id);
					if (current?.generation === attempted.generation && current.state === attempted.state) await deps.store.fail(current);
				}
				deps.logger.error("[bulk-articles] step failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
