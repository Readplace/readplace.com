import { gzipSync } from "node:zlib";
import { ZodError } from "zod";
import type { CloudWatchLogsEvent, Handler } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import {
	classifyForwardedLine,
	extractJsonPayload,
	initForwardAnalyticsHandler,
	type ForwardAnalyticsDeps,
	type ForwardLogEvent,
} from "./forward-analytics-handler";

const DESTINATION = "/readplace/analytics";
const ERRORS_DESTINATION = "/readplace/errors";
const ANALYTICS_STREAMS = ["analytics", "conversions", "subscriptions"] as const;
const SOURCE_GROUP = "/aws/lambda/hutch-handler";
const SOURCE_STREAM = "2026/07/17/[$LATEST]abc";
const DEST_STREAM = `${SOURCE_GROUP}/${SOURCE_STREAM}`;
const BASE_TS = 1_752_768_512_073;
/** A line the classifier routes, for tests about delivery mechanics rather than
 * routing. A placeholder string would now be dropped as unclaimed. */
const ANALYTICS_LINE = '{"stream":"analytics","event":"pageview"}';
/** Wraps a batching-test payload as an analytics line so it routes to a funnel.
 * These tests are about chunking and ordering, not classification, but the
 * handler now drops a line no funnel claims — a bare tag would never be sent. */
function line(tag: string): string {
	return `{"stream":"analytics","m":"${tag}"}`;
}

function createHandler(overrides: Partial<ForwardAnalyticsDeps> = {}) {
	const deps: ForwardAnalyticsDeps = {
		createLogStream: jest.fn().mockResolvedValue(undefined),
		putLogEvents: jest.fn().mockResolvedValue(undefined),
		analyticsLogGroupName: DESTINATION,
		errorsLogGroupName: ERRORS_DESTINATION,
		analyticsStreams: ANALYTICS_STREAMS,
		logger: noopLogger,
		...overrides,
	};
	return { handler: initForwardAnalyticsHandler(deps), deps };
}

function envelope(payload: unknown): CloudWatchLogsEvent {
	return { awslogs: { data: gzipSync(Buffer.from(JSON.stringify(payload))).toString("base64") } };
}

function dataMessage(logEvents: ForwardLogEvent[], overrides: Record<string, unknown> = {}) {
	return envelope({
		messageType: "DATA_MESSAGE",
		owner: "123456789012",
		logGroup: SOURCE_GROUP,
		logStream: SOURCE_STREAM,
		subscriptionFilters: ["forward-analytics"],
		logEvents,
		...overrides,
	});
}

function run(handler: Handler<CloudWatchLogsEvent, void>, event: CloudWatchLogsEvent): Promise<void> {
	return Promise.resolve(handler(event, buildLambdaContext(), () => {}));
}

describe("classifyForwardedLine", () => {
	function classify(message: string) {
		return classifyForwardedLine({ message, analyticsStreams: ANALYTICS_STREAMS });
	}

	it.each(ANALYTICS_STREAMS)("routes the %s stream to the analytics funnel", (stream) => {
		expect(classify(`{"stream":"${stream}","event":"pageview"}`)).toBe("analytics");
	});

	it("routes a structured logError line to the errors funnel", () => {
		expect(classify('{"level":"ERROR","message":"boom"}')).toBe("errors");
	});

	it("routes the parse-errors stream to the errors funnel — it is operational, not business history", () => {
		expect(classify('{"stream":"parse-errors","reason":"bad html"}')).toBe("errors");
	});

	it.each([
		"2026-07-17T16:08:32.073Z 37e4-req Task timed out after 30.03 seconds",
		"RequestId: 37e4-req Error: Runtime exited with error: signal: killed",
		"2026-07-17T16:08:32.073Z\t37e4-req\tERROR\tsomething broke",
	])("routes the runtime's plain-text failure output to the errors funnel: %s", (line) => {
		expect(classify(line)).toBe("errors");
	});

	// The subscription filter is a coarse text match by necessity, so it forwards
	// lines neither funnel wants. Dropping them here is what keeps a saved article
	// whose title contains "ERROR" out of the operator's error table.
	it("claims nothing for an ordinary info line", () => {
		expect(classify('{"stream":"crawl-outcomes","outcome":"ok"}')).toBeUndefined();
	});

	it("claims nothing for a line that is not JSON and carries no failure marker", () => {
		expect(classify("START RequestId: 37e4-req Version: $LATEST")).toBeUndefined();
	});

	it("prefers analytics when a business line also carries an ERROR level, so a conversion is never lost to the error table", () => {
		expect(classify('{"stream":"conversions","level":"ERROR","event":"user_created"}')).toBe(
			"analytics",
		);
	});
});

describe("initForwardAnalyticsHandler", () => {
	it("splits one delivery across both funnels, so a single subscription filter feeds them and the second filter slot stays free", async () => {
		const { handler, deps } = createHandler();

		await run(
			handler,
			dataMessage([
				{ timestamp: BASE_TS, message: '{"stream":"analytics","event":"pageview"}' },
				{ timestamp: BASE_TS + 1, message: '{"level":"ERROR","message":"boom"}' },
			]),
		);

		expect(deps.putLogEvents).toHaveBeenCalledWith({
			logGroupName: DESTINATION,
			logStreamName: DEST_STREAM,
			logEvents: [{ timestamp: BASE_TS, message: '{"stream":"analytics","event":"pageview"}' }],
		});
		expect(deps.putLogEvents).toHaveBeenCalledWith({
			logGroupName: ERRORS_DESTINATION,
			logStreamName: DEST_STREAM,
			logEvents: [{ timestamp: BASE_TS + 1, message: '{"level":"ERROR","message":"boom"}' }],
		});
	});

	// The origin is the only thing attributing an error to the project that raised
	// it, now that the widget reads one group instead of naming each source.
	it("stamps the same <sourceGroup>/<sourceStream> name on the errors funnel as on analytics", async () => {
		const { handler, deps } = createHandler();

		await run(handler, dataMessage([{ timestamp: BASE_TS, message: '{"level":"ERROR","m":1}' }]));

		expect(deps.createLogStream).toHaveBeenCalledWith({
			logGroupName: ERRORS_DESTINATION,
			logStreamName: DEST_STREAM,
		});
	});

	it("writes nothing when the coarse filter forwarded only lines neither funnel claims", async () => {
		const { handler, deps } = createHandler();

		await run(handler, dataMessage([{ timestamp: BASE_TS, message: "START RequestId: abc" }]));

		expect(deps.createLogStream).not.toHaveBeenCalled();
		expect(deps.putLogEvents).not.toHaveBeenCalled();
	});

	it("forwards each event's JSON payload (Lambda-Text preamble stripped) with its timestamp, so Logs Insights can query the fields", async () => {
		const json = '{"stream":"analytics","event":"pageview"}';
		const sourceLine = `2026-07-17T16:08:32.073Z\t37e4-req\tINFO\t${json}\n`;
		const { handler, deps } = createHandler();

		await run(handler, dataMessage([{ timestamp: BASE_TS, message: sourceLine }]));

		expect(deps.putLogEvents).toHaveBeenCalledTimes(1);
		expect(deps.putLogEvents).toHaveBeenCalledWith({
			logGroupName: DESTINATION,
			logStreamName: DEST_STREAM,
			logEvents: [{ timestamp: BASE_TS, message: json }],
		});
	});

	it("names the destination stream <sourceGroup>/<sourceStream> and creates it before writing", async () => {
		const { handler, deps } = createHandler();

		await run(handler, dataMessage([{ timestamp: BASE_TS, message: ANALYTICS_LINE }]));

		expect(deps.createLogStream).toHaveBeenCalledWith({
			logGroupName: DESTINATION,
			logStreamName: DEST_STREAM,
		});
		const createOrder = (deps.createLogStream as jest.Mock).mock.invocationCallOrder[0];
		const putOrder = (deps.putLogEvents as jest.Mock).mock.invocationCallOrder[0];
		expect(createOrder).toBeLessThan(putOrder);
	});

	it("skips a subscription CONTROL_MESSAGE without touching either write", async () => {
		const { handler, deps } = createHandler();

		await run(
			handler,
			envelope({
				messageType: "CONTROL_MESSAGE",
				owner: "CloudwatchLogs",
				logGroup: "",
				logStream: "",
				subscriptionFilters: [],
				logEvents: [{ id: "", timestamp: BASE_TS, message: "CWL CONTROL MESSAGE: Checking health." }],
			}),
		);

		expect(deps.createLogStream).not.toHaveBeenCalled();
		expect(deps.putLogEvents).not.toHaveBeenCalled();
	});

	it("tolerates ResourceAlreadyExistsException from createLogStream and still writes", async () => {
		const alreadyExists = Object.assign(new Error("stream exists"), {
			name: "ResourceAlreadyExistsException",
		});
		const { handler, deps } = createHandler({
			createLogStream: jest.fn().mockRejectedValue(alreadyExists),
		});

		await run(handler, dataMessage([{ timestamp: BASE_TS, message: ANALYTICS_LINE }]));

		expect(deps.putLogEvents).toHaveBeenCalledTimes(1);
	});

	it("propagates any other Error from createLogStream and never writes", async () => {
		const boom = Object.assign(new Error("access denied"), { name: "AccessDeniedException" });
		const { handler, deps } = createHandler({
			createLogStream: jest.fn().mockRejectedValue(boom),
		});

		await expect(run(handler, dataMessage([{ timestamp: BASE_TS, message: ANALYTICS_LINE }]))).rejects.toThrow(
			"access denied",
		);
		expect(deps.putLogEvents).not.toHaveBeenCalled();
	});

	it("propagates a non-Error rejection from createLogStream and never writes", async () => {
		const { handler, deps } = createHandler({
			createLogStream: jest.fn().mockRejectedValue("stringly-typed failure"),
		});

		await expect(run(handler, dataMessage([{ timestamp: BASE_TS, message: ANALYTICS_LINE }]))).rejects.toBe(
			"stringly-typed failure",
		);
		expect(deps.putLogEvents).not.toHaveBeenCalled();
	});

	it("splits a delivery over 10,000 events into ordered batches of 10,000 then the remainder", async () => {
		const logEvents: ForwardLogEvent[] = Array.from({ length: 10_001 }, (_, i) => ({
			timestamp: BASE_TS + i,
			message: line(`msg-${i}`),
		}));
		const { handler, deps } = createHandler();

		await run(handler, dataMessage(logEvents));

		const calls = (deps.putLogEvents as jest.Mock).mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][0].logEvents).toHaveLength(10_000);
		expect(calls[1][0].logEvents).toHaveLength(1);
		expect(calls[0][0].logEvents[0].message).toBe(line("msg-0"));
		expect(calls[1][0].logEvents[0].message).toBe(line("msg-10000"));
	});

	it("splits on the 1 MB byte budget using UTF-8 byte length, not character count", async () => {
		// 200,000 "€" = 600,000 UTF-8 bytes but only 200,000 chars. Two events exceed
		// the 1 MB budget by bytes; by character count they would fit in one batch.
		const big = line("€".repeat(200_000));
		const logEvents: ForwardLogEvent[] = [
			{ timestamp: BASE_TS, message: big },
			{ timestamp: BASE_TS + 1, message: big },
		];
		const { handler, deps } = createHandler();

		await run(handler, dataMessage(logEvents));

		const calls = (deps.putLogEvents as jest.Mock).mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][0].logEvents).toHaveLength(1);
		expect(calls[1][0].logEvents).toHaveLength(1);
	});

	it("keeps events within a 24-hour window together and starts a new batch when the span is exceeded", async () => {
		const hour = 60 * 60 * 1000;
		const logEvents: ForwardLogEvent[] = [
			{ timestamp: BASE_TS, message: line("a") },
			{ timestamp: BASE_TS + hour, message: line("b") },
			{ timestamp: BASE_TS + 25 * hour, message: line("c") },
		];
		const { handler, deps } = createHandler();

		await run(handler, dataMessage(logEvents));

		const calls = (deps.putLogEvents as jest.Mock).mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][0].logEvents.map((e: ForwardLogEvent) => e.message)).toEqual([line("a"), line("b")]);
		expect(calls[1][0].logEvents.map((e: ForwardLogEvent) => e.message)).toEqual([line("c")]);
	});

	it("sorts a non-chronological delivery before writing — PutLogEvents rejects an out-of-order batch outright", async () => {
		const logEvents: ForwardLogEvent[] = [
			{ timestamp: BASE_TS + 2000, message: line("c") },
			{ timestamp: BASE_TS, message: line("a") },
			{ timestamp: BASE_TS + 1000, message: line("b") },
		];
		const { handler, deps } = createHandler();

		await run(handler, dataMessage(logEvents));

		const calls = (deps.putLogEvents as jest.Mock).mock.calls;
		expect(calls).toHaveLength(1);
		expect(calls[0][0].logEvents.map((e: ForwardLogEvent) => e.message)).toEqual([line("a"), line("b"), line("c")]);
	});

	it("applies the 24-hour span split on sorted order, so an out-of-order delivery cannot build an over-span batch", async () => {
		const hour = 60 * 60 * 1000;
		// Delivered newest-first: unsorted, the span check would compare against the
		// 25h-later first event, yield negative diffs, and emit one illegal 25h batch.
		const logEvents: ForwardLogEvent[] = [
			{ timestamp: BASE_TS + 25 * hour, message: line("c") },
			{ timestamp: BASE_TS, message: line("a") },
			{ timestamp: BASE_TS + hour, message: line("b") },
		];
		const { handler, deps } = createHandler();

		await run(handler, dataMessage(logEvents));

		const calls = (deps.putLogEvents as jest.Mock).mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[0][0].logEvents.map((e: ForwardLogEvent) => e.message)).toEqual([line("a"), line("b")]);
		expect(calls[1][0].logEvents.map((e: ForwardLogEvent) => e.message)).toEqual([line("c")]);
	});

	it("logs an error when PutLogEvents accepts the batch but discards events, so a replay-edge drop is never silent", async () => {
		const error = jest.fn();
		const logger: HutchLogger = { ...noopLogger, error };
		const { handler } = createHandler({
			logger,
			putLogEvents: jest.fn().mockResolvedValue({ tooOldLogEventEndIndex: 2 }),
		});

		await run(handler, dataMessage([{ timestamp: BASE_TS, message: line("a") }]));

		expect(error).toHaveBeenCalledTimes(1);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining("discarded events"),
			expect.objectContaining({ batchSize: 1, rejected: { tooOldLogEventEndIndex: 2 } }),
		);
	});

	it("propagates a putLogEvents rejection and does not send later batches", async () => {
		const hour = 60 * 60 * 1000;
		const logEvents: ForwardLogEvent[] = [
			{ timestamp: BASE_TS, message: line("a") },
			{ timestamp: BASE_TS + 25 * hour, message: line("b") },
		];
		const putLogEvents = jest.fn().mockRejectedValueOnce(new Error("throttled"));
		const { handler, deps } = createHandler({ putLogEvents });

		await expect(run(handler, dataMessage(logEvents))).rejects.toThrow("throttled");
		expect(deps.putLogEvents).toHaveBeenCalledTimes(1);
	});

	it("rejects with a ZodError when the decoded payload does not match the data-message schema", async () => {
		const { handler } = createHandler();
		const malformed = dataMessage([], { logEvents: [{ timestamp: "not-a-number", message: "m" }] });

		await expect(run(handler, malformed)).rejects.toBeInstanceOf(ZodError);
	});

	it("writes nothing when the delivery carries no log events", async () => {
		const { handler, deps } = createHandler();

		await run(handler, dataMessage([]));

		expect(deps.createLogStream).not.toHaveBeenCalled();
		expect(deps.putLogEvents).not.toHaveBeenCalled();
	});
});

describe("extractJsonPayload", () => {
	it("returns the JSON object from a Lambda-Text line, dropping the preamble and trailing newline", () => {
		const json = '{"stream":"analytics","event":"pageview","path":"/a"}';
		expect(extractJsonPayload(`2026-07-17T16:08:32.073Z\treq-1\tINFO\t${json}\n`)).toBe(json);
	});

	it("keeps a brace inside a string value — the outermost close is the last brace on the line", () => {
		const json = '{"path":"/a{b}c","stream":"analytics"}';
		expect(extractJsonPayload(`ts\treq\tINFO\t${json}`)).toBe(json);
	});

	it("returns the message unchanged when it has no JSON object", () => {
		expect(extractJsonPayload("plain log line, no braces")).toBe("plain log line, no braces");
	});

	it("returns the message unchanged when a closing brace precedes the opening brace", () => {
		expect(extractJsonPayload("} then {")).toBe("} then {");
	});
});
