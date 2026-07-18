import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { CloudWatchLogsEvent, Handler } from "aws-lambda";
import type { HutchLogger } from "@packages/hutch-logger";

/** One forwarded log line: the source event's timestamp, and its JSON payload
 * with the Lambda-Text preamble stripped (see `extractJsonPayload`). */
export interface ForwardLogEvent {
	timestamp: number;
	message: string;
}

export type CreateLogStream = (params: {
	logGroupName: string;
	logStreamName: string;
}) => Promise<void>;

/** What PutLogEvents reports when it accepted the request but dropped individual
 * events: `[0, tooOldLogEventEndIndex)` were older than the 14-day ingest floor,
 * `[tooNewLogEventStartIndex, batch.length)` too far in the future, and
 * `[0, expiredLogEventEndIndex)` outside the group's retention. Absent when the
 * whole batch was stored. */
export interface RejectedLogEventsInfo {
	tooOldLogEventEndIndex?: number;
	tooNewLogEventStartIndex?: number;
	expiredLogEventEndIndex?: number;
}

export type PutLogEvents = (params: {
	logGroupName: string;
	logStreamName: string;
	logEvents: readonly ForwardLogEvent[];
}) => Promise<RejectedLogEventsInfo | undefined>;

export interface ForwardAnalyticsDeps {
	createLogStream: CreateLogStream;
	putLogEvents: PutLogEvents;
	destinationLogGroupName: string;
	logger: HutchLogger;
}

const CONTROL_MESSAGE = "CONTROL_MESSAGE";

/** First-phase parse: read only the discriminator so a subscription-validation
 * CONTROL_MESSAGE (which carries no real log data) is recognised before the
 * strict DATA_MESSAGE schema would reject it. */
const MessageEnvelopeSchema = z.object({ messageType: z.string() });

const DataMessageSchema = z.object({
	messageType: z.literal("DATA_MESSAGE"),
	logGroup: z.string(),
	logStream: z.string(),
	logEvents: z.array(z.object({ timestamp: z.number(), message: z.string() })),
});

/** PutLogEvents batch limits (AWS CloudWatch Logs). A batch may hold at most
 * 10,000 events and 1,048,576 bytes (each event counts as its UTF-8 message
 * bytes plus a fixed 26-byte overhead) and may not span more than 24 hours. */
const MAX_EVENTS_PER_BATCH = 10_000;
const MAX_BATCH_BYTES = 1_048_576;
const PER_EVENT_OVERHEAD_BYTES = 26;
const MAX_BATCH_SPAN_MS = 24 * 60 * 60 * 1000;

/** Splits one delivery's events into PutLogEvents-legal batches. Callers must pass
 * events already sorted by timestamp: PutLogEvents rejects a non-chronological
 * batch outright, and the span check below measures each event against the batch's
 * first timestamp, so unsorted input would also let a batch exceed 24 hours
 * undetected. A new batch starts when the next event would push the current one
 * past the count, byte, or 24-hour-span limit. */
export function chunkLogEvents(events: readonly ForwardLogEvent[]): ForwardLogEvent[][] {
	const chunks: ForwardLogEvent[][] = [];
	let current: ForwardLogEvent[] = [];
	let currentBytes = 0;
	let chunkStart = 0;

	for (const event of events) {
		const eventBytes = Buffer.byteLength(event.message, "utf8") + PER_EVENT_OVERHEAD_BYTES;
		const exceedsCount = current.length >= MAX_EVENTS_PER_BATCH;
		const exceedsBytes = currentBytes + eventBytes > MAX_BATCH_BYTES;
		const exceedsSpan = current.length > 0 && event.timestamp - chunkStart > MAX_BATCH_SPAN_MS;

		if (current.length > 0 && (exceedsCount || exceedsBytes || exceedsSpan)) {
			chunks.push(current);
			current = [];
			currentBytes = 0;
		}
		if (current.length === 0) chunkStart = event.timestamp;
		current.push(event);
		currentBytes += eventBytes;
	}

	if (current.length > 0) chunks.push(current);
	return chunks;
}

/**
 * Strips the Lambda-Text preamble so only the JSON object is forwarded.
 *
 * A source line is `<iso-ts>\t<reqId>\t<level>\t<json>\n`. CloudWatch Logs
 * Insights only auto-discovers JSON fields (`stream`, `event`, `utm_*`, …) when
 * the stored message is *pure* JSON — the Lambda-format field discovery that
 * makes `filter stream="…"` work on the source `/aws/lambda/*` groups does NOT
 * apply to the destination group (verified against a live staging deploy). So we
 * forward the JSON object alone: the event timestamp is preserved separately, and
 * no analytics dashboard query needs the reqId/level preamble.
 *
 * The object spans the first `{` to the last `}` (index scan, not a regex, to
 * avoid catastrophic backtracking on large messages); a `}` inside a string value
 * never wins because the outermost close is always the final `}` on the line. A
 * line with no braces (should not occur — the subscription filter only matches
 * JSON with a `stream` field) is forwarded unchanged.
 */
export function extractJsonPayload(message: string): string {
	const start = message.indexOf("{");
	const end = message.lastIndexOf("}");
	if (start === -1 || end < start) return message;
	return message.slice(start, end + 1);
}

function isAlreadyExists(error: unknown): boolean {
	return error instanceof Error && error.name === "ResourceAlreadyExistsException";
}

/** Forwards a CloudWatch Logs subscription delivery into the never-expire
 * analytics group. The source `messageType`, `logGroup`, and `logStream` name the
 * destination stream `<sourceGroup>/<sourceStream>`, which keeps the origin
 * queryable via `@logStream` and makes redeliveries idempotent on the stream. Each
 * line's JSON payload is forwarded (preamble stripped) so Logs Insights can query
 * its fields — see `extractJsonPayload`.
 *
 * A rejection is deliberately propagated: CloudWatch Logs → Lambda is
 * at-least-once, so a failed delivery is redelivered (and after the async retry
 * budget, parked on the forwarder's on-failure queue). Duplicates are acceptable —
 * deterministic chunk order bounds them — but dropped analytics are not. */
export function initForwardAnalyticsHandler(
	deps: ForwardAnalyticsDeps,
): Handler<CloudWatchLogsEvent, void> {
	const { createLogStream, putLogEvents, destinationLogGroupName, logger } = deps;

	return async (event): Promise<void> => {
		const decoded: unknown = JSON.parse(
			gunzipSync(Buffer.from(event.awslogs.data, "base64")).toString("utf8"),
		);

		const envelope = MessageEnvelopeSchema.parse(decoded);
		if (envelope.messageType === CONTROL_MESSAGE) {
			logger.info("[ForwardAnalytics] skipped subscription control message");
			return;
		}

		const data = DataMessageSchema.parse(decoded);
		const logStreamName = `${data.logGroup}/${data.logStream}`;
		/* Sorted, not merely mapped: PutLogEvents rejects a batch whose events are not
		 * in chronological order, and AWS documents no ordering guarantee for the
		 * events inside a subscription delivery. An unsorted delivery would fail
		 * identically on every retry and again on replay, so this sort is what keeps
		 * such a delivery recoverable rather than permanently stuck. */
		const events = data.logEvents
			.map((logEvent) => ({
				timestamp: logEvent.timestamp,
				message: extractJsonPayload(logEvent.message),
			}))
			.sort((a, b) => a.timestamp - b.timestamp);
		const chunks = chunkLogEvents(events);

		if (chunks.length === 0) {
			logger.info("[ForwardAnalytics] delivery had no log events", {
				sourceLogGroup: data.logGroup,
				sourceLogStream: data.logStream,
			});
			return;
		}

		try {
			await createLogStream({ logGroupName: destinationLogGroupName, logStreamName });
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
		}

		for (const logEvents of chunks) {
			const rejected = await putLogEvents({
				logGroupName: destinationLogGroupName,
				logStreamName,
				logEvents,
			});
			/* PutLogEvents can succeed while silently discarding individual events. On
			 * the live path they are always fresh, but a failure-queue replay near the
			 * 14-day ingest floor can lose lines behind a 200 — so this is logged as an
			 * error instead of being swallowed by the "forwarded" line below. */
			if (rejected) {
				logger.error("[ForwardAnalytics] PutLogEvents discarded events from an accepted batch", {
					sourceLogGroup: data.logGroup,
					sourceLogStream: data.logStream,
					batchSize: logEvents.length,
					rejected,
				});
			}
		}

		logger.info("[ForwardAnalytics] forwarded", {
			sourceLogGroup: data.logGroup,
			sourceLogStream: data.logStream,
			events: data.logEvents.length,
			batches: chunks.length,
		});
	};
}
