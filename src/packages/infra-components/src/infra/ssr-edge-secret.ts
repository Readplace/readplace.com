import * as pulumi from "@pulumi/pulumi";

export function ssrEdgeSecretFromPlatformStack(config: pulumi.Config): pulumi.Output<string> {
	const platformStackName = config.require("platformStack");
	const stack = new pulumi.StackReference(`${platformStackName}-ssr-edge-secret`, {
		name: platformStackName,
	});
	return stack.requireOutput("ssrEdgeSecret").apply(String);
}
