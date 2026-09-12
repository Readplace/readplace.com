import type { SQSHandler } from "aws-lambda";
import { EvaluateOAuthRefreshCommand } from "@packages/hutch-infra-components";

export function initRefreshEvaluationHandler(deps: { evaluate: (at: number) => Promise<unknown> }): SQSHandler {
	return async event => {
		for (const record of event.Records) {
			const command = EvaluateOAuthRefreshCommand.detailSchema.parse(JSON.parse(record.body));
			await deps.evaluate(Date.parse(command.scheduledAt));
		}
	};
}
