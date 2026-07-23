import * as pulumi from "@pulumi/pulumi";

/**
 * ARN of the curl-impersonate Lambda layer that the platform stack publishes
 * (see projects/platform). Every stack whose bundle reaches `initCrawlFetch`
 * needs the `curl_chrome131` binary the layer carries, so the layer lives in
 * `platform` — one owner for a capability three stacks share.
 *
 * This is a genuine deploy-time StackReference, not a config-derived string:
 * the ARN's version suffix is only known after `platform` publishes, so it
 * cannot be written into `Pulumi.<env>.yaml`. `deploy-platform` runs before the
 * project matrix, so the output is always persisted before a consumer reads it.
 *
 * A resource name distinct from the platform reference `HutchEventBus`
 * already creates keeps the two StackReferences to the same stack from
 * colliding on one URN within a single program.
 */
export function curlImpersonateLayerArnFromPlatformStack(
	config: pulumi.Config,
): pulumi.Output<string> {
	const platformStackName = config.require("platformStack");
	const stack = new pulumi.StackReference(`${platformStackName}-curl-impersonate-layer`, {
		name: platformStackName,
	});
	return stack.requireOutput("curlImpersonateLayerArn").apply(String);
}
