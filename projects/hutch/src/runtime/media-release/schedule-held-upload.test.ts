import assert from "node:assert/strict";
import { ConflictException, type SchedulerClient } from "@aws-sdk/client-scheduler";
import { ReleaseHeldUploadCommand } from "@packages/infra-components";
import { initScheduleHeldUpload } from "./schedule-held-upload";

const marker = `readplace:removed-article/${"d".repeat(64)}`;
const expiry = Date.UTC(2027, 0, 1) / 1000;
const request = new ConflictException({ Message: "schedule exists", message: "schedule exists", $metadata: {} });

describe("scheduling the release of a held upload", () => {
	it("accepts a duplicate only when the existing schedule will deliver the same command", async () => {
		const existing = { ScheduleExpression: "at(2027-01-01T00:00:00)", State: "ENABLED",
			Target: { Arn: "bus", Input: JSON.stringify({ marker }), EventBridgeParameters: { DetailType: ReleaseHeldUploadCommand.detailType } } };
		const send = jest.fn().mockRejectedValueOnce(request).mockResolvedValueOnce(existing)
			.mockRejectedValueOnce(request).mockResolvedValueOnce({ ...existing, State: "DISABLED" }).mockRejectedValueOnce(new Error("network failed"));
		const schedule = initScheduleHeldUpload({ client: { send } as Pick<SchedulerClient, "send">, group: "group", roleArn: "role", eventBusArn: "bus", now: () => new Date(0), publishEvent: jest.fn() });
		await schedule("job", marker, expiry);
		assert.match(send.mock.calls[0][0].input.Name, /^held-upload-[a-f0-9]{48}$/);
		assert.equal(send.mock.calls[0][0].input.Name, send.mock.calls[1][0].input.Name);
		await assert.rejects(schedule("job", marker, expiry), request);
		await assert.rejects(schedule("job", marker, expiry), /network failed/);
	});
	it("dispatches immediately when a recovery notice is retried after its deadline", async () => {
		const publishEvent = jest.fn();
		const schedule = initScheduleHeldUpload({ client: { send: jest.fn() }, group: "group", roleArn: "role", eventBusArn: "bus", now: () => new Date(expiry * 1000), publishEvent });
		await schedule("job", marker, expiry);
		expect(publishEvent).toHaveBeenCalledWith(ReleaseHeldUploadCommand, { marker });
	});
});
