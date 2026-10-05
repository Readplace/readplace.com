import type { SQSRecord } from "aws-lambda";
import type { GmailHttpAttempt, GmailHttpClassification } from "@packages/provider-contracts/gmail-history";
import type {
	GmailDiagnosticEvent,
	GmailImportRecordCorrelation,
	GmailImportRecordStep,
	RecordGmailDiagnostic,
} from "../../observability/gmail-diagnostics";
import { errorClassName } from "./error-class-name";
import type { ObserveGmailHistoryImport } from "./gmail-history-import-observation.types";

export type GmailImportRecordIdentity = Pick<GmailImportRecordCorrelation, "envelopeKind" | "userId" | "jobId" | "generation" | "page">;

export interface GmailImportRecordTrace {
	identify: (identity: GmailImportRecordIdentity) => void;
	observe: ObserveGmailHistoryImport;
	step: (step: GmailImportRecordStep) => void;
	publish: (publication: { target: string; send: () => Promise<void> }) => Promise<void>;
	acked: () => void;
	retryRequested: (error: unknown) => void;
}

type DiagnosticLevel = GmailDiagnosticEvent["level"];

const ERROR_CLASSIFICATIONS: ReadonlySet<GmailHttpClassification> = new Set(["transport-failed", "exception", "unavailable"]);
const ERROR_STEPS: ReadonlySet<GmailImportRecordStep["kind"]> = new Set(["job-failed", "gmail-call-failed", "message-publication-failed"]);

function queueName(arn: string): string {
	return arn.slice(arn.lastIndexOf(":") + 1);
}

function attemptLevel(attempt: GmailHttpAttempt): DiagnosticLevel {
	return ERROR_CLASSIFICATIONS.has(attempt.classification) ? "ERROR" : "INFO";
}

function stepLevel(step: GmailImportRecordStep): DiagnosticLevel {
	return ERROR_STEPS.has(step.kind) ? "ERROR" : "INFO";
}

export function startGmailImportRecordTrace(input: {
	handler: GmailImportRecordCorrelation["handler"];
	invocationId: string;
	record: SQSRecord;
	recordDiagnostic: RecordGmailDiagnostic;
	now: () => Date;
}): GmailImportRecordTrace {
	const { record, recordDiagnostic, now } = input;
	const startedAt = now().getTime();
	const deadLetterSourceArn = record.attributes.DeadLetterQueueSourceArn;
	let correlation: GmailImportRecordCorrelation = {
		handler: input.handler,
		invocationId: input.invocationId,
		sqsMessageId: record.messageId,
		receiveCount: Number(record.attributes.ApproximateReceiveCount),
		sourceQueue: queueName(record.eventSourceARN),
		deadLetterSourceQueue: deadLetterSourceArn === undefined ? undefined : queueName(deadLetterSourceArn),
		envelopeKind: undefined,
		userId: undefined,
		jobId: undefined,
		generation: undefined,
		page: undefined,
	};
	let sequence = 0;
	const nextSequence = () => {
		sequence += 1;
		return sequence;
	};

	const step = (recorded: GmailImportRecordStep) => {
		recordDiagnostic({ ...correlation, event: "gmail.import.step", level: stepLevel(recorded), sequence: nextSequence(), step: recorded });
	};

	const finish = (finished: { outcome: "acked" | "retry-requested"; level: DiagnosticLevel; errorName: string | undefined }) => {
		recordDiagnostic({ ...correlation, event: "gmail.import.record.finished", ...finished, durationMs: now().getTime() - startedAt });
	};

	recordDiagnostic({ ...correlation, event: "gmail.import.record.started", level: "INFO" });

	return {
		identify: (identity) => {
			correlation = { ...correlation, ...identity };
		},
		observe: (observation) => {
			if (observation.kind === "http-attempt") {
				recordDiagnostic({ ...correlation, event: "gmail.http.attempt", level: attemptLevel(observation.attempt), sequence: nextSequence(), ...observation.attempt });
			} else {
				step(observation);
			}
		},
		step,
		publish: async ({ target, send }) => {
			try {
				await send();
			} catch (error) {
				recordDiagnostic({ ...correlation, event: "gmail.import.publication", level: "ERROR", sequence: nextSequence(), target, outcome: "failed", errorName: errorClassName(error) });
				throw error;
			}
			recordDiagnostic({ ...correlation, event: "gmail.import.publication", level: "INFO", sequence: nextSequence(), target, outcome: "published", errorName: undefined });
		},
		acked: () => finish({ outcome: "acked", level: "INFO", errorName: undefined }),
		retryRequested: (error) => finish({ outcome: "retry-requested", level: "ERROR", errorName: errorClassName(error) }),
	};
}
