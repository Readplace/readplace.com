import { createHash } from "node:crypto";
import { ConflictException, CreateScheduleCommand, GetScheduleCommand, type SchedulerClient } from "@aws-sdk/client-scheduler";
import { HELD_LINK_DAYS } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { PurgeRemovedNewsletterIssuesCommand } from "@packages/infra-components";

const HOUR_MS = 60 * 60 * 1000;

export const REMOVED_ISSUES_PURGE_DELAY_MS = (HELD_LINK_DAYS * 24 + 1) * HOUR_MS;

export type ScheduleRemovedIssuesPurge = (params: { userId: UserId; jobId: string; runStartedAt: Date }) => Promise<void>;

export function initScheduleRemovedIssuesPurge(deps: {
	client: Pick<SchedulerClient, "send">;
	group: string;
	roleArn: string;
	eventBusArn: string;
}): ScheduleRemovedIssuesPurge {
	return async ({ userId, jobId, runStartedAt }) => {
		const fireAt = new Date(runStartedAt.getTime() + REMOVED_ISSUES_PURGE_DELAY_MS);
		const expression = `at(${fireAt.toISOString().slice(0, 19)})`;
		const name = `removed-issues-${createHash("sha256").update(`${userId}|${jobId}|${expression}`).digest("hex").slice(0, 48)}`;
		const input = JSON.stringify({ userId });
		try {
			await deps.client.send(new CreateScheduleCommand({
				Name: name, GroupName: deps.group, ClientToken: name, FlexibleTimeWindow: { Mode: "OFF" }, ActionAfterCompletion: "DELETE",
				ScheduleExpression: expression,
				Target: { Arn: deps.eventBusArn, RoleArn: deps.roleArn, Input: input,
					EventBridgeParameters: { Source: PurgeRemovedNewsletterIssuesCommand.source, DetailType: PurgeRemovedNewsletterIssuesCommand.detailType } },
			}));
		} catch (error) {
			if (!(error instanceof ConflictException)) throw error;
			const prior = await deps.client.send(new GetScheduleCommand({ Name: name, GroupName: deps.group }));
			if (prior.ScheduleExpression !== expression || prior.Target?.Input !== input || prior.Target.Arn !== deps.eventBusArn ||
				prior.Target.EventBridgeParameters?.DetailType !== PurgeRemovedNewsletterIssuesCommand.detailType || prior.State !== "ENABLED") throw error;
		}
	};
}
