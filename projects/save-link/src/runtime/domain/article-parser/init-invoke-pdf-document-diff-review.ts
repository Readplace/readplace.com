/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { normalizeUnknownError } from "./normalize-error";
import type {
	InvokePdfDocumentDiffReview,
	InvokePdfDocumentDiffReviewResult,
} from "./pdf-document-diff-review-invoker.types";

const OutputSchema = z.object({
	pages: z.array(z.object({
		pageIndex: z.number().int().min(0),
		finalText: z.string(),
	})),
	applied: z.boolean(),
	tokens: z.object({ input: z.number(), output: z.number() }).optional(),
});

/**
 * Sync-invokes the document diff-review Lambda. Returns a tagged union so the
 * orchestrator can fall back to per-page Stage 1 `cleanedText` on any error
 * (transport failure, Lambda function error, schema mismatch). The Lambda's
 * own guardrails already produce an `applied: false` fallback when its
 * internal LLM call or document-level checks fail; this wrapper only needs
 * to handle the case where the Lambda itself didn't run cleanly.
 */
export function initInvokePdfDocumentDiffReview(deps: {
	client: LambdaClient;
	functionName: string;
	logger: HutchLogger;
}): { invokeDocumentDiffReview: InvokePdfDocumentDiffReview } {
	const { client, functionName, logger } = deps;

	const invokeDocumentDiffReview: InvokePdfDocumentDiffReview = async (input): Promise<InvokePdfDocumentDiffReviewResult> => {
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
				return { ok: false, error: new Error(`pdf-document-diff-review Lambda ${response.FunctionError}: ${errorBody}`) };
			}
			if (!response.Payload) {
				return { ok: false, error: new Error("pdf-document-diff-review Lambda returned no payload") };
			}
			const responseText = Buffer.from(response.Payload).toString("utf-8");
			const parsed = OutputSchema.parse(JSON.parse(responseText));
			logger.info(`[invoke-document-diff-review] pages=${parsed.pages.length} applied=${parsed.applied}`);
			return {
				ok: true,
				pages: parsed.pages,
				applied: parsed.applied,
				tokens: parsed.tokens,
			};
		} catch (error) {
			return { ok: false, error: normalizeUnknownError(error) };
		}
	};

	return { invokeDocumentDiffReview };
}
/* c8 ignore stop */
