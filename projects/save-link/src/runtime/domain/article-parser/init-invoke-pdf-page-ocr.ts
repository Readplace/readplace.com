/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import type { InvokePdfPageOcr, InvokePdfPageOcrOutput } from "./pdf-page-ocr-invoker.types";

const OutputSchema = z.object({
	html: z.string(),
});

/**
 * Sync-invokes the per-page OCR Lambda. Returns the HTML fragment.
 * The page Lambda's own retries (DeepInfra 429/5xx) live inside the OpenAI
 * client; the orchestrator does not retry individual pages — if one fails
 * here, the whole crawl fails and SQS redrives.
 */
export function initInvokePdfPageOcr(deps: {
	client: LambdaClient;
	functionName: string;
	logger: HutchLogger;
}): { invokePageOcr: InvokePdfPageOcr } {
	const { client, functionName, logger } = deps;

	const invokePageOcr: InvokePdfPageOcr = async (input): Promise<InvokePdfPageOcrOutput> => {
		const payload = Buffer.from(JSON.stringify(input));
		const response = await client.send(
			new InvokeCommand({
				FunctionName: functionName,
				InvocationType: "RequestResponse",
				Payload: payload,
			}),
		);
		if (response.FunctionError) {
			const errorBody = response.Payload ? Buffer.from(response.Payload).toString("utf-8") : "<no payload>";
			throw new Error(`pdf-page-ocr Lambda ${response.FunctionError}: ${errorBody}`);
		}
		if (!response.Payload) {
			throw new Error("pdf-page-ocr Lambda returned no payload");
		}
		const responseText = Buffer.from(response.Payload).toString("utf-8");
		logger.info(`[invoke-page-ocr] pages=[${input.pageIndices.join(",")}] bytes=${responseText.length}`);
		return OutputSchema.parse(JSON.parse(responseText));
	};

	return { invokePageOcr };
}
/* c8 ignore stop */
