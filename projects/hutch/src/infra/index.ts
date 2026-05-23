import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import assert from "node:assert";
import { resolve } from "node:path";
import { HutchLambda, HutchAPIGateway, HutchAPIGatewayLambdaRoute, HutchDynamoDBAccess, HutchEventBus, HutchS3ReadWrite, HutchSQS, HutchSQSBackedLambda } from "@packages/hutch-infra-components/infra";
import { ExportUserDataCommand, SubscriptionCancelledEvent } from "@packages/hutch-infra-components";
import { EXPORT_DOWNLOAD_TTL_DAYS, EXPORT_S3_KEY_PREFIX } from "../runtime/web/pages/export/export-ttl";
import { PARSE_ERROR_STREAM, CRAWL_OUTCOME_STREAM } from "@packages/hutch-infra-components";
import { DomainRegistration } from "./domain-registration";
import { DomainRedirect } from "./domain-redirect";
import { HutchStorage } from "./hutch-storage";
import { HutchStaticAssets } from "./hutch-static-assets";
import { requireEnv } from "../runtime/domain/require-env";

const config = new pulumi.Config();
const stage = config.require("stage");
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
	name: "/aws/lambda/hutch-handler",
	retentionInDays: 30,
}, { import: "/aws/lambda/hutch-handler" });

const api = new aws.apigatewayv2.Api("hutch-api-gateway", {
	name: "hutch-api-gateway",
	protocolType: "HTTP",
	description: `Readplace API Gateway (${stage})`,
});

export const appOrigin: pulumi.Input<string> = canonicalDomain
	? `https://${canonicalDomain}`
	: api.apiEndpoint;

const lambda = new HutchLambda("hutch", {
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
		CONTENT_BUCKET_NAME: contentBucketName,
		PENDING_HTML_BUCKET_NAME: pendingHtmlBucketName,
		ANALYTICS_SALT: requireEnv("ANALYTICS_SALT"),
		ADMIN_EMAILS: requireEnv("ADMIN_EMAILS"),
		RECRAWL_SERVICE_TOKEN: requireEnv("RECRAWL_SERVICE_TOKEN"),
	},
	policies: [
		...dynamodb.policies,
		...HutchS3ReadWrite.readPoliciesForBucket("hutch-content-s3", contentBucketName),
		...HutchS3ReadWrite.writePoliciesForBucket("hutch-pending-html", pendingHtmlBucketName),
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
// Returns 200 after successful publish; lets EventBridge failures propagate so
// API Gateway returns 5xx and Stripe retries. Downstream handler failures are
// caught by the SQS-backed handler's DLQ.

const stripeWebhookReceiverLambda = new HutchLambda("stripe-webhook-receiver", {
	entryPoint: "./src/runtime/stripe-webhook-receiver.main.ts",
	outputDir: ".lib/stripe-webhook-receiver",
	assetDir: "./src/runtime",
	memorySize: 128,
	timeout: 10,
	environment: {
		STRIPE_WEBHOOK_SECRET: requireEnv("STRIPE_WEBHOOK_SECRET"),
		EVENT_BUS_NAME: eventBus.eventBusName,
	},
	policies: [],
});

eventBus.grantPublish(stripeWebhookReceiverLambda);

new HutchAPIGatewayLambdaRoute("stripe-webhook", {
	apiGatewayId: api.id,
	apiGatewayExecutionArn: api.executionArn,
	lambda: stripeWebhookReceiverLambda,
	routeKeys: ["POST /webhooks/stripe"],
});

// --- Handle Subscription Cancelled ---
// SQS-backed Lambda that reacts to SubscriptionCancelledEvent by marking the
// subscription_providers row as cancelled. Failed messages land in a DLQ with
// an email alarm so operators can redrive without relying on Stripe retries.

const handleSubscriptionCancelledDynamodb = new HutchDynamoDBAccess("handle-subscription-cancelled-dynamodb", {
	tables: [
		{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: true },
	],
	actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"],
});

const handleSubscriptionCancelledQueue = new HutchSQS("handle-subscription-cancelled", {
	visibilityTimeoutSeconds: 30,
});

const handleSubscriptionCancelledLambda = new HutchLambda("handle-subscription-cancelled", {
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

// --- Analytics Dashboard ---

const region = aws.config.requireRegion();

/**
 * Single log group uses the `SOURCE '<name>'` shorthand. Multiple log groups
 * use the `logGroups(namePrefix: [...])` function — comma-separated quoted
 * names do NOT work, CloudWatch reads the whole string as one log group and
 * rejects with "LogGroupName cannot contain a comma".
 * See https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Source.html
 */
function sourceClause(logGroupNames: readonly string[]): string {
	if (logGroupNames.length === 1) return `SOURCE '${logGroupNames[0]}'`;
	const prefixes = logGroupNames.map((n) => `'${n}'`).join(", ");
	return `SOURCE logGroups(namePrefix: [${prefixes}])`;
}

function logWidget(params: {
	title: string;
	logGroupNames: string[];
	query: string;
	x: number;
	y: number;
	width: number;
	height: number;
	view: "pie" | "table" | "bar" | "timeSeries";
}) {
	return {
		type: "log",
		x: params.x,
		y: params.y,
		width: params.width,
		height: params.height,
		properties: {
			region,
			title: params.title,
			query: `${sourceClause(params.logGroupNames)} | ${params.query}`,
			view: params.view,
		},
	};
}

const excludedVisitorHashes = config.requireObject<string[]>("excludedVisitorHashes");
for (const hash of excludedVisitorHashes) {
	assert(/^[a-f0-9]+$/.test(hash), `excludedVisitorHashes entries must be lowercase hex (got: ${hash})`);
}

function excludeVisitorHashesClause(): string[] {
	if (excludedVisitorHashes.length === 0) return [];
	const list = excludedVisitorHashes.map((h) => `"${h}"`).join(", ");
	return [`| filter (not ispresent(visitor_hash)) or (visitor_hash not in [${list}])`];
}

/**
 * HutchLambda names it a Lambda `{name}-handler`, which makes the CloudWatch
 * log group `/aws/lambda/{name}-handler`. Names below mirror the HutchLambda
 * resource names in `projects/save-link/src/infra/index.ts`.
 *
 * The `tier` is derived from each log group's source — it's not an attribute of
 * ParseErrorEvent (which stays at the generic parse-error abstraction, see
 * `src/packages/hutch-infra-components/src/logs.ts`). The dashboard infers the
 * tier by grouping widgets by handler log group and tagging the widget title.
 */
const SAVE_LINK_HANDLER_LOG_GROUPS = [
	{ logGroup: "/aws/lambda/save-link-command-handler", tier: "tier-1" },
	{ logGroup: "/aws/lambda/save-anonymous-link-command-handler", tier: "tier-1" },
	{ logGroup: "/aws/lambda/save-link-raw-html-command-handler", tier: "tier-0" },
] as const;

/**
 * Public View Entry Point widgets (appended to readplace-analytics below)
 *
 * Tracks the funnel into the public reader view (`/view`) for non-authenticated
 * users arriving from the homepage and the public landing.
 *
 * 1. Homepage paste-link click — utm_content=homepage-link-input
 *    (form on `/` redirects to /view/<url>, logged as path=/view, status=302)
 * 2. /view landing "Open in reader view" click — utm_content=open-in-reader-view
 *    (form on /view redirects to /view/<url>, logged as path=/view, status=302)
 * 3. /view article "Paste another link" click — utm_content=paste-another-link
 *    (link on /view/<url> goes back to /view, logged as path=/view, status=200)
 */
const PUBLIC_VIEW_ENTRY_POINTS = [
	{ id: "homepage-link-input", title: "Homepage \"Open in reader view\" click" },
	{ id: "open-in-reader-view", title: "/view landing \"Open in reader view\" click" },
	{ id: "paste-another-link", title: "/view \"Paste another link\" click" },
] as const;

const entryPointFilter = `| filter utm_content in [${PUBLIC_VIEW_ENTRY_POINTS.map((e) => `"${e.id}"`).join(", ")}]`;

new aws.cloudwatch.LogMetricFilter("imports-completed-filter", {
	name: "imports-completed",
	logGroupName: logGroup.name,
	pattern: '{ $.stream = "analytics" && $.event = "import_committed" }',
	metricTransformation: {
		name: "ImportsCompleted",
		namespace: "Readplace/Imports",
		value: "1",
		defaultValue: "0",
		unit: "Count",
	},
});

new aws.cloudwatch.Dashboard("readplace-analytics", {
	dashboardName: "readplace-analytics",
	dashboardBody: pulumi.output(logGroup.name).apply((hutchLogGroupName) =>
		JSON.stringify({
			widgets: [
				logWidget({
					title: "Pageviews by utm_source (%)",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, utm_source",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						...excludeVisitorHashesClause(),
						"| filter ispresent(utm_source) and utm_source != \"\"",
						"| stats count(*) as visits by utm_source",
						"| sort visits desc",
						"| limit 10",
					].join(" "),
					x: 0, y: 0, width: 12, height: 8,
					view: "pie",
				}),
				logWidget({
					title: "Top Referrers",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, referrer_host",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						...excludeVisitorHashesClause(),
						"| filter ispresent(referrer_host) and referrer_host != \"\"",
						"| stats count(*) as visits by referrer_host",
						"| sort visits desc",
						"| limit 10",
					].join(" "),
					x: 12, y: 0, width: 12, height: 8,
					view: "pie",
				}),
				{
					type: "metric",
					x: 0, y: 8, width: 6, height: 4,
					properties: {
						region,
						title: "Imports completed (lifetime)",
						metrics: [["Readplace/Imports", "ImportsCompleted", { stat: "Sum" }]],
						period: 86400,
						stat: "Sum",
						view: "singleValue",
						sparkline: true,
						setPeriodToTimeRange: true,
					},
				},
				logWidget({
					title: "Recent Analytics Events",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, path, utm_source, utm_medium, utm_campaign, utm_content, referrer_host, visitor_hash, is_authenticated",
						"| filter stream = \"analytics\"",
						...excludeVisitorHashesClause(),
						"| sort @timestamp desc",
						"| limit 50",
					].join(" "),
					x: 0, y: 12, width: 24, height: 8,
					view: "table",
				}),
				logWidget({
					title: "Pageviews by Source / Medium / Content (%)",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, utm_source, utm_medium, utm_content, concat(utm_source, \" / \", coalesce(utm_medium, \"-\"), \" / \", coalesce(utm_content, \"-\")) as utm_path",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						...excludeVisitorHashesClause(),
						"| filter ispresent(utm_source) and utm_source != \"\"",
						"| stats count(*) as visits by utm_path",
						"| sort visits desc",
						"| limit 10",
					].join(" "),
					x: 0, y: 20, width: 12, height: 8,
					view: "pie",
				}),
				logWidget({
					title: "Distinct Visitors per Day",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, visitor_hash",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						"| filter ispresent(visitor_hash)",
						...excludeVisitorHashesClause(),
						"| stats count_distinct(visitor_hash) as visitors by bin(1d)",
					].join(" "),
					x: 12, y: 20, width: 12, height: 8,
					view: "timeSeries",
				}),
				logWidget({
					title: "Distinct Authenticated Readers per Day",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, visitor_hash, path, is_authenticated",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						"| filter ispresent(visitor_hash)",
						...excludeVisitorHashesClause(),
						"| filter is_authenticated",
						"| filter path like /^\\/[^\\/]+\\/read$/",
						"| stats count_distinct(visitor_hash) as authenticated_unique_readers by bin(1d)",
					].join(" "),
					x: 0, y: 28, width: 12, height: 8,
					view: "timeSeries",
				}),
				logWidget({
					title: "Public View Entry Point — clicks per day",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, utm_content",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						"| filter path = \"/view\"",
						...excludeVisitorHashesClause(),
						entryPointFilter,
						"| stats count(*) as clicks by bin(1d), utm_content",
					].join(" "),
					x: 0, y: 36, width: 24, height: 8,
					view: "timeSeries",
				}),
				logWidget({
					title: "Public View Entry Point — by Source / Medium / Content (%)",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, utm_source, utm_medium, utm_content, concat(utm_source, \" / \", coalesce(utm_medium, \"-\"), \" / \", utm_content) as utm_path",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						"| filter path = \"/view\"",
						...excludeVisitorHashesClause(),
						entryPointFilter,
						"| stats count(*) as clicks by utm_path",
						"| sort clicks desc",
					].join(" "),
					x: 0, y: 44, width: 12, height: 8,
					view: "pie",
				}),
				logWidget({
					title: "Public View Entry Point — unique visitors per day",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, utm_content, visitor_hash",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						"| filter path = \"/view\"",
						"| filter ispresent(visitor_hash)",
						...excludeVisitorHashesClause(),
						entryPointFilter,
						"| stats count_distinct(visitor_hash) as unique_visitors by bin(1d), utm_content",
					].join(" "),
					x: 12, y: 44, width: 12, height: 8,
					view: "timeSeries",
				}),
				...PUBLIC_VIEW_ENTRY_POINTS.map((entry, i) =>
					logWidget({
						title: `Recent — ${entry.title}`,
						logGroupNames: [hutchLogGroupName],
						query: [
							"fields @timestamp, path, utm_source, utm_medium, utm_content, referrer_host, visitor_hash, is_authenticated",
							"| filter stream = \"analytics\" and event = \"pageview\"",
							"| filter path = \"/view\"",
							...excludeVisitorHashesClause(),
							`| filter utm_content = "${entry.id}"`,
							"| sort @timestamp desc",
							"| limit 50",
						].join(" "),
						x: 0, y: 52 + i * 8, width: 24, height: 8,
						view: "table",
					}),
				),
				/**
				 * Top Medium Posts by Clicks — counts inbound pageviews where the
				 * Medium `source=post_page-----<id>` parameter is present, grouped
				 * by post id. The middleware extracts the id into `medium_post_id`;
				 * this widget answers "which Medium post is sending readers to
				 * Readplace?" at per-post fidelity (utm_source only gives per-author).
				 * To resolve an id back to a post, open https://medium.com/p/<id>.
				 */
				logWidget({
					title: "Top Medium Posts by Clicks",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, medium_post_id",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						"| filter ispresent(medium_post_id) and medium_post_id != \"\"",
						...excludeVisitorHashesClause(),
						"| stats count(*) as clicks by medium_post_id",
						"| sort clicks desc",
						"| limit 10",
					].join(" "),
					x: 0, y: 76, width: 12, height: 8,
					view: "pie",
				}),
				/** Conversions — y=80; no excludeVisitorHashesClause() because conversion events carry no visitor_hash */
				logWidget({
					title: "Conversions by Source (unique users)",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, user_id, coalesce(utm_source, referrer_host, \"direct\") as source",
						"| filter stream = \"conversions\" and event = \"user_created\"",
						"| stats count_distinct(user_id) as unique_users by source",
						"| sort unique_users desc",
						"| limit 20",
					].join(" "),
					x: 0, y: 80, width: 12, height: 8,
					view: "pie",
				}),
				logWidget({
					title: "Conversions by Source × Tier (free vs paid)",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, user_id, coalesce(utm_source, referrer_host, \"direct\") as source, tier",
						"| filter stream = \"conversions\" and event = \"user_created\"",
						"| stats count_distinct(user_id) as unique_users by source, tier",
						"| sort unique_users desc",
						"| limit 30",
					].join(" "),
					x: 12, y: 80, width: 12, height: 8,
					view: "table",
				}),
				logWidget({
					title: "Recent Conversions",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, user_id, method, tier, utm_source, utm_medium, utm_campaign, utm_content, referrer_host, landing_path",
						"| filter stream = \"conversions\" and event = \"user_created\"",
						"| sort @timestamp desc",
						"| limit 50",
					].join(" "),
					x: 0, y: 88, width: 24, height: 8,
					view: "table",
				}),
			],
		}),
	),
});

new aws.cloudwatch.Dashboard("readplace-observability", {
	dashboardName: "readplace-observability",
	dashboardBody: pulumi.output(logGroup.name).apply((hutchLogGroupName) =>
		JSON.stringify({
			widgets: [
				logWidget({
					title: "Top /view URLs by Unique Visitors",
					logGroupNames: [hutchLogGroupName],
					query: [
						"fields @timestamp, path, visitor_hash",
						"| filter stream = \"analytics\" and event = \"pageview\"",
						"| filter ispresent(visitor_hash)",
						...excludeVisitorHashesClause(),
						"| filter path like /^\\/https?:\\//",
						"| stats count_distinct(visitor_hash) as unique_visitors, count(*) as total_hits by path",
						"| sort unique_visitors desc",
						"| limit 10",
					].join(" "),
					x: 0, y: 0, width: 24, height: 8,
					view: "table",
				}),
				...[
					{ logGroup: hutchLogGroupName, tier: "ingress / non-tier" },
					...SAVE_LINK_HANDLER_LOG_GROUPS,
				].map((entry, i) =>
					logWidget({
						title: `Parse Errors — ${entry.tier} — ${entry.logGroup}`,
						logGroupNames: [entry.logGroup],
						query: [
							"fields @timestamp, url, reason, source",
							`| filter stream = "${PARSE_ERROR_STREAM}"`,
							"| sort @timestamp desc",
							"| limit 100",
						].join(" "),
						x: 0, y: 8 + i * 8, width: 24, height: 8,
						view: "table",
					}),
				),
				...SAVE_LINK_HANDLER_LOG_GROUPS.map(({ logGroup }, i) =>
					logWidget({
						title: `Crawl Outcomes — ${logGroup}`,
						logGroupNames: [logGroup],
						query: [
							"fields @timestamp, url, thisTier, thisTierStatus, otherTierStatus, pickedTier",
							`| filter stream = "${CRAWL_OUTCOME_STREAM}"`,
							"| sort @timestamp desc",
							"| limit 100",
						].join(" "),
						x: 0,
						y: 8 + (1 + SAVE_LINK_HANDLER_LOG_GROUPS.length + i) * 8,
						width: 24,
						height: 8,
						view: "table",
					}),
				),
			],
		}),
	),
});

// --- Exports ---

export const apiUrl: pulumi.Input<string> = canonicalDomain ? `https://${canonicalDomain}` : gateway.apiUrl;
export const functionName = lambda.functionName;
export const staticBaseUrl = staticAssets.baseUrl;
export const exportUserDataQueueUrl = exportUserDataQueue.queueUrl;
export const exportUserDataDlqUrl = exportUserDataQueue.dlqUrl;
export const userExportBucketOutputName = userExportBucket.bucket;
export const _dependencies = [gateway.defaultRoute];
