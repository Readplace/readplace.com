import assert from "node:assert";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";
import { analyticsSaltRotation, isLambdaFunctionNotFound } from "@packages/hutch-infra-components/infra";

const DeployedSaltSchema = z.object({
	ANALYTICS_SALT: z.string().min(1),
	ANALYTICS_SALT_GENERATION: z.coerce.number().int().optional(),
});

async function readDeployedSalt(functionName: string): Promise<{ salt: string; generation: number | undefined } | undefined> {
	try {
		const deployedFunction = await aws.lambda.getFunction({ functionName });
		const variables = DeployedSaltSchema.parse(deployedFunction.environment.variables);
		return { salt: variables.ANALYTICS_SALT, generation: variables.ANALYTICS_SALT_GENERATION };
	} catch (error) {
		if (isLambdaFunctionNotFound(error)) return undefined;
		throw error;
	}
}

export function checkedAnalyticsSalt(input: {
	functionName: string;
	stack: string;
	next: { salt: string; generation: number };
}): pulumi.Output<string> {
	const { functionName, stack, next } = input;
	return pulumi.output(readDeployedSalt(functionName)).apply((deployed) => {
		const rotation = analyticsSaltRotation({ deployed, next });
		const rotateAdvice =
			deployed?.generation === undefined
				? `To rotate on purpose, first deploy once with the deployed salt so ANALYTICS_SALT_GENERATION lands on ${functionName}, then bump hutch:analyticsSaltGeneration in Pulumi.${stack}.yaml together with the new salt in a later change.`
				: `To rotate on purpose, bump hutch:analyticsSaltGeneration in Pulumi.${stack}.yaml in the same change.`;
		assert(
			rotation !== "refused",
			`Refusing to deploy hutch (stack ${stack}): ANALYTICS_SALT differs from the salt the deployed ${functionName} runs with, and hutch:analyticsSaltGeneration (${next.generation}) was not bumped past the deployed generation (${deployed?.generation ?? "none"}). Deploying it re-keys what the salt signs or hashes, including: every OAuth refresh-token fingerprint, so every connected app signs out, including the credential OpenAI's plugin-directory scan uses; the unsubscribe and mark-read links in digest emails already sent, which stop verifying; the banned-IP hashes, which stop matching; and every analytics visitor hash, so returning visitors read as new. For a local preview put the deployed salt in .env without printing it, using stack ${stack}'s AWS credentials (prod is AWS_PROFILE=hutch-production) (printf "export ANALYTICS_SALT='%s'\\n" "$(aws lambda get-function-configuration --function-name ${functionName} --region ap-southeast-2 --query Environment.Variables.ANALYTICS_SALT --output text)" >> .env; .envrc exports the placeholder local-dev-salt and then sources .env). ${rotateAdvice}`,
		);
		return next.salt;
	});
}
