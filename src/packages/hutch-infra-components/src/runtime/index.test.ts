import assert from "node:assert/strict";
import type {
	EventBridgeClient,
	PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { z } from "zod";
import {
	SimpleCrawlUnsupportedEvent,
	StaleCheckRequestedEvent,
} from "../events";
import { initEventBridgePublisher, PayloadTooLargeError } from "./index";

function createFakeClient(sendImpl?: (cmd: PutEventsCommand) => Promise<unknown>): {
	client: Pick<EventBridgeClient, "send">;
	commands: PutEventsCommand[];
} {
	const commands: PutEventsCommand[] = [];
	const send = jest.fn().mockImplementation(async (cmd: PutEventsCommand) => {
		commands.push(cmd);
		return sendImpl ? await sendImpl(cmd) : { FailedEntryCount: 0 };
	});
	return { client: { send }, commands };
}

describe("initEventBridgePublisher", () => {
	it("forwards source/detailType/detail through to PutEventsCommand entries", async () => {
		const { client, commands } = createFakeClient();
		const { publishEvent } = initEventBridgePublisher({
			client,
			eventBusName: "test-bus",
		});

		await publishEvent(StaleCheckRequestedEvent, {
			url: "https://example.com/article",
		});

		expect(commands).toHaveLength(1);
		expect(commands[0].input.Entries).toEqual([
			{
				Source: StaleCheckRequestedEvent.source,
				DetailType: StaleCheckRequestedEvent.detailType,
				Detail: JSON.stringify({ url: "https://example.com/article" }),
				EventBusName: "test-bus",
			},
		]);
	});

	it("asserts when AWS reports a failed entry so the caller surfaces it as a Lambda failure", async () => {
		const { client } = createFakeClient(async () => ({
			FailedEntryCount: 1,
			Entries: [{ ErrorCode: "InternalException", ErrorMessage: "transient" }],
		}));
		const { publishEvent } = initEventBridgePublisher({
			client,
			eventBusName: "test-bus",
		});

		await expect(
			publishEvent(StaleCheckRequestedEvent, {
				url: "https://example.com/article",
			}),
		).rejects.toThrow(/EventBridge PutEvents failed/);
	});

	it("throws PayloadTooLargeError before calling AWS when the serialized entries exceed the cap, so an oversized payload is a programming error caught at the publisher (not a 4xx DLQ blip)", async () => {
		const { client } = createFakeClient();
		const { publishEvent } = initEventBridgePublisher({
			client,
			eventBusName: "test-bus",
		});

		// 241 KB URL — pushes the request over the 240 KB cap.
		const oversize = "x".repeat(241_000);

		await expect(
			publishEvent(StaleCheckRequestedEvent, {
				url: `https://example.com/${oversize}`,
			}),
		).rejects.toBeInstanceOf(PayloadTooLargeError);

		expect(client.send).not.toHaveBeenCalled();
	});

	it("attaches source, detailType, and byteLength to PayloadTooLargeError so the CloudWatch log identifies the offending command", async () => {
		const { client } = createFakeClient();
		const { publishEvent } = initEventBridgePublisher({
			client,
			eventBusName: "test-bus",
		});
		const oversize = "x".repeat(241_000);

		try {
			await publishEvent(StaleCheckRequestedEvent, {
				url: `https://example.com/${oversize}`,
			});
			fail("expected publishEvent to throw");
		} catch (error) {
			assert(error instanceof PayloadTooLargeError);
			expect(error.source).toBe(StaleCheckRequestedEvent.source);
			expect(error.detailType).toBe(StaleCheckRequestedEvent.detailType);
			expect(error.byteLength).toBeGreaterThan(240_000);
			expect(error.name).toBe("PayloadTooLargeError");
		}
	});

	it("publishes a detail just under the cap so the threshold is not over-aggressive", async () => {
		const { client, commands } = createFakeClient();
		const { publishEvent } = initEventBridgePublisher({
			client,
			eventBusName: "test-bus",
		});

		// 200 KB URL — well under the 240 KB cap once AWS-side envelope fields are accounted for.
		await publishEvent(StaleCheckRequestedEvent, {
			url: `https://example.com/${"x".repeat(200_000)}`,
		});

		expect(commands).toHaveLength(1);
	});

	it("rejects when the detail fails schema validation so refinements (e.g. mutex flags) cannot reach subscribers as malformed payloads", async () => {
		const { client } = createFakeClient();
		const { publishEvent } = initEventBridgePublisher({
			client,
			eventBusName: "test-bus",
		});

		await expect(
			publishEvent(SimpleCrawlUnsupportedEvent, {
				url: "https://example.com/doc.pdf",
				recrawl: true,
				refresh: true,
			}),
		).rejects.toBeInstanceOf(z.ZodError);

		expect(client.send).not.toHaveBeenCalled();
	});
});
