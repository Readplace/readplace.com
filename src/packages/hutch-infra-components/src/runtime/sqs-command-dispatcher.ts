/* c8 ignore start -- thin SDK wrapper, only used in prod path */
import type { z } from "zod";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { HutchCommand } from "../events";

export type DispatchCommand<C extends HutchCommand<z.ZodTypeAny>> = (
	detail: z.infer<C["detailSchema"]>,
) => Promise<void>;

export function initSqsCommandDispatcher<C extends HutchCommand<z.ZodTypeAny>>(deps: {
	sqsClient: Pick<SQSClient, "send">;
	queueUrl: string;
	command: C;
	/** Optional per-message delivery delay (0–900s, the SQS maximum). Passed
	 * straight through to `SendMessageCommand.DelaySeconds`; `undefined`
	 * serialises identically to omitting it, so existing callers are
	 * unaffected. Used by the reader-ready fan-out (300s) so a present user's
	 * final in-reader poll lands before the notify gate runs. */
	delaySeconds?: number;
}): { dispatch: DispatchCommand<C> } {
	const { sqsClient, queueUrl, command, delaySeconds } = deps;

	const dispatch: DispatchCommand<C> = async (detail) => {
		const validated = command.detailSchema.parse(detail);
		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify({ detail: validated }),
				DelaySeconds: delaySeconds,
			}),
		);
	};

	return { dispatch };
}
/* c8 ignore stop */
