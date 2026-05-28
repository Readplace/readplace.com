import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import assert from "node:assert";
import { resolve } from "node:path";
import { HutchLambda, HutchAPIGateway, HutchDynamoDBAccess, HutchEventBus, HutchS3ReadWrite, HutchSQS, HutchSQSBackedLambda, HutchStripeWebhookReceiver } from "@packages/hutch-infra-components/infra";
import {
	CancelSubscriptionCommand,
	ExportUserDataCommand,
	SubscriptionCancelledEvent,
	SubscriptionChargeFailedEvent,
	SubscriptionChargeSucceededEvent,
	SubscriptionStartRequestCommand,
} from "@packages/hutch-infra-components";
import { EXPORT_DOWNLOAD_TTL_DAYS, EXPORT_S3_KEY_PREFIX } from "../runtime/web/pages/export/export-ttl";
import { ANALYTICS_EVENTS, LAMBDA_NAMES, LOG_GROUPS, METRICS, STREAMS } from "../runtime/observability/events";
import {
	buildAnalyticsDashboardBody,
	SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
} from "../runtime/observability/analytics-dashboard";
import { DomainRegistration } from "./domain-registration";
import { DomainRedirect } from "./domain-redirect";
import { HutchStorage } from "./hutch-storage";
import { HutchStaticAssets } from "./hutch-static-assets";
import { requireEnv } from "../runtime/domain/require-env";

const config = new pulumi.Config();
const stage = config.require("stage");
const trialSchedulerGroupName = config.require("trialSchedulerGroupName");
const domains = config.getObject<string[]>("domains") ?? [];
const deletionProtection = config.requireBoolean("deletionProtection");
const staticDomains = config.requireObject<string[]>("staticDomains");
assert(staticDomains.length > 0, "staticDomains must have at least one entry");
const staticBucketName = config.require("staticBucketName");
const contentBucketName = config.require("contentBucketName");
const pendingHtmlBucketName = config.require("pendingHtmlBucketName");
const userExportBucketName = config.require("userExportBucketName");
const alertEmail = config.require("alertEmail");
const tableNames = {
	articles: config.require("dynamodbArticlesTable"),
	userArticles: config.require("dynamodbUserArticlesTable"),
	users: config.require("dynamodbUsersTable"),
	sessions: config.require("dynamodbSessionsTable"),
	oauth: config.require("dynamodbOauthTable"),
	verificationTokens: config.require("dynamodbVerificationTokensTable"),
	passwordResetTokens: config.require("dynamodbPasswordResetTokensTable"),
	pendingSignups: config.require("dynamodbPendingSignupsTable"),
	importSessions: config.require("dynamodbImportSessionsTable"),
	subscriptionProviders: config.require("dynamodbSubscriptionProvidersTable"),
};

const storage = new HutchStorage("hutch", {
	deletionProtection,
	tableNames,
});

const redirectDomains = config.getObject<string[]>("redirectDomains") ?? [];

/**
 * Ordering convention:
 *   domains[0]           — legacy primary; keeps the original Pulumi resource names
 *                          ("hutch-domain", HutchAPIGateway's internal custom-domain wiring)
 *                          so existing deployments see a no-op.
 *   domains[1..]         — additional canonicals added during migration; each gets its own
 *                          DomainRegistration and API Gateway wiring with suffixed names.
 *   domains[last]        — canonical user-facing origin (SEO, emails, OAuth). Latest entry
 *                          wins so migrating to a new canonical just means appending.
 */
const [legacyPrimaryDomain, ...additionalDomains] = domains;
const canonicalDomain: string | undefined = domains[domains.length - 1];

const legacyDomainRegistration = new DomainRegistration("hutch-domain", {
	domains: legacyPrimaryDomain ? [legacyPrimaryDomain] : [],
});

const additionalDomainRegistrations = additionalDomains.map((domain) =>
	new DomainRegistration(`hutch-domain-${domain.replace(/\./g, "-")}`, { domains: [domain] }),
);

const allDomainRegistrations = [legacyDomainRegistration, ...additionalDomainRegistrations];

if (redirectDomains.length > 0) {
	assert(canonicalDomain, "redirectDomains requires domains to be configured");
	new DomainRedirect("hutch-redirect", {
		redirectDomains,
		targetDomain: canonicalDomain,
	});
}

const staticDomainEntries = staticDomains.map((staticDomain) => {
	const parentIndex = domains.findIndex((d) => staticDomain.endsWith(`.${d}`));
	const parentRegistration = parentIndex >= 0 ? allDomainRegistrations[parentIndex] : undefined;
	return parentRegistration?.zoneId
		? { domain: staticDomain, zoneId: parentRegistration.zoneId }
		: { domain: staticDomain };
});

const staticAssets = new HutchStaticAssets("hutch-static", {
	bucketName: staticBucketName,
	staticDomains: staticDomainEntries,
	domains,
	sourceDir: resolve(__dirname, "../../static-assets"),
});

const eventBus = HutchEventBus.fromPlatformStack(config);

const dynamodb = new HutchDynamoDBAccess("hutch-dynamodb-access", {
	tables: [
		{ arn: storage.articlesTable.arn, includeIndexes: true },
		{ arn: storage.userArticlesTable.arn, includeIndexes: true },
		{ arn: storage.usersTable.arn, includeIndexes: true },
		{ arn: storage.sessionsTable.arn, includeIndexes: false },
		{ arn: storage.oauthTable.arn, includeIndexes: true },
		{ arn: storage.verificationTokensTable.arn, includeIndexes: false },
		{ arn: storage.passwordResetTokensTable.arn, includeIndexes: false },
		{ arn: storage.pendingSignupsTable.arn, includeIndexes: false },
		{ arn: storage.importSessionsTable.arn, includeIndexes: false },
		{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: true },
	],
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

const logGroup = new aws.cloudwatch.LogGroup("hutch-log-analytics", {
	name: LOG_GROUPS.hutchHandler,
	retentionInDays: 30,
}, { import: LOG_GROUPS.hutchHandler });

const api = new aws.apigatewayv2.Api("hutch-api-gateway", {
	name: "hutch-api-gateway",
	protocolType: "HTTP",
	description: `Readplace API Gateway (${stage})`,
});

export const appOrigin: pulumi.Input<string> = canonicalDomain
	? `https://${canonicalDomain}`
	: api.apiEndpoint;

// --- EventBridge Scheduler Group + Execution Role ---
// One-shot schedules created at trial signup live in a dedicated group so a
// stage's schedules are isolated from prod. The scheduler-execution role is
// assumed by the EventBridge Scheduler service when a schedule fires; it has
// permission to put events on the hutch bus (which then routes the
// SubscriptionStartRequestCommand to the subscription-start-request Lambda).

const trialSchedulerGroup = new aws.scheduler.ScheduleGroup(
	"hutch-trial-scheduler-group",
	{ name: trialSchedulerGroupName },
);

const trialSchedulerRole = new aws.iam.Role("hutch-trial-scheduler-role", {
	assumeRolePolicy: JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Principal: { Service: "scheduler.amazonaws.com" },
				Action: "sts:AssumeRole",
			},
		],
	}),
});

new aws.iam.RolePolicy("hutch-trial-scheduler-role-policy", {
	role: trialSchedulerRole.id,
	policy: pulumi.all([eventBus.eventBusArn]).apply(([busArn]) =>
		JSON.stringify({
			Version: "2012-10-17",
			Statement: [
				{
					Effect: "Allow",
					Action: ["events:PutEvents"],
					Resource: busArn,
				},
			],
		}),
	),
});

const trialSchedulerManagePolicyDoc = pulumi
	.all([trialSchedulerGroup.arn, trialSchedulerRole.arn])
	.apply(([groupArn, roleArn]) =>
		JSON.stringify({
			Version: "2012-10-17",
			Statement: [
				{
					Effect: "Allow",
					Action: ["scheduler:CreateSchedule", "scheduler:DeleteSchedule"],
					Resource: `${groupArn.replace(":schedule-group/", ":schedule/")}*`,
				},
				{
					Effect: "Allow",
					Action: ["scheduler:CreateSchedule"],
					Resource: groupArn,
				},
				{
					Effect: "Allow",
					Action: ["iam:PassRole"],
					Resource: roleArn,
				},
			],
		}),
	);

const trialSchedulerManagePolicy = {
	name: "hutch-trial-scheduler-manage",
	policy: trialSchedulerManagePolicyDoc,
};

const trialSchedulerDeletePolicyDoc = pulumi
	.all([trialSchedulerGroup.arn])
	.apply(([groupArn]) =>
		JSON.stringify({
			Version: "2012-10-17",
			Statement: [
				{
					Effect: "Allow",
					Action: ["scheduler:DeleteSchedule"],
					Resource: `${groupArn.replace(":schedule-group/", ":schedule/")}*`,
				},
			],
		}),
	);

const trialSchedulerDeletePolicy = {
	name: "hutch-trial-scheduler-delete",
	policy: trialSchedulerDeletePolicyDoc,
};

const lambda = new HutchLambda(LAMBDA_NAMES.hutchHandler, {
	entryPoint: "./src/runtime/lambda.main.ts",
	outputDir: ".lib/hutch-api",
	assetDir: "./src/runtime",
	memorySize: 512,
	timeout: 30,
	environment: {
		NODE_ENV: stage === "production" ? "production" : "development",
		PERSISTENCE: "prod",
		APP_ORIGIN: appOrigin,
		DYNAMODB_ARTICLES_TABLE: storage.articlesTable.name,
		DYNAMODB_USER_ARTICLES_TABLE: storage.userArticlesTable.name,
		DYNAMODB_USERS_TABLE: storage.usersTable.name,
		DYNAMODB_SESSIONS_TABLE: storage.sessionsTable.name,
		DYNAMODB_OAUTH_TABLE: storage.oauthTable.name,
		DYNAMODB_VERIFICATION_TOKENS_TABLE: storage.verificationTokensTable.name,
		DYNAMODB_PASSWORD_RESET_TOKENS_TABLE: storage.passwordResetTokensTable.name,
		DYNAMODB_PENDING_SIGNUPS_TABLE: storage.pendingSignupsTable.name,
		DYNAMODB_IMPORT_SESSIONS_TABLE: storage.importSessionsTable.name,
		DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: storage.subscriptionProvidersTable.name,
		GOOGLE_LOGIN_CLIENT_ID: requireEnv("GOOGLE_LOGIN_CLIENT_ID"),
		GOOGLE_LOGIN_CLIENT_SECRET: requireEnv("GOOGLE_LOGIN_CLIENT_SECRET"),
		RESEND_API_KEY: requireEnv("RESEND_API_KEY"),
		STRIPE_SECRET_KEY: requireEnv("STRIPE_SECRET_KEY"),
		STRIPE_PRICE_ID: requireEnv("STRIPE_PRICE_ID"),
		STATIC_BASE_URL: staticAssets.baseUrl,
		EVENT_BUS_NAME: eventBus.eventBusName,
		EVENT_BUS_ARN: eventBus.eventBusArn,
		CONTENT_BUCKET_NAME: contentBucketName,
		PENDING_HTML_BUCKET_NAME: pendingHtmlBucketName,
		ANALYTICS_SALT: requireEnv("ANALYTICS_SALT"),
		ADMIN_EMAILS: requireEnv("ADMIN_EMAILS"),
		RECRAWL_SERVICE_TOKEN: requireEnv("RECRAWL_SERVICE_TOKEN"),
		TRIAL_SCHEDULER_GROUP_NAME: trialSchedulerGroup.name,
		TRIAL_SCHEDULER_ROLE_ARN: trialSchedulerRole.arn,
		EXPIRY_COUNTDOWN: config.require("expiryCountdown"),
	},
	policies: [
		...dynamodb.policies,
		...HutchS3ReadWrite.readPoliciesForBucket("hutch-content-s3", contentBucketName),
		...HutchS3ReadWrite.writePoliciesForBucket("hutch-pending-html", pendingHtmlBucketName),
		trialSchedulerManagePolicy,
	],
});

eventBus.grantPublish(lambda);

const gateway = new HutchAPIGateway("hutch", {
	api,
	lambda: lambda,
	stage,
	domains: legacyPrimaryDomain ? [legacyPrimaryDomain] : [],
	zoneId: legacyDomainRegistration.zoneId,
	certificateArn: legacyDomainRegistration.certificateArn,
});

for (const [i, domain] of additionalDomains.entries()) {
	const safeName = domain.replace(/\./g, "-");
	const registration = additionalDomainRegistrations[i];
	assert(registration.certificateArn, `${domain} registration must have a certificate`);
	assert(registration.zoneId, `${domain} registration must have a zoneId`);

	const customDomain = new aws.apigatewayv2.DomainName(
		`hutch-apigw-domain-${safeName}`,
		{
			domainName: domain,
			domainNameConfiguration: {
				certificateArn: registration.certificateArn,
				endpointType: "REGIONAL",
				securityPolicy: "TLS_1_2",
			},
		},
	);

	new aws.apigatewayv2.ApiMapping(
		`hutch-apigw-mapping-${safeName}`,
		{
			apiId: api.id,
			domainName: customDomain.domainName,
			stage: "$default",
		},
		{ dependsOn: [gateway] },
	);

	new aws.route53.Record(`hutch-apigw-record-${safeName}`, {
		zoneId: registration.zoneId,
		name: domain,
		type: "A",
		aliases: [
			{
				name: customDomain.domainNameConfiguration.apply((c) => c.targetDomainName),
				zoneId: customDomain.domainNameConfiguration.apply((c) => c.hostedZoneId),
				evaluateTargetHealth: false,
			},
		],
	});
}

// --- User Data Export Bucket ---
// Stores user-data export JSON files keyed under exports/<userId>/<timestamp>.json.
// Bucket-private; downloads are issued via short-lived presigned URLs from the
// worker Lambda. The lifecycle rule expires every object under the export
// prefix after EXPORT_DOWNLOAD_TTL_DAYS so unused archives are evicted at the
// same cadence as the presigned URL TTL — both numbers move together via the
// shared constant in runtime/web/pages/export/export-ttl.ts.

const userExportBucket = new HutchS3ReadWrite("user-export-bucket", {
	bucketName: userExportBucketName,
});

new aws.s3.BucketLifecycleConfigurationV2("user-export-bucket-lifecycle", {
	bucket: userExportBucket.bucket,
	rules: [
		{
			id: "expire-user-exports",
			status: "Enabled",
			filter: { prefix: EXPORT_S3_KEY_PREFIX },
			expiration: { days: EXPORT_DOWNLOAD_TTL_DAYS },
		},
	],
});

// --- ExportUserData worker Lambda ---
// Subscribes to ExportUserDataCommand published by the web Lambda when a logged-in
// user clicks "Email Me My Data". Paginates the user's articles, streams a JSON
// blob to userExportBucket, generates a presigned GetObject URL valid for the
// shared TTL, emails the user the link via Resend, and publishes
// UserDataExportedEvent. SQS retry → DLQ on transient failure; the
// HutchSQSBackedLambda CloudWatch alarm pages the operator on DLQ arrival.

const exportUserDataDynamodb = new HutchDynamoDBAccess("export-user-data-dynamodb", {
	tables: [
		{ arn: storage.articlesTable.arn, includeIndexes: false },
		{ arn: storage.userArticlesTable.arn, includeIndexes: true },
	],
	actions: ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query"],
});

const exportUserDataQueue = new HutchSQS("export-user-data", {
	// Max single-export wall time before SQS makes the message visible again
	// for retry. 900s matches the worker Lambda timeout below so a single
	// invocation cannot be redelivered while still running.
	visibilityTimeoutSeconds: 900,
});

const exportUserDataLambda = new HutchLambda("export-user-data", {
	entryPoint: "./src/runtime/export-user-data.main.ts",
	outputDir: ".lib/export-user-data",
	assetDir: "./src/runtime",
	memorySize: 1024,
	timeout: 900,
	environment: {
		PERSISTENCE: "prod",
		DYNAMODB_ARTICLES_TABLE: storage.articlesTable.name,
		DYNAMODB_USER_ARTICLES_TABLE: storage.userArticlesTable.name,
		EVENT_BUS_NAME: eventBus.eventBusName,
		USER_EXPORT_BUCKET_NAME: userExportBucket.bucket,
		RESEND_API_KEY: requireEnv("RESEND_API_KEY"),
	},
	policies: [
		...exportUserDataDynamodb.policies,
		...userExportBucket.readPolicies("export-user-data-bucket-read"),
		...userExportBucket.writePolicies("export-user-data-bucket-write"),
	],
});

eventBus.grantPublish(exportUserDataLambda);

const exportUserDataLambdaWithSQS = new HutchSQSBackedLambda("export-user-data", {
	lambda: exportUserDataLambda,
	queue: exportUserDataQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(ExportUserDataCommand, exportUserDataLambdaWithSQS);

// --- Stripe Webhook Receiver ---
// Receives HTTP POST from Stripe via API Gateway, verifies the HMAC signature,
// and emits domain events (e.g. SubscriptionCancelledEvent) via EventBridge.
// `events` declares the Stripe event types the runtime dispatch map is wired
// for — unknown types throw, surfacing as Lambda errors that fire the
// component's CloudWatch alarm. The shared StripeEventType union ties this
// array to the runtime composition root at the type level.

new HutchStripeWebhookReceiver("stripe-webhook-receiver", {
	apiGatewayId: api.id,
	apiGatewayExecutionArn: api.executionArn,
	routeKey: "POST /webhooks/stripe",
	eventBus,
	subscriptionProvidersTable: {
		arn: storage.subscriptionProvidersTable.arn,
		name: storage.subscriptionProvidersTable.name,
	},
	webhookSecret: requireEnv("STRIPE_WEBHOOK_SECRET"),
	events: ["customer.subscription.deleted"],
	alertEmail,
});

// --- Handle Subscription Cancelled ---
// SQS-backed Lambda that reacts to SubscriptionCancelledEvent by marking the
// subscription_providers row as cancelled. Failed messages land in a DLQ with
// an email alarm so operators can redrive without relying on Stripe retries.

const handleSubscriptionCancelledDynamodb = new HutchDynamoDBAccess("handle-subscription-cancelled-dynamodb", {
	tables: [
		{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: false },
	],
	actions: ["dynamodb:UpdateItem"],
});

const handleSubscriptionCancelledQueue = new HutchSQS("handle-subscription-cancelled", {
	visibilityTimeoutSeconds: 30,
});

const handleSubscriptionCancelledLambda = new HutchLambda(LAMBDA_NAMES.handleSubscriptionCancelled, {
	entryPoint: "./src/runtime/handle-subscription-cancelled.main.ts",
	outputDir: ".lib/handle-subscription-cancelled",
	assetDir: "./src/runtime",
	memorySize: 128,
	timeout: 30,
	environment: {
		PERSISTENCE: "prod",
		DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: storage.subscriptionProvidersTable.name,
	},
	policies: [
		...handleSubscriptionCancelledDynamodb.policies,
	],
});

const handleSubscriptionCancelledWithSQS = new HutchSQSBackedLambda("handle-subscription-cancelled", {
	lambda: handleSubscriptionCancelledLambda,
	queue: handleSubscriptionCancelledQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SubscriptionCancelledEvent, handleSubscriptionCancelledWithSQS);

// --- Cancel Subscription Command ---
// SQS-backed Lambda that reacts to CancelSubscriptionCommand (user-initiated
// cancel from POST /account/cancel). Branches on the row's current status:
//   - active           → calls Stripe subscriptions.cancel (immediate)
//   - trialing         → publishes SubscriptionCancelledEvent directly
//   - pending_cancel.  → publishes SubscriptionCancelledEvent (defensive)
//   - cancelled        → noop
// Failed messages land in a DLQ with an email alarm so operators can redrive.

const cancelSubscriptionDynamodb = new HutchDynamoDBAccess("cancel-subscription-dynamodb", {
	tables: [
		{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: false },
	],
	actions: ["dynamodb:GetItem"],
});

const cancelSubscriptionQueue = new HutchSQS("cancel-subscription", {
	visibilityTimeoutSeconds: 30,
});

const cancelSubscriptionLambda = new HutchLambda(LAMBDA_NAMES.cancelSubscription, {
	entryPoint: "./src/runtime/cancel-subscription.main.ts",
	outputDir: ".lib/cancel-subscription",
	assetDir: "./src/runtime",
	memorySize: 128,
	timeout: 30,
	environment: {
		PERSISTENCE: "prod",
		DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: storage.subscriptionProvidersTable.name,
		STRIPE_SECRET_KEY: requireEnv("STRIPE_SECRET_KEY"),
		EVENT_BUS_NAME: eventBus.eventBusName,
		TRIAL_SCHEDULER_GROUP_NAME: trialSchedulerGroup.name,
	},
	policies: [
		...cancelSubscriptionDynamodb.policies,
		trialSchedulerDeletePolicy,
	],
});

eventBus.grantPublish(cancelSubscriptionLambda);

const cancelSubscriptionWithSQS = new HutchSQSBackedLambda("cancel-subscription", {
	lambda: cancelSubscriptionLambda,
	queue: cancelSubscriptionQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(CancelSubscriptionCommand, cancelSubscriptionWithSQS);

// --- Subscription Start Request (trial-end auto-charge) ---
// SQS-backed Lambda invoked by the EventBridge Scheduler one-shot rule created
// at trial signup. Reads the subscription_providers row, attempts a Stripe
// subscriptions.create on an existing customer if one is present (rare —
// no-card trials are the typical case), and publishes either
// SubscriptionChargeSucceeded or SubscriptionChargeFailed. Failed messages
// land in a DLQ with an email alarm.

const subscriptionStartRequestDynamodb = new HutchDynamoDBAccess("subscription-start-request-dynamodb", {
	tables: [{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: false }],
	actions: ["dynamodb:GetItem"],
});

const subscriptionStartRequestQueue = new HutchSQS("subscription-start-request", {
	visibilityTimeoutSeconds: 30,
});

const subscriptionStartRequestLambda = new HutchLambda(LAMBDA_NAMES.subscriptionStartRequest, {
	entryPoint: "./src/runtime/subscription-start-request.main.ts",
	outputDir: ".lib/subscription-start-request",
	assetDir: "./src/runtime",
	memorySize: 128,
	timeout: 30,
	environment: {
		PERSISTENCE: "prod",
		DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: storage.subscriptionProvidersTable.name,
		STRIPE_SECRET_KEY: requireEnv("STRIPE_SECRET_KEY"),
		STRIPE_PRICE_ID: requireEnv("STRIPE_PRICE_ID"),
		EVENT_BUS_NAME: eventBus.eventBusName,
	},
	policies: [...subscriptionStartRequestDynamodb.policies],
});

eventBus.grantPublish(subscriptionStartRequestLambda);

const subscriptionStartRequestWithSQS = new HutchSQSBackedLambda("subscription-start-request", {
	lambda: subscriptionStartRequestLambda,
	queue: subscriptionStartRequestQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SubscriptionStartRequestCommand, subscriptionStartRequestWithSQS);

// --- Subscription Charge Succeeded ---
// SQS-backed Lambda that flips the row to status='active' when the trial-end
// charge attempt succeeds. Failed messages land in a DLQ.

const subscriptionChargeSucceededDynamodb = new HutchDynamoDBAccess("subscription-charge-succeeded-dynamodb", {
	tables: [{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: false }],
	actions: ["dynamodb:UpdateItem"],
});

const subscriptionChargeSucceededQueue = new HutchSQS("subscription-charge-succeeded", {
	visibilityTimeoutSeconds: 30,
});

const subscriptionChargeSucceededLambda = new HutchLambda(LAMBDA_NAMES.subscriptionChargeSucceeded, {
	entryPoint: "./src/runtime/subscription-charge-succeeded.main.ts",
	outputDir: ".lib/subscription-charge-succeeded",
	assetDir: "./src/runtime",
	memorySize: 128,
	timeout: 30,
	environment: {
		PERSISTENCE: "prod",
		DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: storage.subscriptionProvidersTable.name,
	},
	policies: [...subscriptionChargeSucceededDynamodb.policies],
});

const subscriptionChargeSucceededWithSQS = new HutchSQSBackedLambda("subscription-charge-succeeded", {
	lambda: subscriptionChargeSucceededLambda,
	queue: subscriptionChargeSucceededQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SubscriptionChargeSucceededEvent, subscriptionChargeSucceededWithSQS);

// --- Subscription Charge Failed ---
// SQS-backed Lambda that dispatches CancelSubscriptionCommand when the
// trial-end charge attempt fails (no card on file or Stripe error). The
// downstream cancel chain takes over from there.

const subscriptionChargeFailedQueue = new HutchSQS("subscription-charge-failed", {
	visibilityTimeoutSeconds: 30,
});

const subscriptionChargeFailedLambda = new HutchLambda(LAMBDA_NAMES.subscriptionChargeFailed, {
	entryPoint: "./src/runtime/subscription-charge-failed.main.ts",
	outputDir: ".lib/subscription-charge-failed",
	assetDir: "./src/runtime",
	memorySize: 128,
	timeout: 30,
	environment: {
		PERSISTENCE: "prod",
		EVENT_BUS_NAME: eventBus.eventBusName,
	},
	policies: [],
});

eventBus.grantPublish(subscriptionChargeFailedLambda);

const subscriptionChargeFailedWithSQS = new HutchSQSBackedLambda("subscription-charge-failed", {
	lambda: subscriptionChargeFailedLambda,
	queue: subscriptionChargeFailedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SubscriptionChargeFailedEvent, subscriptionChargeFailedWithSQS);

// --- Analytics Dashboard ---
// The widget builder lives in runtime/observability/analytics-dashboard so the
// dashboard JSON is constructable and assertable outside the Pulumi runtime —
// see analytics-dashboard.test.ts for the coverage / no-unknown-references
// drift checks against the constants in runtime/observability/events.

const region = aws.config.requireRegion();

const excludedVisitorHashes = config.requireObject<string[]>("excludedVisitorHashes");
for (const hash of excludedVisitorHashes) {
	assert(/^[a-f0-9]+$/.test(hash), `excludedVisitorHashes entries must be lowercase hex (got: ${hash})`);
}

new aws.cloudwatch.LogMetricFilter("imports-completed-filter", {
	name: "imports-completed",
	logGroupName: logGroup.name,
	pattern: `{ $.stream = "${STREAMS.analytics}" && $.event = "${ANALYTICS_EVENTS.importCommitted}" }`,
	metricTransformation: {
		name: METRICS.importsCompleted.name,
		namespace: METRICS.importsCompleted.namespace,
		value: "1",
		defaultValue: "0",
		unit: "Count",
	},
});

// AWS auto-creates Lambda log groups on first invocation, but the subscription
// Lambdas only run after a trial ends — so until the first trial-end charge
// fires in a stack, none of these log groups exist and the analytics dashboard's
// Logs Insights queries against them fail with `ResourceNotFoundException`.
// Manage them explicitly so the dashboard renders an empty result set instead
// of erroring. Names are sourced from LOG_GROUPS so a rename in events.ts
// propagates here without manual edits.
//
// Each uses `import:` because every existing stack has had at least one
// subscription Lambda invocation, so AWS has already auto-created the groups.
// Pulumi can't `create` over an existing resource — `import:` adopts the
// existing log group into state on the first deploy, then becomes a no-op on
// subsequent runs. A brand-new stack with zero subscription Lambda invocations
// would need each log group pre-created with `aws logs create-log-group`
// before the first deploy.
const subscriptionLogGroups = [
	new aws.cloudwatch.LogGroup("subscription-start-request-log-group", {
		name: LOG_GROUPS.subscriptionStartRequest,
		retentionInDays: 30,
	}, { import: LOG_GROUPS.subscriptionStartRequest }),
	new aws.cloudwatch.LogGroup("subscription-charge-succeeded-log-group", {
		name: LOG_GROUPS.subscriptionChargeSucceeded,
		retentionInDays: 30,
	}, { import: LOG_GROUPS.subscriptionChargeSucceeded }),
	new aws.cloudwatch.LogGroup("subscription-charge-failed-log-group", {
		name: LOG_GROUPS.subscriptionChargeFailed,
		retentionInDays: 30,
	}, { import: LOG_GROUPS.subscriptionChargeFailed }),
	new aws.cloudwatch.LogGroup("cancel-subscription-log-group", {
		name: LOG_GROUPS.cancelSubscription,
		retentionInDays: 30,
	}, { import: LOG_GROUPS.cancelSubscription }),
	new aws.cloudwatch.LogGroup("handle-subscription-cancelled-log-group", {
		name: LOG_GROUPS.handleSubscriptionCancelled,
		retentionInDays: 30,
	}, { import: LOG_GROUPS.handleSubscriptionCancelled }),
];

new aws.cloudwatch.Dashboard("readplace-analytics", {
	dashboardName: "readplace-analytics",
	dashboardBody: pulumi.output(logGroup.name).apply((hutchLogGroupName) =>
		JSON.stringify(buildAnalyticsDashboardBody({
			region,
			hutchLogGroupName,
			subscriptionLogGroupNames: SUBSCRIPTION_DASHBOARD_LOG_GROUPS,
			excludedVisitorHashes,
		})),
	),
}, { dependsOn: subscriptionLogGroups });


// --- Exports ---

export const apiUrl: pulumi.Input<string> = canonicalDomain ? `https://${canonicalDomain}` : gateway.apiUrl;
export const functionName = lambda.functionName;
export const staticBaseUrl = staticAssets.baseUrl;
export const exportUserDataQueueUrl = exportUserDataQueue.queueUrl;
export const exportUserDataDlqUrl = exportUserDataQueue.dlqUrl;
export const userExportBucketOutputName = userExportBucket.bucket;
export const _dependencies = [gateway.defaultRoute];
