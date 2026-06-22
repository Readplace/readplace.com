import assert from "node:assert/strict";
import { buildLambdaContext } from "./build-lambda-context";

describe("buildLambdaContext", () => {
	it("builds a Lambda Context stub with stable identifiers", () => {
		const context = buildLambdaContext();

		assert.equal(context.functionName, "test");
		assert.equal(context.awsRequestId, "test-request-id");
		assert.equal(context.getRemainingTimeInMillis(), 30000);
	});

	it("exposes no-op lifecycle callbacks", () => {
		const context = buildLambdaContext();

		assert.equal(context.done(), undefined);
		assert.equal(context.fail("boom"), undefined);
		assert.equal(context.succeed(undefined), undefined);
	});
});
