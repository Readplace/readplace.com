import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import type { GmailConnectionsCountLine } from "../observability/events";
import {
	initCountGmailConnectionsHandler,
	type CountGmailConnectionsDeps,
} from "./count-gmail-connections-handler";

const TRIGGER = JSON.stringify({ trigger: "count-gmail-connections" });

function createMetricLog() {
	const lines: GmailConnectionsCountLine[] = [];
	const metricLog: HutchLogger.Typed<GmailConnectionsCountLine> = {
		info: (data) => lines.push(data),
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	return { metricLog, lines };
}

function createHandler(overrides: Partial<CountGmailConnectionsDeps> = {}) {
	const { metricLog, lines } = createMetricLog();
	const deps: CountGmailConnectionsDeps = {
		countConnected: jest.fn().mockResolvedValue(0),
		metricLog,
		logger: noopLogger,
		...overrides,
	};
	return { handler: initCountGmailConnectionsHandler(deps), deps, lines };
}

describe("initCountGmailConnectionsHandler", () => {
	it("emits one metric line carrying the current connected count and acks the tick", async () => {
		const { handler, lines } = createHandler({
			countConnected: jest.fn().mockResolvedValue(90),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(lines).toEqual([{ event: "gmail_connections_counted", count: 90 }]);
	});

	it("reports a batch item failure when the count query throws so SQS redrives the tick", async () => {
		const { handler, lines } = createHandler({
			countConnected: jest.fn().mockRejectedValue(new Error("dynamo down")),
		});

		const result = await handler(
			buildSqsEvent([{ messageId: "tick-1", body: TRIGGER }]),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "tick-1" }] });
		expect(lines).toEqual([]);
	});
});
