import assert from "node:assert/strict";
import { assertLambdaEnvironmentFits } from "./lambda-environment-size";

const QUOTA_KILOBYTES = 4;
const LIMIT_BYTES = 4096;

function variablesOfSize(bytes: number): Record<string, string> {
	const overhead = Buffer.byteLength(JSON.stringify({ KEY: "" }));
	return { KEY: "x".repeat(bytes - overhead) };
}

describe("assertLambdaEnvironmentFits", () => {
	it("accepts an environment exactly at the quota", () => {
		assertLambdaEnvironmentFits({
			lambdaName: "fn",
			variables: variablesOfSize(LIMIT_BYTES),
			quotaKilobytes: QUOTA_KILOBYTES,
		});
	});

	it("rejects an environment one byte over the quota, naming the Lambda and its size", () => {
		assert.throws(
			() =>
				assertLambdaEnvironmentFits({
					lambdaName: "hutch-handler",
					variables: variablesOfSize(LIMIT_BYTES + 1),
					quotaKilobytes: QUOTA_KILOBYTES,
				}),
			/hutch-handler environment variables take 4097 bytes, over AWS's 4096-byte limit/,
		);
	});

	it("follows the quota AWS reports", () => {
		assertLambdaEnvironmentFits({
			lambdaName: "fn",
			variables: variablesOfSize(LIMIT_BYTES + 1),
			quotaKilobytes: 8,
		});
	});

	it("measures the JSON AWS measures, so each variable's quotes and separators count", () => {
		const variables = Object.fromEntries(Array.from({ length: 512 }, (_, index) => [`K${index}`, ""]));
		assert(Object.keys(variables).join("").length < LIMIT_BYTES);
		assert.throws(
			() => assertLambdaEnvironmentFits({ lambdaName: "fn", variables, quotaKilobytes: QUOTA_KILOBYTES }),
			/over AWS's 4096-byte limit/,
		);
	});

	it("counts multi-byte characters in bytes", () => {
		assert.throws(
			() =>
				assertLambdaEnvironmentFits({
					lambdaName: "fn",
					variables: { KEY: "é".repeat(LIMIT_BYTES / 2) },
					quotaKilobytes: QUOTA_KILOBYTES,
				}),
			/over AWS's 4096-byte limit/,
		);
	});
});
