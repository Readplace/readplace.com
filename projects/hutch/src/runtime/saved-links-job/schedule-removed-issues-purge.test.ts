import assert from "node:assert/strict";
import { ConflictException, type SchedulerClient } from "@aws-sdk/client-scheduler";
import { UserIdSchema } from "@packages/domain/user";
import { PurgeRemovedNewsletterIssuesCommand } from "@packages/infra-components";
import { initScheduleRemovedIssuesPurge } from "./schedule-removed-issues-purge";

const userId = UserIdSchema.parse("reader-1");
const runStartedAt = new Date("2026-12-01T10:00:00.000Z");
const conflict = new ConflictException({ Message: "schedule exists", message: "schedule exists", $metadata: {} });

describe("scheduling the purge of removed newsletter issues", () => {
	it("fires the purge command 30 days and 1 hour after the run started", async () => {
		const send = jest.fn().mockResolvedValue({});
		const schedule = initScheduleRemovedIssuesPurge({ client: { send } as Pick<SchedulerClient, "send">, group: "group", roleArn: "role", eventBusArn: "bus" });

		await schedule({ userId, jobId: "job", runStartedAt });

		const input = send.mock.calls[0][0].input;
		assert.match(input.Name, /^removed-issues-[a-f0-9]{48}$/);
		assert.equal(input.GroupName, "group");
		assert.equal(input.ScheduleExpression, "at(2026-12-31T11:00:00)");
		assert.equal(input.ActionAfterCompletion, "DELETE");
		assert.deepEqual(input.Target, {
			Arn: "bus",
			RoleArn: "role",
			Input: JSON.stringify({ userId }),
			EventBridgeParameters: { Source: PurgeRemovedNewsletterIssuesCommand.source, DetailType: PurgeRemovedNewsletterIssuesCommand.detailType },
		});
	});

	it("accepts a duplicate only when the existing schedule will deliver the same command", async () => {
		const existing = { ScheduleExpression: "at(2026-12-31T11:00:00)", State: "ENABLED",
			Target: { Arn: "bus", Input: JSON.stringify({ userId }), EventBridgeParameters: { DetailType: PurgeRemovedNewsletterIssuesCommand.detailType } } };
		const send = jest.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce(existing)
			.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ ...existing, State: "DISABLED" }).mockRejectedValueOnce(new Error("network failed"));
		const schedule = initScheduleRemovedIssuesPurge({ client: { send } as Pick<SchedulerClient, "send">, group: "group", roleArn: "role", eventBusArn: "bus" });

		await schedule({ userId, jobId: "job", runStartedAt });
		assert.equal(send.mock.calls[0][0].input.Name, send.mock.calls[1][0].input.Name);
		await assert.rejects(schedule({ userId, jobId: "job", runStartedAt }), conflict);
		await assert.rejects(schedule({ userId, jobId: "job", runStartedAt }), /network failed/);
	});
});
