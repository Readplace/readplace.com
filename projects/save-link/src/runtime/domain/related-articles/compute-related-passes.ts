import type {
	Handler,
	SQSBatchResponse,
	SQSEvent,
	SQSRecord,
} from "aws-lambda";
import {
	CanonicalContentChangedEvent,
	ComputeRelatedPastReadsCommand,
	QueueEntryCreatedEvent,
} from "@packages/hutch-infra-components";

const detailTypeOf = (record: SQSRecord): unknown =>
	JSON.parse(record.body)["detail-type"];

export function initComputeRelatedPasses(deps: {
	nextReadHandler: Handler<SQSEvent, SQSBatchResponse>;
	pastReadsHandler: Handler<SQSEvent, SQSBatchResponse>;
	recomputeNextReadHandler: Handler<SQSEvent, SQSBatchResponse>;
}): Handler<SQSEvent, SQSBatchResponse> {
	// One queue feeds both computations. A new save (QueueEntryCreated) precomputes
	// Next read AND, independently, the past-reads topic section; the explicit
	// ComputeRelatedPastReads command re-runs only the past-reads section for an
	// existing or stale save. A record that fails either pass is retried whole; both
	// passes are idempotent (Next read is terminal-once, past reads is
	// fingerprint-guarded), so re-running the succeeded pass is a no-op.
	const handler: Handler<SQSEvent, SQSBatchResponse> = async (
		event,
		context,
		callback,
	) => {
		const nextReadRecords = event.Records.filter(
			(record) => detailTypeOf(record) === QueueEntryCreatedEvent.detailType,
		);
		const pastReadsRecords = event.Records.filter((record) => {
			const detailType = detailTypeOf(record);
			return (
				detailType === QueueEntryCreatedEvent.detailType ||
				detailType === ComputeRelatedPastReadsCommand.detailType
			);
		});
		const contentChangedRecords = event.Records.filter(
			(record) => detailTypeOf(record) === CanonicalContentChangedEvent.detailType,
		);

		const failed = new Set<string>();
		const [nextRead, pastReads, recomputeNextRead] = await Promise.all([
			deps.nextReadHandler(
				{ ...event, Records: nextReadRecords },
				context,
				callback,
			),
			deps.pastReadsHandler(
				{ ...event, Records: pastReadsRecords },
				context,
				callback,
			),
			deps.recomputeNextReadHandler(
				{ ...event, Records: contentChangedRecords },
				context,
				callback,
			),
		]);
		for (const pass of [nextRead, pastReads, recomputeNextRead]) {
			for (const failure of pass?.batchItemFailures ?? [])
				failed.add(failure.itemIdentifier);
		}

		return {
			batchItemFailures: [...failed].map((itemIdentifier) => ({
				itemIdentifier,
			})),
		};
	};

	return handler;
}
