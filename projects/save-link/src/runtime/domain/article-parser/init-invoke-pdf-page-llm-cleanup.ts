/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { normalizeUnknownError } from "./normalize-error";
import type {
	InvokePdfPageLlmCleanup,
	InvokePdfPageLlmCleanupResult,
} from "./pdf-page-llm-cleanup-invoker.types";

const OutputSchema = z.object({
	pageIndex: z.number().int().min(0),
	cleanedText: z.string(),
	applied: z.boolean(),
	tokens: z.object({ input: z.number(), output: z.number() }).optional(),
});

/**
 * Sync-invokes the per-page LLM cleanup Lambda. Returns a tagged union so the
 * orchestrator can decide per-page whether to fall back to the original
 * Tesseract output (the case for `{ ok: false }` AND for `{ ok: true, applied: false }`).
 * Mirrors the shape of `initInvokePdfPageOcr` so the orchestrator can route
 * both fan-outs through the same `mapWithConcurrency`/retriable helpers.
 */
export function initInvokePdfPageLlmCleanup(deps: {
	client: LambdaClient;
	functionName: string;
	logger: HutchLogger;
}): { invokePageLlmCleanup: InvokePdfPageLlmCleanup } {
	const { client, functionName, logger } = deps;

	const invokePageLlmCleanup: InvokePdfPageLlmCleanup = async (input): Promise<InvokePdfPageLlmCleanupResult> => {
		try {
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
				return { ok: false, error: new Error(`pdf-page-llm-cleanup Lambda ${response.FunctionError}: ${errorBody}`) };
			}
			if (!response.Payload) {
				return { ok: false, error: new Error("pdf-page-llm-cleanup Lambda returned no payload") };
			}
			const responseText = Buffer.from(response.Payload).toString("utf-8");
			const parsed = OutputSchema.parse(JSON.parse(responseText));
			logger.info(`[invoke-page-llm-cleanup] page=${parsed.pageIndex} applied=${parsed.applied} chars=${parsed.cleanedText.length}`);
			return {
				ok: true,
				cleanedText: parsed.cleanedText,
				applied: parsed.applied,
				tokens: parsed.tokens,
			};
		} catch (error) {
			return { ok: false, error: normalizeUnknownError(error) };
		}
	};

	return { invokePageLlmCleanup };
}
/* c8 ignore stop */
