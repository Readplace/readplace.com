import assert from "node:assert/strict";
import {
	CreateScheduleCommand,
	DeleteScheduleCommand,
	type SchedulerClient,
} from "@aws-sdk/client-scheduler";
import { UserIdSchema } from "@packages/domain/user";
import { initAwsTrialScheduler } from "./aws-trial-scheduler";

const USER_ID = UserIdSchema.parse("a".repeat(32));
const EVENT_BUS_ARN = "arn:aws:events:us-east-1:123456789:event-bus/hutch-bus";
const ROLE_ARN = "arn:aws:iam::123456789:role/hutch-scheduler";
const GROUP_NAME = "hutch-trial-end-test";

interface CapturedSend {
	commands: unknown[];
}

function buildFakeClient(opts?: {
	deleteThrows?: Error;
}): { client: Pick<SchedulerClient, "send">; captured: CapturedSend } {
	const captured: CapturedSend = { commands: [] };
	const client = {
		send: (async (cmd: unknown) => {
			captured.commands.push(cmd);
			if (opts?.deleteThrows && cmd instanceof DeleteScheduleCommand) {
				throw opts.deleteThrows;
			}
			return {};
		}) as unknown as SchedulerClient["send"],
	};
	return { client, captured };
}

describe("initAwsTrialScheduler", () => {
	describe("createTrialEndSchedule", () => {
		it("issues a CreateScheduleCommand with the deterministic name, group, at(...) expression and target", async () => {
			const { client, captured } = buildFakeClient();
			const scheduler = initAwsTrialScheduler({
				client,
				scheduleGroupName: GROUP_NAME,
				schedulerRoleArn: ROLE_ARN,
				eventBusArn: EVENT_BUS_ARN,
			});

			await scheduler.createTrialEndSchedule({
				userId: USER_ID,
				firesAt: "2026-06-06T10:30:00.000Z",
			});

			assert.equal(captured.commands.length, 1);
			const cmd = captured.commands[0];
			assert.ok(cmd instanceof CreateScheduleCommand);
			const input = cmd.input;
			assert.equal(input.Name, `trial-end-${USER_ID}`);
			assert.equal(input.GroupName, GROUP_NAME);
			assert.equal(input.ScheduleExpression, "at(2026-06-06T10:30:00)");
			assert.equal(input.FlexibleTimeWindow?.Mode, "OFF");
			assert.equal(input.ActionAfterCompletion, "DELETE");
			assert.equal(input.State, "ENABLED");
			assert.equal(input.Target?.Arn, EVENT_BUS_ARN);
			assert.equal(input.Target?.RoleArn, ROLE_ARN);
			assert.equal(input.Target?.EventBridgeParameters?.Source, "hutch.subscriptions");
			assert.equal(
				input.Target?.EventBridgeParameters?.DetailType,
				"SubscriptionStartRequestCommand",
			);
			const payload = JSON.parse(input.Target?.Input ?? "{}");
			assert.equal(payload.userId, USER_ID);
		});

		it("strips fractional seconds and the trailing Z from firesAt", async () => {
			const { client, captured } = buildFakeClient();
			const scheduler = initAwsTrialScheduler({
				client,
				scheduleGroupName: GROUP_NAME,
				schedulerRoleArn: ROLE_ARN,
				eventBusArn: EVENT_BUS_ARN,
			});

			await scheduler.createTrialEndSchedule({
				userId: USER_ID,
				firesAt: "2026-06-06T10:30:00Z",
			});

			const cmd = captured.commands[0];
			assert.ok(cmd instanceof CreateScheduleCommand);
			assert.equal(cmd.input.ScheduleExpression, "at(2026-06-06T10:30:00)");
		});
	});

	describe("deleteTrialEndSchedule", () => {
		it("issues a DeleteScheduleCommand with the deterministic name + group", async () => {
			const { client, captured } = buildFakeClient();
			const scheduler = initAwsTrialScheduler({
				client,
				scheduleGroupName: GROUP_NAME,
				schedulerRoleArn: ROLE_ARN,
				eventBusArn: EVENT_BUS_ARN,
			});

			await scheduler.deleteTrialEndSchedule({ userId: USER_ID });

			assert.equal(captured.commands.length, 1);
			const cmd = captured.commands[0];
			assert.ok(cmd instanceof DeleteScheduleCommand);
			assert.equal(cmd.input.Name, `trial-end-${USER_ID}`);
			assert.equal(cmd.input.GroupName, GROUP_NAME);
		});

		it("swallows ResourceNotFoundException — delete is idempotent", async () => {
			const notFound = new Error("Schedule not found");
			notFound.name = "ResourceNotFoundException";
			const { client } = buildFakeClient({ deleteThrows: notFound });
			const scheduler = initAwsTrialScheduler({
				client,
				scheduleGroupName: GROUP_NAME,
				schedulerRoleArn: ROLE_ARN,
				eventBusArn: EVENT_BUS_ARN,
			});

			await assert.doesNotReject(scheduler.deleteTrialEndSchedule({ userId: USER_ID }));
		});

		it("re-throws any other error", async () => {
			const wrenchInGears = new Error("Internal failure");
			wrenchInGears.name = "InternalServerException";
			const { client } = buildFakeClient({ deleteThrows: wrenchInGears });
			const scheduler = initAwsTrialScheduler({
				client,
				scheduleGroupName: GROUP_NAME,
				schedulerRoleArn: ROLE_ARN,
				eventBusArn: EVENT_BUS_ARN,
			});

			await assert.rejects(scheduler.deleteTrialEndSchedule({ userId: USER_ID }), /Internal failure/);
		});
	});
});
