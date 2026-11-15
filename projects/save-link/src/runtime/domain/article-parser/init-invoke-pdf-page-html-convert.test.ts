import assert from "node:assert/strict";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import { noopLogger } from "@packages/logger";
import { initInvokePdfPageHtmlConvert } from "./init-invoke-pdf-page-html-convert";

function lambdaAnswering(body: unknown): LambdaClient {
	const send = async () => ({ Payload: Buffer.from(JSON.stringify(body)) });
	return { send } as unknown as LambdaClient;
}

describe("initInvokePdfPageHtmlConvert", () => {
	it("passes providerFailed through from the stage's answer", async () => {
		const { invokePageHtmlConvert } = initInvokePdfPageHtmlConvert({
			client: lambdaAnswering({ pageIndex: 1, semanticHtml: "<p>x</p>", applied: false, providerFailed: true }),
			functionName: "convert",
			logger: noopLogger,
		});

		const result = await invokePageHtmlConvert({ pageIndex: 1, pageText: "x" });

		assert.deepEqual(result, { ok: true, semanticHtml: "<p>x</p>", applied: false, providerFailed: true, tokens: undefined });
	});

	it("refuses an answer without providerFailed as malformed", async () => {
		const { invokePageHtmlConvert } = initInvokePdfPageHtmlConvert({
			client: lambdaAnswering({ pageIndex: 1, semanticHtml: "<p>x</p>", applied: true }),
			functionName: "convert",
			logger: noopLogger,
		});

		const result = await invokePageHtmlConvert({ pageIndex: 1, pageText: "x" });

		assert.equal(result.ok, false);
	});
});
