/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { normalizeUnknownError } from "./normalize-error";
import type { InvokePdfPageOcr, InvokePdfPageOcrResult } from "./pdf-page-ocr-invoker.types";

const OutputSchema = z.object({
	html: z.string(),
});

/**
 * Sync-invokes the per-page OCR Lambda. Returns a tagged union so the
 * orchestrator (`ocr-pdf.ts`) can drive retries through `@packages/retriable`
 * without losing the underlying error to the worker's catch block. The page
 * Lambda runs Tesseract locally (see init-tesseract-ocr.ts) so retries at
 * this layer cover Lambda-runtime errors (cold-start failures, OOM, etc.),
 * not OCR-engine errors.
 */
export function initInvokePdfPageOcr(deps: {
	client: LambdaClient;
	functionName: string;
	logger: HutchLogger;
}): { invokePageOcr: InvokePdfPageOcr } {
	const { client, functionName, logger } = deps;

	const invokePageOcr: InvokePdfPageOcr = async (input): Promise<InvokePdfPageOcrResult> => {
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
				return { ok: false, error: new Error(`pdf-page-ocr Lambda ${response.FunctionError}: ${errorBody}`) };
			}
			if (!response.Payload) {
				return { ok: false, error: new Error("pdf-page-ocr Lambda returned no payload") };
			}
			const responseText = Buffer.from(response.Payload).toString("utf-8");
			logger.info(`[invoke-page-ocr] pages=[${input.pageIndices.join(",")}] bytes=${responseText.length}`);
			return { ok: true, html: OutputSchema.parse(JSON.parse(responseText)).html };
		} catch (error) {
			return { ok: false, error: normalizeUnknownError(error) };
		}
	};

	return { invokePageOcr };
}
/* c8 ignore stop */
