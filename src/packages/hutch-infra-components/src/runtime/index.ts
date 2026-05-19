import assert from "node:assert";
import {
	EventBridgeClient,
	PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

export {
	initSqsCommandDispatcher,
	type DispatchCommand,
} from "./sqs-command-dispatcher";

export type PublishEvent = (params: {
	source: string;
	detailType: string;
	detail: string;
}) => Promise<void>;

/** Defensive cap to keep `PutEventsCommand` requests inside EventBridge's
 * 256 KB per-request limit. 16 KB of headroom covers AWS-side envelope fields
 * (`EventBusName`, `Resources`, `Time`, …) that don't appear in `Entries`.
 *
 * After the refresh-html migration, every wire payload in this repo is sub-1 KB;
 * an oversized event is a programming error (HTML/PDF bytes back-doored into
 * detail), not a runtime case. Hard-fail at the publisher so the SQS DLQ +
 * email alarm pages the operator immediately, instead of bouncing 400s off
 * AWS for the SQS visibility window. */
const MAX_PUT_EVENTS_REQUEST_BYTES = 240_000;

export class PayloadTooLargeError extends Error {
	readonly source: string;
	readonly detailType: string;
	readonly byteLength: number;

	constructor(params: { source: string; detailType: string; byteLength: number }) {
		super(
			`EventBridge PutEvents payload too large: ${params.byteLength} bytes ` +
				`(limit ${MAX_PUT_EVENTS_REQUEST_BYTES}) for ${params.source}/${params.detailType}`,
		);
		this.name = "PayloadTooLargeError";
		this.source = params.source;
		this.detailType = params.detailType;
		this.byteLength = params.byteLength;
	}
}

export function initEventBridgePublisher(deps: {
	client: EventBridgeClient;
	eventBusName: string;
}): { publishEvent: PublishEvent } {
	const { client, eventBusName } = deps;

	const publishEvent: PublishEvent = async (params) => {
		const Entries = [
			{
				Source: params.source,
				DetailType: params.detailType,
				Detail: params.detail,
				EventBusName: eventBusName,
			},
		];
		const byteLength = Buffer.byteLength(JSON.stringify(Entries), "utf8");
		if (byteLength > MAX_PUT_EVENTS_REQUEST_BYTES) {
			throw new PayloadTooLargeError({
				source: params.source,
				detailType: params.detailType,
				byteLength,
			});
		}
		const result = await client.send(new PutEventsCommand({ Entries }));
		assert(
			result.FailedEntryCount === 0,
			`EventBridge PutEvents failed: ${JSON.stringify(result.Entries)}`,
		);
	};

	return { publishEvent };
}

export { EventBridgeClient };
