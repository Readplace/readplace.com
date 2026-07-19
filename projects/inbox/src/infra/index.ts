import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
	HutchAPIGatewayLambdaRoute,
	HutchDynamoDBAccess,
	HutchEventBus,
	HutchLambda,
	HutchS3ReadWrite,
	HutchSQS,
	HutchSQSBackedLambda,
} from "@packages/hutch-infra-components/infra";
import {
	CrawlEmailLinkPreview,
	EmailReceivedEvent,
} from "@packages/hutch-infra-components";
import { requireEnv } from "@packages/require-env";

/**
 * inbox is deployed as its own Lambda behind hutch's existing API Gateway:
 * more-specific routes (GET /inbox, ANY /inbox/{proxy+}) take precedence over
 * hutch's $default, so readplace.com/inbox is served here while everything else
 * falls through to hutch. The coupling is deploy-time and one-way — this stack
 * reads hutch's API id/exec-arn via a StackReference and attaches its own
 * integration + routes + invoke permission. The inbound-email pipeline
 * (receive → extract links → crawl previews) is re-homed from hutch with
 * `inbox-`-prefixed names throughout: EventBridge PutRule is an upsert and
 * Lambda/SQS physical names are account-scoped, so a same-named resource here
 * would steal hutch's live rule/queue instead of standing up beside it.
 */
const config = new pulumi.Config();
const deepseekApiKey = pulumi.secret(requireEnv("DEEPSEEK_API_KEY"));
const nodeEnv = config.require("nodeEnv");
const staticBaseUrl = config.require("staticBaseUrl");
const alertEmail = config.require("alertEmail");
const inboxAddressDomain = config.require("inboxAddressDomain");
const rawEmailBucketName = config.require("rawEmailBucketName");
const contentBucketName = config.require("contentBucketName");
const hutchStackName = config.require("hutchStack");

// The content-media CDN over the shared article-content bucket is owned by
// save-link; the link-preview crawler uploads lead images there and needs the
// CDN base URL. That URL is the CDN's custom domain (a config constant), so
// derive it here the way save-link does instead of a cross-stack requireOutput,
// which would couple deploy order (see the infrastructure-design skill).
const imagesCdnBaseUrl = `https://${config.require("contentMediaCdnDomain")}`;

const hutchStack = new pulumi.StackReference(hutchStackName);
const apiGatewayId = hutchStack.requireOutput("apiGatewayId");
const apiGatewayExecutionArn = hutchStack.requireOutput("apiGatewayExecutionArn");
const hutchApiUrl = hutchStack.requireOutput("apiUrl");
// The SES receipt-rule SNS topic stays with hutch (SES receipt rules and the
// inbound-mail DNS live there). Its ARN is genuinely deploy-time — not a value
// config could carry — so this is a legitimate project→project StackReference
// edge (infrastructure-design: "Don't StackReference a Value You Could Put in
// Config", exception 3).
const inboxNotificationTopicArn = hutchStack
	.requireOutput("inboxNotificationTopicArn")
	.apply(String);

// Table and bucket names are config constants (identical across deploys), so
// this stack reads them from its own config rather than via a StackReference —
// a cross-stack read of a value you could put in config couples deploy order
// and breaks the first deploy after any new hutch output (infrastructure-design:
// "Don't StackReference a Value You Could Put in Config"). ARNs are derived
// from account + region rather than read back.
const awsRegion = new pulumi.Config("aws").require("region");
const awsAccountId = pulumi.output(aws.getCallerIdentity({})).accountId;
const tableNames = {
	inboxAddresses: config.require("dynamodbInboxAddressesTable"),
	inboxEmails: config.require("dynamodbInboxEmailsTable"),
	inboxEmailLinks: config.require("dynamodbInboxEmailLinksTable"),
	sessions: config.require("dynamodbSessionsTable"),
	users: config.require("dynamodbUsersTable"),
	subscriptionProviders: config.require("dynamodbSubscriptionProvidersTable"),
};

function tableArn(tableName: string): pulumi.Output<string> {
	return pulumi.interpolate`arn:aws:dynamodb:${awsRegion}:${awsAccountId}:table/${tableName}`;
}

const eventBus = HutchEventBus.fromPlatformStack(config);

// --- Web Lambda (GET /inbox + ANY /inbox/{proxy+}) ---

const webInboxTables = new HutchDynamoDBAccess("inbox-web-inbox-tables", {
	tables: [
		// The addresses userId-index backs the address reverse-lookup per page view.
		{ arn: tableArn(tableNames.inboxAddresses), includeIndexes: true },
		{ arn: tableArn(tableNames.inboxEmails), includeIndexes: false },
		{ arn: tableArn(tableNames.inboxEmailLinks), includeIndexes: false },
	],
	// Mirrors the actions hutch's web Lambda held on these tables before the
	// /inbox pages re-homed here.
	actions: [
		"dynamodb:GetItem",
		"dynamodb:BatchGetItem",
		"dynamodb:PutItem",
		"dynamodb:UpdateItem",
		"dynamodb:DeleteItem",
		"dynamodb:Query",
		"dynamodb:Scan",
	],
});

// GetItem authenticates every request; UpdateItem because verifying an inbox
// address flips the session's email-verified flag (markSessionEmailVerified).
const webSessions = new HutchDynamoDBAccess("inbox-web-sessions", {
	tables: [{ arn: tableArn(tableNames.sessions), includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

// users is read-only here: Query the userId-index to resolve the signed-in
// user's row (same shape as hutch's send-user-digest users grant).
const webUsersRead = new HutchDynamoDBAccess("inbox-web-users-read", {
	tables: [{ arn: tableArn(tableNames.users), includeIndexes: true }],
	actions: ["dynamodb:Query"],
});

const webSubscriptionProvidersRead = new HutchDynamoDBAccess(
	"inbox-web-subscription-providers-read",
	{
		tables: [{ arn: tableArn(tableNames.subscriptionProviders), includeIndexes: false }],
		actions: ["dynamodb:GetItem"],
	},
);

const webLambda = new HutchLambda("inbox-web", {
	entryPoint: "./src/runtime/lambda.main.ts",
	outputDir: ".lib/inbox-web",
	assetDir: "./src/runtime",
	memorySize: 256,
	timeout: 10,
	environment: {
		NODE_ENV: nodeEnv,
		// The inbox is served same-origin under hutch (readplace.com/inbox), so
		// hutch's origin is the origin the inbox is served on.
		APP_ORIGIN: hutchApiUrl,
		STATIC_BASE_URL: staticBaseUrl,
		INBOX_ADDRESS_DOMAIN: inboxAddressDomain,
		DYNAMODB_INBOX_ADDRESSES_TABLE: tableNames.inboxAddresses,
		DYNAMODB_INBOX_EMAILS_TABLE: tableNames.inboxEmails,
		DYNAMODB_INBOX_EMAIL_LINKS_TABLE: tableNames.inboxEmailLinks,
		DYNAMODB_SESSIONS_TABLE: tableNames.sessions,
		DYNAMODB_USERS_TABLE: tableNames.users,
		DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: tableNames.subscriptionProviders,
		CONTENT_BUCKET_NAME: contentBucketName,
		// Pinned into the email iframe's CSP so only rehosted image copies load.
		IMAGES_CDN_BASE_URL: imagesCdnBaseUrl,
		/** Same-origin fragment endpoint served by blog-site behind this same API
		 * Gateway (/blog/{proxy+} routes there). The banner source is cached and
		 * fail-open, so the extra gateway hop is fine for a decorative banner. */
		CHANGELOG_BANNER_URL: pulumi.interpolate`${hutchApiUrl}/blog/changelog-banner`,
	},
	policies: [
		...webInboxTables.policies,
		...webSessions.policies,
		...webUsersRead.policies,
		...webSubscriptionProvidersRead.policies,
		// Reads the sanitized email bodies the receive worker wrote to the shared
		// content bucket.
		...HutchS3ReadWrite.readPoliciesForBucket("inbox-web-content", contentBucketName),
	],
});

const inboxRoutes = new HutchAPIGatewayLambdaRoute("inbox-web", {
	apiGatewayId,
	apiGatewayExecutionArn,
	lambda: webLambda,
	routeKeys: ["GET /inbox", "ANY /inbox/{proxy+}"],
});

// --- Inbound email receive worker Lambda ---
// Drains the SES→SNS receipt notifications: fetches the raw .eml from the raw
// bucket, resolves each recipient, parses the body, rehosts its remote images to
// the content bucket (served via the content-media CDN), sanitizes the body into
// the content bucket, writes a row per recipient, and publishes
// EmailReceivedEvent. Expected
// catch-all-MX conditions (unknown or disabled recipient) record an audit row and
// ACK — never paging. Oversize / unparseable mail also records an audit row, but
// only pages (fails to the DLQ so the HutchSQSBackedLambda alarm fires) when a
// real, enabled recipient is affected; junk to guessed addresses just ACKs. The
// immutable raw .eml is kept forever as the audit trail (★15 degrade-with-alert).
const receiveEmailDynamodb = new HutchDynamoDBAccess("inbox-receive-email-dynamodb", {
	tables: [
		{ arn: tableArn(tableNames.inboxEmails), includeIndexes: false },
		{ arn: tableArn(tableNames.inboxAddresses), includeIndexes: false },
	],
	// findByAddress is a GetItem and putEmail a (conditional) PutItem — no Query.
	actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
});

const receiveEmailQueue = new HutchSQS("inbox-receive-email", {
	// Worker timeout plus a receive-to-invoke buffer (matching the extract
	// queue's guard): image rehosting can push a multi-recipient parse near the
	// timeout, and visibility expiring mid-flight would redeliver it.
	visibilityTimeoutSeconds: 120 + 60,
});

const receiveEmailLambda = new HutchLambda("inbox-receive-email", {
	entryPoint: "./src/runtime/receive-email.main.ts",
	outputDir: ".lib/inbox-receive-email",
	assetDir: "./src/runtime",
	memorySize: 1024,
	timeout: 120,
	environment: {
		DYNAMODB_INBOX_EMAILS_TABLE: tableNames.inboxEmails,
		DYNAMODB_INBOX_ADDRESSES_TABLE: tableNames.inboxAddresses,
		RAW_EMAIL_BUCKET_NAME: rawEmailBucketName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		// Rehosted image srcs are rewritten to this CDN origin at ingest.
		IMAGES_CDN_BASE_URL: imagesCdnBaseUrl,
		// 20 MiB — half SES's ~40 MB hard inbound cap; bounds parse memory.
		INBOX_MAX_EMAIL_BYTES: String(20 * 1024 * 1024),
	},
	policies: [
		...receiveEmailDynamodb.policies,
		// Reads the raw bucket (the .eml) and only writes the content bucket (the
		// sanitized body and the rehosted images) — no content-bucket read.
		...HutchS3ReadWrite.readPoliciesForBucket("inbox-receive-email-raw-read", rawEmailBucketName),
		...HutchS3ReadWrite.writePoliciesForBucket(
			"inbox-receive-email-content-write",
			contentBucketName,
		),
	],
});

eventBus.grantPublish(receiveEmailLambda);

new HutchSQSBackedLambda("inbox-receive-email", {
	lambda: receiveEmailLambda,
	queue: receiveEmailQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

// SES → SNS → SQS bridge: SES cannot target SQS directly, so the receipt rule
// publishes to hutch's inbox-mail topic (read via the StackReference above) and
// the receive queue subscribes here with raw message delivery, so the SQS body
// is the SES notification JSON the handler parses. The queue policy lets only
// that topic enqueue.
const receiveEmailQueuePolicy = new aws.sqs.QueuePolicy("inbox-receive-email-sns-policy", {
	queueUrl: receiveEmailQueue.queueUrl,
	policy: pulumi
		.all([receiveEmailQueue.queueArn, inboxNotificationTopicArn])
		.apply(([queueArn, topicArn]) =>
			JSON.stringify({
				Version: "2012-10-17",
				Statement: [
					{
						Effect: "Allow",
						Principal: { Service: "sns.amazonaws.com" },
						Action: "sqs:SendMessage",
						Resource: queueArn,
						Condition: { ArnEquals: { "aws:SourceArn": topicArn } },
					},
				],
			}),
		),
});

new aws.sns.TopicSubscription(
	"inbox-receive-email-subscription",
	{
		topic: inboxNotificationTopicArn,
		protocol: "sqs",
		endpoint: receiveEmailQueue.queueArn,
		rawMessageDelivery: true,
	},
	{ dependsOn: [receiveEmailQueuePolicy] },
);

// --- Inbox link previews (extract → crawl) ---
// EmailReceivedEvent → extract-email-links re-derives the body from the raw .eml,
// extracts links, writes pending rows, and fans out one CrawlEmailLinkPreview per
// link (★14 cap + truncate-degrade-with-dedicated-alert-queue) plus one
// SubmitLinkCommand per routed saveable link, which save-link's submit-link
// Lambda turns into a queue save. Each CrawlEmailLinkPreview →
// crawl-email-link-preview crawls a preview WITHOUT saving to /queue (★16 SSRF
// guard inherited from crawlAndFinalize). Neither Lambda is granted the
// articles/user-articles tables — queue writes happen only in save-link's
// subscriber, routed by command, never from an inbox Lambda's own role.
const extractEmailLinksDynamodb = new HutchDynamoDBAccess("inbox-extract-email-links-dynamodb", {
	tables: [
		{ arn: tableArn(tableNames.inboxEmails), includeIndexes: false },
		{ arn: tableArn(tableNames.inboxEmailLinks), includeIndexes: false },
	],
	// getEmail (GetItem); putLink/putLinksMeta (PutItem); setEmailLinkCounts
	// (UpdateItem); the conditional put needs no Query, and listing is the web
	// layer's job.
	actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
});

const EXTRACT_EMAIL_LINKS_TIMEOUT_SECONDS = 180;
/** SQS starts the visibility clock at receive, before the Lambda invocation
 * begins, so visibility must outlive the worker timeout by the receive-to-invoke
 * gap or a still-running extraction gets redelivered in its final seconds. */
const RECEIVE_TO_INVOKE_GUARD_SECONDS = 60;

const extractEmailLinksQueue = new HutchSQS("inbox-extract-email-links", {
	visibilityTimeoutSeconds: EXTRACT_EMAIL_LINKS_TIMEOUT_SECONDS + RECEIVE_TO_INVOKE_GUARD_SECONDS,
});

// Truncation is a successful degradation (the first N previews still shipped), not
// a processing failure — so it must NOT land in the consumer's own failure DLQ.
// There it would (a) make the DLQ depth alarm ambiguous between a genuine "email
// never extracted" and a benign "email truncated", and (b) re-enter the source
// queue on redrive and bounce straight back (the synthetic body has no `.detail`).
// It gets a dedicated sink whose send-rate alarm → SNS email instead, so the
// failure DLQ's "messages awaiting redrive" contract stays unambiguous.
const truncationAlertQueue = new aws.sqs.Queue("inbox-extract-email-links-truncated-alert", {
	name: "inbox-extract-email-links-truncated-alert",
	// Nothing consumes this queue — it is an audit trail of truncated emails. The
	// alarm below fires on send RATE, not depth, so these retained messages no
	// longer pin it in ALARM; 14 days is just how long the audit trail survives.
	messageRetentionSeconds: 1209600,
});

const truncationAlertTopic = new aws.sns.Topic("inbox-extract-email-links-truncated-alert-topic", {
	name: "inbox-extract-email-links-truncated-alert-topic",
});

new aws.sns.TopicSubscription("inbox-extract-email-links-truncated-alert-email", {
	topic: truncationAlertTopic.arn,
	protocol: "email",
	endpoint: alertEmail,
});

// Alarm on the SEND RATE (a count metric), not queue DEPTH (a gauge). Nothing
// consumes this queue, so an ApproximateNumberOfMessagesVisible>=1 depth alarm
// would stay in ALARM until the message expires 14 days later (or an operator
// purges it), and a second truncation while already in ALARM would never
// re-notify. NumberOfMessagesSent has a datapoint only in the period a message is
// enqueued, so with treatMissingData "notBreaching" the alarm fires on each
// truncation burst and auto-resets the next empty period — re-firing for the next.
new aws.cloudwatch.MetricAlarm("inbox-extract-email-links-truncated-alarm", {
	name: "inbox-extract-email-links-truncated-alarm",
	comparisonOperator: "GreaterThanOrEqualToThreshold",
	evaluationPeriods: 1,
	metricName: "NumberOfMessagesSent",
	namespace: "AWS/SQS",
	period: 300,
	statistic: "Sum",
	threshold: 1,
	treatMissingData: "notBreaching",
	alarmDescription:
		"inbox-extract-email-links hit the per-email link cap and truncated an email (the first N previews still shipped)",
	dimensions: { QueueName: truncationAlertQueue.name },
	alarmActions: [truncationAlertTopic.arn],
});

const extractEmailLinksLambda = new HutchLambda("inbox-extract-email-links", {
	entryPoint: "./src/runtime/extract-email-links.main.ts",
	outputDir: ".lib/inbox-extract-email-links",
	assetDir: "./src/runtime",
	memorySize: 1024,
	// Headroom for the bounded LLM triage attempts on top of the parse and the
	// per-link write fan-out.
	timeout: EXTRACT_EMAIL_LINKS_TIMEOUT_SECONDS,
	environment: {
		DYNAMODB_INBOX_EMAILS_TABLE: tableNames.inboxEmails,
		DYNAMODB_INBOX_EMAIL_LINKS_TABLE: tableNames.inboxEmailLinks,
		RAW_EMAIL_BUCKET_NAME: rawEmailBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		DEEPSEEK_API_KEY: deepseekApiKey,
		// A typical newsletter has < 30 links; 200 is generous headroom before the
		// per-email cap truncates and the working path still ships the first 200.
		INBOX_MAX_LINKS_PER_EMAIL: String(200),
		EXTRACT_LINKS_TRUNCATION_ALERT_QUEUE_URL: truncationAlertQueue.url,
	},
	policies: [
		...extractEmailLinksDynamodb.policies,
		// Reads the raw .eml to re-derive the body; never writes any bucket.
		...HutchS3ReadWrite.readPoliciesForBucket(
			"inbox-extract-email-links-raw-read",
			rawEmailBucketName,
		),
		// The truncated-degrade alert is an explicit SendMessage to the dedicated
		// alert queue (NOT the failure DLQ), whose own send-rate alarm pages the operator.
		{
			name: "inbox-extract-email-links-truncated-alert-send-pol",
			policy: pulumi.output(truncationAlertQueue.arn).apply((arn) =>
				JSON.stringify({
					Version: "2012-10-17",
					Statement: [{ Effect: "Allow", Action: ["sqs:SendMessage"], Resource: [arn] }],
				}),
			),
		},
	],
});

eventBus.grantPublish(extractEmailLinksLambda);

const extractEmailLinksWithSQS = new HutchSQSBackedLambda("inbox-extract-email-links", {
	lambda: extractEmailLinksLambda,
	queue: extractEmailLinksQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

// The explicit rule name keeps this subscription distinct from the rule hutch's
// stack still owns for the same event — PutRule is an upsert, so a same-named
// rule would steal hutch's live subscription instead of adding one.
eventBus.subscribe(EmailReceivedEvent, extractEmailLinksWithSQS, {
	name: "inbox-extract-email-links",
});

const crawlEmailLinkPreviewDynamodb = new HutchDynamoDBAccess(
	"inbox-crawl-email-link-preview-dynamodb",
	{
		tables: [{ arn: tableArn(tableNames.inboxEmailLinks), includeIndexes: false }],
		// setLinkOutcome is an UpdateItem; getLink is not used by the worker.
		actions: ["dynamodb:UpdateItem"],
	},
);

const crawlEmailLinkPreviewQueue = new HutchSQS("inbox-crawl-email-link-preview", {
	// A single dead/slow origin retries and DLQs in isolation; matches the worker
	// timeout so an in-flight crawl cannot be redelivered.
	visibilityTimeoutSeconds: 120,
});

const crawlEmailLinkPreviewLambda = new HutchLambda("inbox-crawl-email-link-preview", {
	entryPoint: "./src/runtime/crawl-email-link-preview.main.ts",
	outputDir: ".lib/inbox-crawl-email-link-preview",
	assetDir: "./src/runtime",
	memorySize: 1024,
	timeout: 120,
	environment: {
		DYNAMODB_INBOX_EMAIL_LINKS_TABLE: tableNames.inboxEmailLinks,
		// Uploads each lead image to the shared content bucket, fronted by the
		// save-link content-media CDN (derived from config above).
		CONTENT_BUCKET_NAME: contentBucketName,
		IMAGES_CDN_BASE_URL: imagesCdnBaseUrl,
	},
	policies: [
		...crawlEmailLinkPreviewDynamodb.policies,
		// Only writes the content bucket (the lead-image thumbnail) — no read, and
		// no access to the articles/user-articles tables (the preview itself
		// saves nothing to /queue; the queue save rides SubmitLinkCommand from
		// the extract Lambda into save-link's subscriber).
		...HutchS3ReadWrite.writePoliciesForBucket(
			"inbox-crawl-email-link-preview-content-write",
			contentBucketName,
		),
	],
});

const crawlEmailLinkPreviewWithSQS = new HutchSQSBackedLambda("inbox-crawl-email-link-preview", {
	lambda: crawlEmailLinkPreviewLambda,
	queue: crawlEmailLinkPreviewQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(CrawlEmailLinkPreview, crawlEmailLinkPreviewWithSQS, {
	name: "inbox-crawl-email-link-preview",
});

export const functionName = webLambda.functionName;
export const routeKeys = inboxRoutes.routes.map((route) => route.routeKey);

/** The inbox web Lambda has no URL of its own — it answers on hutch's API
 * Gateway under /inbox. Re-export hutch's apiUrl so post-deploy can smoke-test
 * the live routes without a second StackReference at verification time. */
export const apiUrl = hutchApiUrl;
