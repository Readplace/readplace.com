import { createHash } from "node:crypto";
import { ConflictException, CreateScheduleCommand, GetScheduleCommand, type SchedulerClient } from "@aws-sdk/client-scheduler";
import { ReleaseHeldUploadCommand } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";

export function initScheduleHeldUpload(deps: {
	client: Pick<SchedulerClient, "send">; group: string; roleArn: string; eventBusArn: string; now: () => Date; publishEvent: PublishEvent;
}) {
	return async (jobId: string, marker: string, expiresAt: number) => {
		if (expiresAt * 1000 <= deps.now().getTime()) {
			await deps.publishEvent(ReleaseHeldUploadCommand, { marker });
			return;
		}
		const name = `held-upload-${createHash("sha256").update(jobId + marker).digest("hex").slice(0, 48)}`;
		const expression = `at(${new Date(expiresAt * 1000).toISOString().slice(0, 19)})`;
		const input = JSON.stringify({ marker });
		try {
			await deps.client.send(new CreateScheduleCommand({
				Name: name, GroupName: deps.group, ClientToken: name, FlexibleTimeWindow: { Mode: "OFF" }, ActionAfterCompletion: "DELETE",
				ScheduleExpression: expression,
				Target: { Arn: deps.eventBusArn, RoleArn: deps.roleArn, Input: input,
					EventBridgeParameters: { Source: ReleaseHeldUploadCommand.source, DetailType: ReleaseHeldUploadCommand.detailType } },
			}));
		} catch (error) {
			if (!(error instanceof ConflictException)) throw error;
			const prior = await deps.client.send(new GetScheduleCommand({ Name: name, GroupName: deps.group }));
			if (prior.ScheduleExpression !== expression || prior.Target?.Input !== input || prior.Target.Arn !== deps.eventBusArn ||
				prior.Target.EventBridgeParameters?.DetailType !== ReleaseHeldUploadCommand.detailType || prior.State !== "ENABLED") throw error;
		}
	};
}
