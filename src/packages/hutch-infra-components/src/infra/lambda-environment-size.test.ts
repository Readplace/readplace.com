import assert from "node:assert/strict";
import { assertLambdaEnvironmentFits, LAMBDA_ENVIRONMENT_LIMIT_BYTES } from "./lambda-environment-size";

function variablesOfSize(bytes: number): Record<string, string> {
	const overhead = Buffer.byteLength(JSON.stringify({ KEY: "" }));
	return { KEY: "x".repeat(bytes - overhead) };
}

describe("assertLambdaEnvironmentFits", () => {
	it("accepts an environment exactly at the limit", () => {
		assertLambdaEnvironmentFits({ lambdaName: "fn", variables: variablesOfSize(LAMBDA_ENVIRONMENT_LIMIT_BYTES) });
	});

	it("rejects an environment one byte over the limit, naming the Lambda and its size", () => {
		assert.throws(
			() => assertLambdaEnvironmentFits({ lambdaName: "hutch-handler", variables: variablesOfSize(LAMBDA_ENVIRONMENT_LIMIT_BYTES + 1) }),
			/hutch-handler environment variables take 4097 bytes/,
		);
	});

	it("measures the JSON AWS measures, so each variable's quotes and separators count", () => {
		const variables = Object.fromEntries(Array.from({ length: 512 }, (_, index) => [`K${index}`, ""]));
		assert(Object.entries(variables).reduce((sum, [key, value]) => sum + key.length + value.length, 0) < LAMBDA_ENVIRONMENT_LIMIT_BYTES);
		assert.throws(() => assertLambdaEnvironmentFits({ lambdaName: "fn", variables }), /over AWS's 4096-byte limit/);
	});

	it("counts multi-byte characters in bytes", () => {
		assert.throws(
			() => assertLambdaEnvironmentFits({ lambdaName: "fn", variables: { KEY: "é".repeat(LAMBDA_ENVIRONMENT_LIMIT_BYTES / 2) } }),
			/over AWS's 4096-byte limit/,
		);
	});
});
