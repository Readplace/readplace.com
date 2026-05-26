/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { normalizeUnknownError } from "./normalize-error";
import type {
	InvokePdfPageHtmlConvert,
	InvokePdfPageHtmlConvertResult,
} from "./pdf-page-html-convert-invoker.types";

const OutputSchema = z.object({
	pageIndex: z.number().int().min(0),
	semanticHtml: z.string(),
	applied: z.boolean(),
	tokens: z.object({ input: z.number(), output: z.number() }).optional(),
});

export function initInvokePdfPageHtmlConvert(deps: {
	client: LambdaClient;
	functionName: string;
	logger: HutchLogger;
}): { invokePageHtmlConvert: InvokePdfPageHtmlConvert } {
	const { client, functionName, logger } = deps;

	const invokePageHtmlConvert: InvokePdfPageHtmlConvert = async (input): Promise<InvokePdfPageHtmlConvertResult> => {
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
				return { ok: false, error: new Error(`pdf-page-html-convert Lambda ${response.FunctionError}: ${errorBody}`) };
			}
			if (!response.Payload) {
				return { ok: false, error: new Error("pdf-page-html-convert Lambda returned no payload") };
			}
			const responseText = Buffer.from(response.Payload).toString("utf-8");
			const parsed = OutputSchema.parse(JSON.parse(responseText));
			logger.info(`[invoke-page-html-convert] page=${parsed.pageIndex} applied=${parsed.applied} chars=${parsed.semanticHtml.length}`);
			return {
				ok: true,
				semanticHtml: parsed.semanticHtml,
				applied: parsed.applied,
				tokens: parsed.tokens,
			};
		} catch (error) {
			return { ok: false, error: normalizeUnknownError(error) };
		}
	};

	return { invokePageHtmlConvert };
}
/* c8 ignore stop */
