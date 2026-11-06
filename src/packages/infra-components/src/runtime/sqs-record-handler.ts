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

export function initSqsRecordHandler<D extends CommandDefinition<z.ZodTypeAny>>(deps: {
	definition: D;
	logger: RecordLogger;
	failure: RecordFailureReport<z.infer<D["detailSchema"]>>;
	malformed: MalformedRecordPolicy<z.infer<D["detailSchema"]>>;
	handle: (detail: z.infer<D["detailSchema"]>, record: RecordContext) => Promise<void>;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { definition, logger, failure, malformed, handle } = deps;
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
				await handle(parsed.detail, record);
			} catch (error) {
				await reportFailure({ logger, failure, record, error, detail: parsed.detail });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
