import assert from "node:assert/strict";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import { noopLogger } from "@packages/logger";
import { initInvokePdfPageLlmCleanup } from "./init-invoke-pdf-page-llm-cleanup";

function lambdaAnswering(body: unknown): LambdaClient {
	const send = async () => ({ Payload: Buffer.from(JSON.stringify(body)) });
	return { send } as unknown as LambdaClient;
}

describe("initInvokePdfPageLlmCleanup", () => {
	it("passes providerFailed through from the stage's answer", async () => {
		const { invokePageLlmCleanup } = initInvokePdfPageLlmCleanup({
			client: lambdaAnswering({ pageIndex: 2, cleanedText: "text", applied: false, providerFailed: true }),
			functionName: "cleanup",
			logger: noopLogger,
		});

		const result = await invokePageLlmCleanup({ pageIndex: 2, ocrText: "text" });

		assert.deepEqual(result, { ok: true, cleanedText: "text", applied: false, providerFailed: true, tokens: undefined });
	});

	it("refuses an answer without providerFailed as malformed", async () => {
		const { invokePageLlmCleanup } = initInvokePdfPageLlmCleanup({
			client: lambdaAnswering({ pageIndex: 2, cleanedText: "text", applied: true }),
			functionName: "cleanup",
			logger: noopLogger,
		});

		const result = await invokePageLlmCleanup({ pageIndex: 2, ocrText: "text" });

		assert.equal(result.ok, false);
	});
});
