import assert from "node:assert";

export const LAMBDA_ENVIRONMENT_SIZE_QUOTA_CODE = "L-6581F036";

export function assertLambdaEnvironmentFits(input: {
	lambdaName: string;
	variables: Record<string, string>;
	quotaKilobytes: number;
}): void {
	const limitBytes = input.quotaKilobytes * 1024;
	const bytes = Buffer.byteLength(JSON.stringify(input.variables));
	assert(
		bytes <= limitBytes,
		`Lambda ${input.lambdaName} environment variables take ${bytes} bytes, over AWS's ${limitBytes}-byte limit`,
	);
}
