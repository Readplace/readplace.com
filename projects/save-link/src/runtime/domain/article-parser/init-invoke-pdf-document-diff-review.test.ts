import assert from "node:assert/strict";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import { noopLogger } from "@packages/logger";
import { initInvokePdfDocumentDiffReview } from "./init-invoke-pdf-document-diff-review";

function lambdaAnswering(body: unknown): LambdaClient {
	const send = async () => ({ Payload: Buffer.from(JSON.stringify(body)) });
	return { send } as unknown as LambdaClient;
}

const input = { pages: [{ pageIndex: 0, originalText: "a", cleanedText: "b" }] };

describe("initInvokePdfDocumentDiffReview", () => {
	it("passes providerFailed through from the stage's answer", async () => {
		const { invokeDocumentDiffReview } = initInvokePdfDocumentDiffReview({
			client: lambdaAnswering({ pages: [{ pageIndex: 0, finalText: "b" }], applied: false, providerFailed: true }),
			functionName: "review",
			logger: noopLogger,
		});

		const result = await invokeDocumentDiffReview(input);

		assert.deepEqual(result, { ok: true, pages: [{ pageIndex: 0, finalText: "b" }], applied: false, providerFailed: true, tokens: undefined });
	});

	it("refuses an answer without providerFailed as malformed", async () => {
		const { invokeDocumentDiffReview } = initInvokePdfDocumentDiffReview({
			client: lambdaAnswering({ pages: [{ pageIndex: 0, finalText: "b" }], applied: true }),
			functionName: "review",
			logger: noopLogger,
		});

		const result = await invokeDocumentDiffReview(input);

		assert.equal(result.ok, false);
	});
});
