import assert from "node:assert/strict";
import { inspect } from "node:util";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initRecordGmailDiagnostic, type RecordGmailDiagnostic } from "../../observability/gmail-diagnostics";

export interface CapturedGmailDiagnostic {
	version: number;
	timestamp: string;
	event: string;
	level: string;
	handler?: string;
	invocationId?: string;
	sqsMessageId?: string;
	receiveCount?: number;
	sourceQueue?: string;
	deadLetterSourceQueue?: string;
	envelopeKind?: string;
	userId?: string;
	jobId?: string;
	generation?: string;
	page?: number;
	sequence?: number;
	step?: { kind: string; [field: string]: unknown };
	target?: string;
	outcome?: string;
	errorName?: string;
	durationMs?: number;
	operation?: string;
	classification?: string;
	[field: string]: unknown;
}

interface LoggedCall {
	method: "info" | "error";
	args: unknown[];
}

export function captureGmailDiagnostics(input: { now: () => Date }) {
	const calls: LoggedCall[] = [];
	const logger = HutchLogger.from({
		...noopLogger,
		info: (...args: unknown[]) => {
			calls.push({ method: "info", args });
		},
		error: (...args: unknown[]) => {
			calls.push({ method: "error", args });
		},
	});
	const recordDiagnostic: RecordGmailDiagnostic = initRecordGmailDiagnostic({ logger, now: input.now });

	const diagnostics = (): CapturedGmailDiagnostic[] =>
		calls
			.filter((call) => call.args.length === 1)
			.map((call) => {
				const line: CapturedGmailDiagnostic = JSON.parse(String(call.args[0]));
				assert.equal(call.method === "error", line.level === "ERROR", `${line.event} is written at the level it declares`);
				return line;
			});

	return {
		logger,
		recordDiagnostic,
		diagnostics,
		otherLines: () => calls.filter((call) => call.args.length !== 1),
		everythingLogged: () => inspect(calls, { depth: null }),
	};
}

export function throwingGmailDiagnosticSink(input: { now: () => Date }): RecordGmailDiagnostic {
	return initRecordGmailDiagnostic({
		logger: HutchLogger.from({
			...noopLogger,
			info: () => {
				throw new Error("diagnostic sink unavailable");
			},
			error: () => {
				throw new Error("diagnostic sink unavailable");
			},
		}),
		now: input.now,
	});
}
