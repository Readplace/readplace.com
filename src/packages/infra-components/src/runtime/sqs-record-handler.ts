import assert from "node:assert";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";
import type { CommandDefinition } from "../events";

export type RecordContext = { readonly messageId: string; readonly receiveCount: number; readonly body: string };

export type RecordFailureReport<T> =
	| { message: string }
	| { report: (params: { record: RecordContext; error: unknown; detail: T | undefined }) => void | Promise<void> };

export type MalformedRecordPolicy<T> =
	| { policy: "retry" }
	| ({ policy: "retry" | "acknowledge" } & RecordFailureReport<T>);

type RecordLogger = {
	error: (message: string, details?: { readonly error?: unknown; readonly [field: string]: unknown }) => void;
};

const EnvelopeSchema = z.object({ detail: z.unknown() });

type ParsedRecord<T> = { ok: true; detail: T } | { ok: false; error: unknown };

function parseRecord<S extends z.ZodTypeAny>(params: { schema: S; body: string }): ParsedRecord<z.infer<S>> {
	const { schema, body } = params;
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch (error) {
		return { ok: false, error };
	}
	const envelope = EnvelopeSchema.safeParse(json);
	if (!envelope.success) return { ok: false, error: envelope.error };
	const detail = z.safeParse(schema, envelope.data.detail);
	if (!detail.success) return { ok: false, error: detail.error };
	return { ok: true, detail: detail.data };
}

async function reportFailure<T>(params: {
	logger: RecordLogger;
	failure: RecordFailureReport<T>;
	record: RecordContext;
	error: unknown;
	detail: T | undefined;
}): Promise<void> {
	const { logger, failure, record, error, detail } = params;
	if ("message" in failure) {
		logger.error(failure.message, { messageId: record.messageId, error });
		return;
	}
	await failure.report({ record, error, detail });
}

function toRecordContext(sqsRecord: SQSRecord): RecordContext {
	return {
		messageId: sqsRecord.messageId,
		receiveCount: Number(sqsRecord.attributes.ApproximateReceiveCount),
		body: sqsRecord.body,
	};
}

type RecordOutcome = "acknowledge" | "retry";

function initRecordLoop<D extends CommandDefinition<z.ZodTypeAny>>(deps: {
	definition: D;
	logger: RecordLogger;
	failure: RecordFailureReport<z.infer<D["detailSchema"]>>;
	malformed: MalformedRecordPolicy<z.infer<D["detailSchema"]>>;
	processRecord: (params: {
		detail: z.infer<D["detailSchema"]>;
		record: RecordContext;
		sqsRecord: SQSRecord;
	}) => Promise<RecordOutcome>;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { definition, logger, failure, malformed, processRecord } = deps;
	const malformedReport: RecordFailureReport<z.infer<D["detailSchema"]>> =
		"message" in malformed || "report" in malformed ? malformed : failure;

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const sqsRecord of event.Records) {
			const record = toRecordContext(sqsRecord);
			const parsed = parseRecord<D["detailSchema"]>({ schema: definition.detailSchema, body: sqsRecord.body });
			if (!parsed.ok) {
				await reportFailure({ logger, failure: malformedReport, record, error: parsed.error, detail: undefined });
				if (malformed.policy === "retry") batchItemFailures.push({ itemIdentifier: record.messageId });
				continue;
			}
			try {
				const outcome = await processRecord({ detail: parsed.detail, record, sqsRecord });
				if (outcome === "retry") batchItemFailures.push({ itemIdentifier: record.messageId });
			} catch (error) {
				await reportFailure({ logger, failure, record, error, detail: parsed.detail });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}

export function initSqsRecordHandler<D extends CommandDefinition<z.ZodTypeAny>>(deps: {
	definition: D;
	logger: RecordLogger;
	failure: RecordFailureReport<z.infer<D["detailSchema"]>>;
	malformed: MalformedRecordPolicy<z.infer<D["detailSchema"]>>;
	handle: (detail: z.infer<D["detailSchema"]>, record: RecordContext) => Promise<void>;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { handle, ...loop } = deps;
	return initRecordLoop({
		...loop,
		processRecord: async ({ detail, record }) => {
			await handle(detail, record);
			return "acknowledge";
		},
	});
}

export type RecordSettlement = { kind: "settled" } | { kind: "retry-later" };

export type ChangeVisibility = (params: { receiptHandle: string; visibilityTimeoutSeconds: number }) => Promise<void>;

export function initRetryingSqsRecordHandler<D extends CommandDefinition<z.ZodTypeAny>>(deps: {
	definition: D;
	logger: RecordLogger;
	failure: RecordFailureReport<z.infer<D["detailSchema"]>>;
	malformed: MalformedRecordPolicy<z.infer<D["detailSchema"]>>;
	changeVisibility: ChangeVisibility;
	random: () => number;
	retryScheduleSeconds: readonly number[];
	visibilityFailureMessage: string;
	handle: (detail: z.infer<D["detailSchema"]>, record: RecordContext) => Promise<RecordSettlement>;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { handle, changeVisibility, random, retryScheduleSeconds, visibilityFailureMessage, ...loop } = deps;
	return initRecordLoop({
		...loop,
		processRecord: async ({ detail, record, sqsRecord }) => {
			const settlement = await handle(detail, record);
			if (settlement.kind === "settled") return "acknowledge";
			const baseSeconds = retryScheduleSeconds[record.receiveCount - 1];
			assert(
				baseSeconds !== undefined,
				`retry requested on receive ${record.receiveCount}, past a schedule of ${retryScheduleSeconds.length}`,
			);
			const visibilityTimeoutSeconds = Math.round(baseSeconds * (0.8 + 0.4 * random()));
			try {
				await changeVisibility({ receiptHandle: sqsRecord.receiptHandle, visibilityTimeoutSeconds });
			} catch (error) {
				loop.logger.error(visibilityFailureMessage, { messageId: record.messageId, error });
			}
			return "retry";
		},
	});
}
