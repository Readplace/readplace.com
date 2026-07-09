/**
 * Name passed to `new HutchLambda(...)` for the blog-site Lambda, and the log
 * group its analytics telemetry lands in. Two separate Pulumi projects need the
 * name: blog-site's infra names its Lambda from `BLOG_SITE_LAMBDA_NAME`, and
 * hutch's analytics dashboard derives its `SOURCE` clause from
 * `BLOG_SITE_LOG_GROUP`, so this is the *single* place the name is written and a
 * rename here propagates to the Lambda *and* the dashboard together rather than
 * silently drifting (a shared workspace package — not a cross-project relative
 * import — is the only safe place to hold the name).
 *
 * `HutchLambda` appends `-handler` to this name when it creates the
 * `aws.lambda.Function`, so the log group AWS auto-creates on first invocation
 * is `/aws/lambda/<name>-handler`. Deliberately NOT part of hutch's
 * `LOG_GROUPS`/`LAMBDA_NAMES`, which drive hutch-owned explicit `LogGroup`
 * resources; the blog group is auto-created by its own Lambda.
 */
export const BLOG_SITE_LAMBDA_NAME = "blog-site";

type LogGroupName<T extends string> = `/aws/lambda/${T}-handler`;

export const BLOG_SITE_LOG_GROUP: LogGroupName<typeof BLOG_SITE_LAMBDA_NAME> = `/aws/lambda/${BLOG_SITE_LAMBDA_NAME}-handler`;
