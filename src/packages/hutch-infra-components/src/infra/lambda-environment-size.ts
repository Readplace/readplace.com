import assert from "node:assert";

export const LAMBDA_ENVIRONMENT_LIMIT_BYTES = 4096;

export function assertLambdaEnvironmentFits(input: {
	lambdaName: string;
	variables: Record<string, string>;
}): void {
	const bytes = Buffer.byteLength(JSON.stringify(input.variables));
	assert(
		bytes <= LAMBDA_ENVIRONMENT_LIMIT_BYTES,
		`Lambda ${input.lambdaName} environment variables take ${bytes} bytes, over AWS's ${LAMBDA_ENVIRONMENT_LIMIT_BYTES}-byte limit`,
	);
}
