/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { z } from "zod";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { CommandDefinition } from "../events";
import { buildCommandMessage, type CommandQueueDelivery } from "./command-message";

export type DispatchCommand<C extends CommandDefinition<z.ZodTypeAny>> = (
	detail: z.infer<C["detailSchema"]>,
) => Promise<void>;

export function initSqsCommandDispatcher<S extends z.ZodTypeAny>(deps: {
	sqsClient: Pick<SQSClient, "send">;
	queueUrl: string;
	command: CommandDefinition<S>;
} & CommandQueueDelivery<z.output<S>>): { dispatch: DispatchCommand<CommandDefinition<S>> } {
	const { sqsClient, queueUrl, command } = deps;

	const dispatch: DispatchCommand<CommandDefinition<S>> = async (detail) => {
		const validated = command.detailSchema.parse(detail);
		await sqsClient.send(new SendMessageCommand(buildCommandMessage({ queueUrl, detail: validated, delivery: deps })));
	};

	return { dispatch };
}
/* c8 ignore stop */
