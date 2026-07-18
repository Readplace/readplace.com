/**
 * Name passed to `new HutchLambda(...)` for the analytics-forwarder Lambda that
 * copies CloudWatch Logs subscription deliveries into the never-expire
 * `/readplace/analytics` group. Two separate Pulumi projects need the name:
 * hutch's infra creates the Lambda and the invoke permissions for every source
 * group, and blog-site's infra (a separate stack) derives the same function's
 * ARN to point its own subscription filter at it. This is the single place the
 * name is written, so a rename propagates to both stacks together rather than
 * silently drifting (a shared workspace package — not a cross-project relative
 * import — is the only safe place to hold the name).
 *
 * `HutchLambda` appends `-handler` to this name when it creates the
 * `aws.lambda.Function`, so the function AWS creates is `forward-analytics-handler`
 * and the group it auto-manages at the usual 30-day retention is
 * `/aws/lambda/forward-analytics-handler`. That group is deliberately NOT one of
 * the forwarded sources — subscribing the forwarder to its own output would loop.
 */
export const FORWARD_ANALYTICS_LAMBDA_NAME = "forward-analytics";

type HandlerFunctionName<T extends string> = `${T}-handler`;

/**
 * The `aws.lambda.Function` name HutchLambda creates for the forwarder. blog-site
 * builds the forwarder's ARN from this + account + region (rather than reading it
 * back via a StackReference) so a fresh-env bootstrap deploying hutch before
 * blog-site cannot deadlock.
 */
export const FORWARD_ANALYTICS_FUNCTION_NAME: HandlerFunctionName<typeof FORWARD_ANALYTICS_LAMBDA_NAME> = `${FORWARD_ANALYTICS_LAMBDA_NAME}-handler`;
