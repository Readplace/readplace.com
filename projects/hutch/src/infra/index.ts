import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import assert from "node:assert";
import { resolve } from "node:path";
import { curlImpersonateLayerArnFromPlatformStack, HutchLambda, HutchAPIGateway, HutchDynamoDBAccess, HutchEventBus, HutchS3ReadWrite, HutchSQS, HutchSQSBackedLambda, HutchStripeWebhookReceiver } from "@packages/hutch-infra-components/infra";
import {
	FORWARD_ANALYTICS_LAMBDA_NAME,
	CancelSubscriptionCommand,
	DeleteAccountCommand,
	ExportUserDataCommand,
	SendTrialFeedbackEmailCommand,
	ReaderViewLoadingSucceeded,
	SubscriptionCancellationScheduledEvent,
	SubscriptionCancelledEvent,
	SubscriptionChargeFailedEvent,
	SubscriptionChargeSucceededEvent,
	SubscriptionStartRequestCommand,
} from "@packages/hutch-infra-components";
import { EXPORT_DOWNLOAD_TTL_DAYS, EXPORT_S3_KEY_PREFIX } from "../runtime/web/pages/export/export-ttl";
import { ANALYTICS_EVENTS, ANALYTICS_LOG_GROUP, ERRORS_LOG_GROUP, ERRORS_LOG_GROUP_RETENTION_DAYS, LAMBDA_NAMES, METRICS, STREAMS } from "../runtime/observability/events";
import { buildAnalyticsDashboardBody } from "../runtime/observability/analytics-dashboard";
import { parseStripeWebhookSecret } from "../runtime/stripe-webhook-receiver/stripe-webhook-secret";
import { DomainRegistration } from "./domain-registration";
import { DomainRedirect } from "./domain-redirect";
import { AgentDiscoveryDns } from "./agent-discovery-dns";
import { HutchStorage } from "./hutch-storage";
import { HutchStaticAssets } from "./hutch-static-assets";
import { OutboundMailAuth } from "./outbound-mail-auth";
import { requireEnv } from "@packages/require-env";

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
const pendingPdfBucketName = config.require("pendingPdfBucketName");
const userExportBucketName = config.require("userExportBucketName");
const inboxAddressDomain = config.require("inboxAddressDomain");
const alertEmail = config.require("alertEmail");
const rawEmailBucketName = config.require("rawEmailBucketName");

// The inbox stack owns the inbox tables and the SES receiving pipeline. hutch
// keeps only the access its own workers still need — the forwarding-address page
// and the account-deletion sweep — and names those tables by ARN derived from
// account + region, so neither stack waits on the other to deploy.
const inboxAwsRegion = new pulumi.Config("aws").require("region");
const inboxAwsAccountId = pulumi.output(aws.getCallerIdentity({})).accountId;
function inboxTableArn(tableName: string): pulumi.Output<string> {
	return pulumi.interpolate`arn:aws:dynamodb:${inboxAwsRegion}:${inboxAwsAccountId}:table/${tableName}`;
}

const tableNames = {
	articles: config.require("dynamodbArticlesTable"),
	userArticles: config.require("dynamodbUserArticlesTable"),
	users: config.require("dynamodbUsersTable"),
	readerReadyNotifications: config.require("dynamodbReaderReadyNotificationsTable"),
	sessions: config.require("dynamodbSessionsTable"),
	oauth: config.require("dynamodbOauthTable"),
	verificationTokens: config.require("dynamodbVerificationTokensTable"),
	passwordResetTokens: config.require("dynamodbPasswordResetTokensTable"),
	pendingSignups: config.require("dynamodbPendingSignupsTable"),
	importSessions: config.require("dynamodbImportSessionsTable"),
	inboxAddresses: config.require("dynamodbInboxAddressesTable"),
	inboxEmails: config.require("dynamodbInboxEmailsTable"),
	inboxEmailLinks: config.require("dynamodbInboxEmailLinksTable"),
	inboxSavedLinks: config.require("dynamodbInboxSavedLinksTable"),
	subscriptionProviders: config.require("dynamodbSubscriptionProvidersTable"),
	onboarding: config.require("dynamodbOnboardingTable"),
	readingPreferences: config.require("dynamodbReadingPreferencesTable"),
	rateLimits: config.require("dynamodbRateLimitsTable"),
	digestQueue: config.require("dynamodbDigestQueueTable"),
};

/* Per-stack "<limit>/<windowSeconds>" rules so staging e2e (one CI egress IP
 * driving the whole suite) can run with liberal limits while prod stays
 * strict. Parsed and enforced by the runtime's DynamoDB-backed limiter. */
const rateLimitRules = {
	viewCrawl: config.require("rateLimitViewCrawl"),
	login: config.require("rateLimitLogin"),
	loginAccount: config.require("rateLimitLoginAccount"),
	signup: config.require("rateLimitSignup"),
	forgotPassword: config.require("rateLimitForgotPassword"),
	oauthRegister: config.require("rateLimitOauthRegister"),
	oauthToken: config.require("rateLimitOauthToken"),
	import: config.require("rateLimitImport"),
	importFromUrl: config.require("rateLimitImportFromUrl"),
};

/* Blunt TOTAL-rate ceiling (all clients combined) applied by API Gateway before
 * the Lambda runs — per-stack so staging, whose e2e suite drives the whole run
 * from one CI egress IP, can lift the ceiling without a code change while prod
 * stays tight. Per-IP fairness is the application limiter's job. */
const apiThrottle = {
	burstLimit: config.requireNumber("apiThrottleBurstLimit"),
	rateLimit: config.requireNumber("apiThrottleRateLimit"),
};

const storage = new HutchStorage("hutch", {
	deletionProtection,
	tableNames,
});

const redirectDomains = config.getObject<string[]>("redirectDomains") ?? [];
const redirectSubdomains = config.getObject<Array<{ host: string; zoneName: string }>>("redirectSubdomains") ?? [];

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

/** DNS for AI Discovery (DNS-AID) records + DNSSEC on the canonical zone — the
 * user-facing origin agents resolve and the registrar holds the DS for — not the
 * legacy domain. Hand `agentDnsDsRecord` to the canonical domain's registrar to
 * complete the DNSSEC chain of trust. */
const canonicalDomainRegistration =
	allDomainRegistrations[allDomainRegistrations.length - 1];
const agentDiscoveryDns =
	canonicalDomain && canonicalDomainRegistration?.zoneId
		? new AgentDiscoveryDns("hutch-agent-dns", {
				domain: canonicalDomain,
				zoneId: canonicalDomainRegistration.zoneId,
			})
		: undefined;

export const agentDnsDsRecord = agentDiscoveryDns?.dsRecord;

if (redirectDomains.length > 0 || redirectSubdomains.length > 0) {
	assert(canonicalDomain, "redirectDomains requires domains to be configured");
	new DomainRedirect("hutch-redirect", {
		redirectDomains,
		redirectSubdomains,
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

// The web Lambda builds initCrawlFetch (article/thumbnail crawls, stale-check
// refresh), whose last-resort leg spawns curl_chrome131 from this layer; without
// it a crawl that falls through to curl dies on `spawn curl_chrome131 ENOENT`.
const curlImpersonateLayerArn = curlImpersonateLayerArnFromPlatformStack(config);

const dynamodb = new HutchDynamoDBAccess("hutch-dynamodb-access", {
	tables: [
		{ arn: storage.articlesTable.arn, includeIndexes: true },
		{ arn: storage.userArticlesTable.arn, includeIndexes: true },
		{ arn: storage.usersTable.arn, includeIndexes: true },
		{ arn: storage.sessionsTable.arn, includeIndexes: true },
		{ arn: storage.oauthTable.arn, includeIndexes: true },
		{ arn: storage.verificationTokensTable.arn, includeIndexes: false },
		{ arn: storage.passwordResetTokensTable.arn, includeIndexes: false },
		{ arn: storage.pendingSignupsTable.arn, includeIndexes: false },
		{ arn: storage.importSessionsTable.arn, includeIndexes: false },
		{ arn: inboxTableArn(tableNames.inboxAddresses), includeIndexes: true },
		{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: true },
		{ arn: storage.onboardingTable.arn, includeIndexes: false },
		{ arn: storage.readingPreferencesTable.arn, includeIndexes: false },
		{ arn: storage.rateLimitsTable.arn, includeIndexes: false },
	],
	actions: [
		"dynamodb:GetItem",
		"dynamodb:BatchGetItem",
		"dynamodb:PutItem",
		"dynamodb:UpdateItem",
		"dynamodb:DeleteItem",
		"dynamodb:Query",
	],
});

const webUsersScan = new HutchDynamoDBAccess("hutch-web-users-scan", {
	tables: [{ arn: storage.usersTable.arn, includeIndexes: false }],
	actions: ["dynamodb:Scan"],
});

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

const subscriptionEventsSchedulerManagePolicy = {
	name: "hutch-subscription-events-scheduler-manage",
	policy: trialSchedulerManagePolicyDoc,
};

const userDataJobsSchedulerManagePolicy = {
	name: "hutch-user-data-jobs-scheduler-manage",
	policy: trialSchedulerManagePolicyDoc,
};

const lambda = new HutchLambda(LAMBDA_NAMES.hutchHandler, {
	priorLogGroupLogicalName: "hutch-log-analytics",
	entryPoint: "./src/runtime/lambda.main.ts",
	outputDir: ".lib/hutch-api",
	assetDir: "./src/runtime",
	memorySize: 1769,
	timeout: 30,
	layers: [curlImpersonateLayerArn],
	environment: {
		NODE_ENV: config.require("nodeEnv"),
		PERSISTENCE: "prod",
		/** The app reads PORT at module load via requireEnv, which has no default,
		 * so it must be present even though serverless-http does not bind a port. */
		PORT: "3000",
		APP_ORIGIN: appOrigin,
		/** Same-origin fragment endpoint served by blog-site behind this same API
		 * Gateway (/blog/{proxy+} routes there). The banner source is cached and
		 * fail-open, so the extra gateway hop is fine for a decorative banner. */
		CHANGELOG_BANNER_URL: pulumi.interpolate`${appOrigin}/blog/changelog-banner`,
		DYNAMODB_ARTICLES_TABLE: storage.articlesTable.name,
		DYNAMODB_USER_ARTICLES_TABLE: storage.userArticlesTable.name,
		DYNAMODB_USERS_TABLE: storage.usersTable.name,
		DYNAMODB_SESSIONS_TABLE: storage.sessionsTable.name,
		DYNAMODB_OAUTH_TABLE: storage.oauthTable.name,
		DYNAMODB_VERIFICATION_TOKENS_TABLE: storage.verificationTokensTable.name,
		DYNAMODB_PASSWORD_RESET_TOKENS_TABLE: storage.passwordResetTokensTable.name,
		DYNAMODB_PENDING_SIGNUPS_TABLE: storage.pendingSignupsTable.name,
		DYNAMODB_IMPORT_SESSIONS_TABLE: storage.importSessionsTable.name,
		DYNAMODB_INBOX_ADDRESSES_TABLE: tableNames.inboxAddresses,
		INBOX_ADDRESS_DOMAIN: inboxAddressDomain,
		DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: storage.subscriptionProvidersTable.name,
		DYNAMODB_ONBOARDING_TABLE: storage.onboardingTable.name,
		DYNAMODB_READING_PREFERENCES_TABLE: storage.readingPreferencesTable.name,
		DYNAMODB_RATE_LIMITS_TABLE: storage.rateLimitsTable.name,
		RATE_LIMIT_VIEW_CRAWL: rateLimitRules.viewCrawl,
		RATE_LIMIT_LOGIN: rateLimitRules.login,
		RATE_LIMIT_LOGIN_ACCOUNT: rateLimitRules.loginAccount,
		RATE_LIMIT_SIGNUP: rateLimitRules.signup,
		RATE_LIMIT_FORGOT_PASSWORD: rateLimitRules.forgotPassword,
		RATE_LIMIT_OAUTH_REGISTER: rateLimitRules.oauthRegister,
		RATE_LIMIT_OAUTH_TOKEN: rateLimitRules.oauthToken,
		RATE_LIMIT_IMPORT: rateLimitRules.import,
		RATE_LIMIT_IMPORT_FROM_URL: rateLimitRules.importFromUrl,
		GOOGLE_LOGIN_CLIENT_ID: requireEnv("GOOGLE_LOGIN_CLIENT_ID"),
		GOOGLE_LOGIN_CLIENT_SECRET: requireEnv("GOOGLE_LOGIN_CLIENT_SECRET"),
		APPLE_LOGIN_CLIENT_ID: requireEnv("APPLE_LOGIN_CLIENT_ID"),
		APPLE_LOGIN_TEAM_ID: requireEnv("APPLE_LOGIN_TEAM_ID"),
		APPLE_LOGIN_KEY_ID: requireEnv("APPLE_LOGIN_KEY_ID"),
		APPLE_LOGIN_PRIVATE_KEY_BASE64: requireEnv("APPLE_LOGIN_PRIVATE_KEY_BASE64"),
		RESEND_API_KEY: requireEnv("RESEND_API_KEY"),
		STRIPE_SECRET_KEY: requireEnv("STRIPE_SECRET_KEY"),
		STRIPE_PRICE_ID: requireEnv("STRIPE_PRICE_ID"),
		STRIPE_PUBLISHABLE_KEY: requireEnv("STRIPE_PUBLISHABLE_KEY"),
		STATIC_BASE_URL: staticAssets.baseUrl,
		EVENT_BUS_NAME: eventBus.eventBusName,
		EVENT_BUS_ARN: eventBus.eventBusArn,
		CONTENT_BUCKET_NAME: contentBucketName,
		PENDING_HTML_BUCKET_NAME: pendingHtmlBucketName,
		PENDING_PDF_BUCKET_NAME: pendingPdfBucketName,
		ANALYTICS_SALT: requireEnv("ANALYTICS_SALT"),
		ADMIN_EMAILS: requireEnv("ADMIN_EMAILS"),
		RECRAWL_SERVICE_TOKEN: requireEnv("RECRAWL_SERVICE_TOKEN"),
		TRIAL_SCHEDULER_GROUP_NAME: trialSchedulerGroup.name,
		TRIAL_SCHEDULER_ROLE_ARN: trialSchedulerRole.arn,
		FOUNDING_MEMBER_LIMIT: config.require("foundingMemberLimit"),
	},
	policies: [
		...dynamodb.policies,
		...webUsersScan.policies,
		...HutchS3ReadWrite.readPoliciesForBucket("hutch-content-s3", contentBucketName),
		...HutchS3ReadWrite.writePoliciesForBucket("hutch-pending-html", pendingHtmlBucketName),
		...HutchS3ReadWrite.writePoliciesForBucket("hutch-pending-pdf", pendingPdfBucketName),
		// Read access so the save-content completion step can HeadObject (size +
		// mtime) and GetObject the %PDF- magic prefix of a client-uploaded object.
		...HutchS3ReadWrite.readPoliciesForBucket("hutch-pending-html-read", pendingHtmlBucketName),
		...HutchS3ReadWrite.readPoliciesForBucket("hutch-pending-pdf-read", pendingPdfBucketName),
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
	throttling: apiThrottle,
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
// same cadence as the presigned URL TTL — both numbers move together via a
// shared constant.

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

// --- Outbound email auth for Google Workspace (Gmail) human mail ---
// Publishes the apex SPF + Workspace DKIM so replies sent from Gmail to Sign in
// with Apple `@privaterelay.appleid.com` addresses pass Apple's relay checks.
// Only stacks whose mail runs on Google Workspace set `googleWorkspaceMail`;
// staging (SES-only) omits it and skips this entirely.
const googleWorkspaceMail = config.getObject<{
	domain: string;
	apexTxt: string[];
	dkimRecord?: string;
}>("googleWorkspaceMail");
if (googleWorkspaceMail) {
	new OutboundMailAuth("outbound-mail-auth", {
		mailDomain: googleWorkspaceMail.domain,
		apexTxt: googleWorkspaceMail.apexTxt,
		googleDkimRecord: googleWorkspaceMail.dkimRecord,
	});
}

// --- User data jobs worker Lambda (export + account deletion) ---
// Durable, DLQ-backed export of a user's data and scrub of every user-owned
// store. Runs behind SQS at-least-once with an email alert on the DLQ so a
// stuck erasure is never silent.

const userDataJobsDynamodb = new HutchDynamoDBAccess("user-data-jobs-dynamodb", {
	tables: [
		{ arn: storage.usersTable.arn, includeIndexes: true },
		{ arn: storage.sessionsTable.arn, includeIndexes: true },
		{ arn: storage.oauthTable.arn, includeIndexes: true },
		// Global article rows: read original URLs, count other savers, tombstone
		// a single-saver URL after purging its content.
		{ arn: storage.articlesTable.arn, includeIndexes: false },
		{ arn: storage.userArticlesTable.arn, includeIndexes: true },
		{ arn: storage.digestQueueTable.arn, includeIndexes: false },
		{ arn: storage.readerReadyNotificationsTable.arn, includeIndexes: false },
		{ arn: storage.onboardingTable.arn, includeIndexes: false },
		{ arn: storage.readingPreferencesTable.arn, includeIndexes: false },
		{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: false },
		{ arn: inboxTableArn(tableNames.inboxEmails), includeIndexes: false },
		{ arn: inboxTableArn(tableNames.inboxEmailLinks), includeIndexes: false },
		{ arn: inboxTableArn(tableNames.inboxSavedLinks), includeIndexes: false },
		{ arn: inboxTableArn(tableNames.inboxAddresses), includeIndexes: true },
		{ arn: storage.passwordResetTokensTable.arn, includeIndexes: false },
		{ arn: storage.verificationTokensTable.arn, includeIndexes: false },
		{ arn: storage.pendingSignupsTable.arn, includeIndexes: false },
	],
	actions: [
		"dynamodb:GetItem",
		"dynamodb:BatchGetItem",
		"dynamodb:Query",
		"dynamodb:Scan",
		"dynamodb:DeleteItem",
		"dynamodb:UpdateItem",
		"dynamodb:TransactWriteItems",
	],
});

// The write-policy helpers grant only PutObject, so a delete worker needs an
// explicit s3:DeleteObject grant (+ ListBucket for the export-prefix listing).
const userDataJobsS3Policy = {
	name: "user-data-jobs-s3-delete",
	policy: JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Action: ["s3:DeleteObject"],
				Resource: [
					`arn:aws:s3:::${rawEmailBucketName}/*`,
					`arn:aws:s3:::${contentBucketName}/*`,
					`arn:aws:s3:::${userExportBucketName}/*`,
				],
			},
			{
				Effect: "Allow",
				Action: ["s3:ListBucket"],
				Resource: [
					`arn:aws:s3:::${rawEmailBucketName}`,
					`arn:aws:s3:::${contentBucketName}`,
					`arn:aws:s3:::${userExportBucketName}`,
				],
			},
		],
	}),
};

const userDataJobsQueue = new HutchSQS("user-data-jobs", {
	// Matches the worker Lambda timeout so a single in-flight job cannot be
	// redelivered while still running.
	visibilityTimeoutSeconds: 900,
	// The scrub converges on partial state by design, and its Apple-revocation
	// step fails closed on an Apple outage — 12 receives ≈ 3 hours of retries
	// so a losable deletion only falls to the DLQ (email-alarmed) after riding
	// out a real outage, not after the default 3 attempts.
	dlqMaxReceiveCount: 12,
});

const userDataJobsLambda = new HutchLambda("user-data-jobs", {
	entryPoint: "./src/runtime/user-data-jobs.main.ts",
	outputDir: ".lib/user-data-jobs",
	assetDir: "./src/runtime",
	memorySize: 1024,
	timeout: 900,
	environment: {
		DYNAMODB_USERS_TABLE: storage.usersTable.name,
		DYNAMODB_SESSIONS_TABLE: storage.sessionsTable.name,
		DYNAMODB_OAUTH_TABLE: storage.oauthTable.name,
		DYNAMODB_ARTICLES_TABLE: storage.articlesTable.name,
		DYNAMODB_USER_ARTICLES_TABLE: storage.userArticlesTable.name,
		DYNAMODB_DIGEST_QUEUE_TABLE: storage.digestQueueTable.name,
		DYNAMODB_READER_READY_NOTIFICATIONS_TABLE: storage.readerReadyNotificationsTable.name,
		DYNAMODB_ONBOARDING_TABLE: storage.onboardingTable.name,
		DYNAMODB_READING_PREFERENCES_TABLE: storage.readingPreferencesTable.name,
		DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: storage.subscriptionProvidersTable.name,
		DYNAMODB_INBOX_EMAILS_TABLE: tableNames.inboxEmails,
		DYNAMODB_INBOX_EMAIL_LINKS_TABLE: tableNames.inboxEmailLinks,
		DYNAMODB_INBOX_SAVED_LINKS_TABLE: tableNames.inboxSavedLinks,
		DYNAMODB_INBOX_ADDRESSES_TABLE: tableNames.inboxAddresses,
		DYNAMODB_PASSWORD_RESET_TOKENS_TABLE: storage.passwordResetTokensTable.name,
		DYNAMODB_VERIFICATION_TOKENS_TABLE: storage.verificationTokensTable.name,
		DYNAMODB_PENDING_SIGNUPS_TABLE: storage.pendingSignupsTable.name,
		RAW_EMAIL_BUCKET_NAME: rawEmailBucketName,
		CONTENT_BUCKET_NAME: contentBucketName,
		USER_EXPORT_BUCKET_NAME: userExportBucketName,
		STRIPE_SECRET_KEY: requireEnv("STRIPE_SECRET_KEY"),
		APPLE_LOGIN_CLIENT_ID: requireEnv("APPLE_LOGIN_CLIENT_ID"),
		APPLE_LOGIN_TEAM_ID: requireEnv("APPLE_LOGIN_TEAM_ID"),
		APPLE_LOGIN_KEY_ID: requireEnv("APPLE_LOGIN_KEY_ID"),
		APPLE_LOGIN_PRIVATE_KEY_BASE64: requireEnv("APPLE_LOGIN_PRIVATE_KEY_BASE64"),
		EVENT_BUS_NAME: eventBus.eventBusName,
		EVENT_BUS_ARN: eventBus.eventBusArn,
		TRIAL_SCHEDULER_GROUP_NAME: trialSchedulerGroupName,
		TRIAL_SCHEDULER_ROLE_ARN: trialSchedulerRole.arn,
		RESEND_API_KEY: requireEnv("RESEND_API_KEY"),
	},
	policies: [
		...userDataJobsDynamodb.policies,
		userDataJobsS3Policy,
		...userExportBucket.readPolicies("user-data-jobs-bucket-read"),
		...userExportBucket.writePolicies("user-data-jobs-bucket-write"),
		userDataJobsSchedulerManagePolicy,
	],
});

eventBus.grantPublish(userDataJobsLambda);

const userDataJobsWithSQS = new HutchSQSBackedLambda("user-data-jobs", {
	lambda: userDataJobsLambda,
	queue: userDataJobsQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribeAll(
	[DeleteAccountCommand, ExportUserDataCommand],
	userDataJobsWithSQS,
	{ name: "user-data-jobs" },
);

// --- Reader-ready digest (fan-out + 6h flush + send) ---
// When an article's clean reader view reaches the successful terminal state,
// save-link publishes ReaderViewLoadingSucceeded (per-URL, global). The fan-out
// Lambda reverse-looks-up every saver via the user-articles url-index and — for
// savers who had opened the reader — appends the article to that user's digest
// queue. A recurring
// rate(6 hours) schedule fans the sparse queue into one SendUserDigestCommand
// per pending user; the send Lambda re-checks every per-article gate against the
// live row, claims the per-user cooldown, and emails a single digest.

// send-user-digest queue is created first so digest-scan can address it.
const sendUserDigestQueue = new HutchSQS("send-user-digest", {
	visibilityTimeoutSeconds: 120,
});

const sendUserDigestDynamodb = new HutchDynamoDBAccess("send-user-digest-dynamodb", {
	tables: [
		{ arn: storage.articlesTable.arn, includeIndexes: false },
		{ arn: storage.userArticlesTable.arn, includeIndexes: false },
		// users table is read-only here: Query the userId-index to resolve the
		// saver's verified contact email.
		{ arn: storage.usersTable.arn, includeIndexes: true },
		// reader-ready-notifications carries the per-user digest cooldown, claimed
		// by a direct PK conditional UpdateItem.
		{ arn: storage.readerReadyNotificationsTable.arn, includeIndexes: false },
		// digest queue: Query one user's items, DeleteItem on send/drain.
		{ arn: storage.digestQueueTable.arn, includeIndexes: false },
	],
	actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:DeleteItem"],
});

const sendUserDigestLambda = new HutchLambda("send-user-digest", {
	entryPoint: "./src/runtime/send-user-digest.main.ts",
	outputDir: ".lib/send-user-digest",
	assetDir: "./src/runtime",
	memorySize: 512,
	timeout: 60,
	environment: {
		APP_ORIGIN: appOrigin,
		RESEND_API_KEY: requireEnv("RESEND_API_KEY"),
		DYNAMODB_ARTICLES_TABLE: storage.articlesTable.name,
		DYNAMODB_USER_ARTICLES_TABLE: storage.userArticlesTable.name,
		DYNAMODB_USERS_TABLE: storage.usersTable.name,
		DYNAMODB_SESSIONS_TABLE: storage.sessionsTable.name,
		DYNAMODB_READER_READY_NOTIFICATIONS_TABLE: storage.readerReadyNotificationsTable.name,
		DYNAMODB_DIGEST_QUEUE_TABLE: storage.digestQueueTable.name,
		EVENT_BUS_NAME: eventBus.eventBusName,
	},
	policies: [...sendUserDigestDynamodb.policies],
});

eventBus.grantPublish(sendUserDigestLambda);

// Direct-SQS source (digest-scan dispatches SendUserDigestCommand here) — no
// eventBus.subscribe. Bare statement for its EventSourceMapping + DLQ alarm.
new HutchSQSBackedLambda("send-user-digest", {
	lambda: sendUserDigestLambda,
	queue: sendUserDigestQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

// digest-scan: driven by the recurring schedule; scans the sparse queue and
// dispatches one SendUserDigestCommand per pending user.
const digestScanQueue = new HutchSQS("digest-scan", {
	visibilityTimeoutSeconds: 120,
});

const digestScanDynamodb = new HutchDynamoDBAccess("digest-scan-dynamodb", {
	tables: [{ arn: storage.digestQueueTable.arn, includeIndexes: false }],
	actions: ["dynamodb:Scan"],
});

const digestScanLambda = new HutchLambda("digest-scan", {
	entryPoint: "./src/runtime/digest-scan.main.ts",
	outputDir: ".lib/digest-scan",
	assetDir: "./src/runtime",
	memorySize: 512,
	timeout: 60,
	environment: {
		DYNAMODB_DIGEST_QUEUE_TABLE: storage.digestQueueTable.name,
		SEND_USER_DIGEST_QUEUE_URL: sendUserDigestQueue.queueUrl,
	},
	policies: [
		...digestScanDynamodb.policies,
		// SendMessage on the send-user-digest queue to dispatch the per-user commands.
		...sendUserDigestQueue.policies,
	],
});

new HutchSQSBackedLambda("digest-scan", {
	lambda: digestScanLambda,
	queue: digestScanQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

// Recurring 6h flush: EventBridge Scheduler puts a trigger message on the
// digest-scan queue. A dedicated execution role lets the scheduler service
// SendMessage to that one queue.
const digestSchedulerRole = new aws.iam.Role("hutch-digest-scheduler-role", {
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

new aws.iam.RolePolicy("hutch-digest-scheduler-role-policy", {
	role: digestSchedulerRole.id,
	policy: digestScanQueue.queueArn.apply((arn) =>
		JSON.stringify({
			Version: "2012-10-17",
			Statement: [
				{
					Effect: "Allow",
					Action: ["sqs:SendMessage"],
					Resource: arn,
				},
			],
		}),
	),
});

new aws.scheduler.Schedule("hutch-digest-flush", {
	scheduleExpression: "rate(6 hours)",
	flexibleTimeWindow: { mode: "OFF" },
	state: "ENABLED",
	target: {
		arn: digestScanQueue.queueArn,
		roleArn: digestSchedulerRole.arn,
		input: JSON.stringify({ trigger: "digest-flush" }),
	},
});

// --- Reader-ready fan-out ---
const readerReadyFanoutQueue = new HutchSQS("reader-ready-fanout", {
	visibilityTimeoutSeconds: 120,
});

const readerReadyFanoutDynamodb = new HutchDynamoDBAccess("reader-ready-fanout-dynamodb", {
	// Query the url-index (includeIndexes) to reverse-look-up every saver. Read-only:
	// the fan-out records nothing on the per-user row.
	tables: [{ arn: storage.userArticlesTable.arn, includeIndexes: true }],
	actions: ["dynamodb:Query"],
});

const readerReadyFanoutDigestDynamodb = new HutchDynamoDBAccess("reader-ready-fanout-digest-dynamodb", {
	// Append eligible savers' articles to the digest queue.
	tables: [{ arn: storage.digestQueueTable.arn, includeIndexes: false }],
	actions: ["dynamodb:PutItem"],
});

const readerReadyFanoutLambda = new HutchLambda("reader-ready-fanout", {
	entryPoint: "./src/runtime/reader-ready-fanout.main.ts",
	outputDir: ".lib/reader-ready-fanout",
	assetDir: "./src/runtime",
	memorySize: 512,
	timeout: 60,
	environment: {
		DYNAMODB_ARTICLES_TABLE: storage.articlesTable.name,
		DYNAMODB_USER_ARTICLES_TABLE: storage.userArticlesTable.name,
		DYNAMODB_DIGEST_QUEUE_TABLE: storage.digestQueueTable.name,
	},
	policies: [
		...readerReadyFanoutDynamodb.policies,
		...readerReadyFanoutDigestDynamodb.policies,
	],
});

const readerReadyFanoutWithSQS = new HutchSQSBackedLambda("reader-ready-fanout", {
	lambda: readerReadyFanoutLambda,
	queue: readerReadyFanoutQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(ReaderViewLoadingSucceeded, readerReadyFanoutWithSQS);

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
	webhookSecret: parseStripeWebhookSecret(requireEnv("STRIPE_WEBHOOK_SECRET")),
	events: ["customer.subscription.deleted", "invoice.payment_failed"],
	alertEmail,
});

// --- Subscription lifecycle worker Lambda ---
// One SQS-backed Lambda for the whole subscription/billing state machine; the
// handler routes each record on its EventBridge `detail-type`. Failed records
// land in a DLQ with an email alarm so operators can redrive without relying on
// Stripe retries.

const subscriptionEventsDynamodb = new HutchDynamoDBAccess("subscription-events-dynamodb", {
	tables: [
		{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: false },
	],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const subscriptionEventsQueue = new HutchSQS("subscription-events", {
	visibilityTimeoutSeconds: 30,
});

const subscriptionEventsLambda = new HutchLambda(LAMBDA_NAMES.subscriptionEvents, {
	entryPoint: "./src/runtime/subscription-events.main.ts",
	outputDir: ".lib/subscription-events",
	assetDir: "./src/runtime",
	memorySize: 128,
	timeout: 30,
	environment: {
		DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: storage.subscriptionProvidersTable.name,
		STRIPE_SECRET_KEY: requireEnv("STRIPE_SECRET_KEY"),
		STRIPE_PRICE_ID: requireEnv("STRIPE_PRICE_ID"),
		EVENT_BUS_NAME: eventBus.eventBusName,
		EVENT_BUS_ARN: eventBus.eventBusArn,
		TRIAL_SCHEDULER_GROUP_NAME: trialSchedulerGroup.name,
		TRIAL_SCHEDULER_ROLE_ARN: trialSchedulerRole.arn,
	},
	policies: [
		...subscriptionEventsDynamodb.policies,
		// Manage policy = create + delete. The cancel branches CreateSchedule for
		// the deferred-cancellation timer and DeleteSchedule the trial-end one;
		// the trial-cancel branch creates the feedback-email one-shot.
		subscriptionEventsSchedulerManagePolicy,
	],
});

eventBus.grantPublish(subscriptionEventsLambda);

const subscriptionEventsWithSQS = new HutchSQSBackedLambda("subscription-events", {
	lambda: subscriptionEventsLambda,
	queue: subscriptionEventsQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribeAll(
	[
		CancelSubscriptionCommand,
		SubscriptionCancellationScheduledEvent,
		SubscriptionCancelledEvent,
		SubscriptionChargeFailedEvent,
		SubscriptionChargeSucceededEvent,
		SubscriptionStartRequestCommand,
	],
	subscriptionEventsWithSQS,
	{ name: "subscription-events" },
);

// --- Send Trial Feedback Email ---
// SQS-backed Lambda invoked by the EventBridge Scheduler one-shots and the
// stripe-webhook-receiver, all targeting SendTrialFeedbackEmailCommand. It
// handles the email kinds keyed on the event detail's `kind`: the
// post-cancellation "what was missing?" feedback email (absent/'feedback' —
// re-reads the row to confirm the user is still cancelled and hasn't already
// been emailed), the pre-expiry trial reminder (kind='reminder' — created at
// trial signup, re-checks the user is still trialing with a future
// trialEndsAt), the pre-charge notice for trial-preserving checkouts
// (kind='charge_reminder' — created at checkout success, re-checks the user
// is still active with the chargeAt still ahead), and the fix-your-card
// dunning email (kind='payment_failed' — published per failed Stripe dunning
// attempt, re-checks the user is still active).

const sendTrialFeedbackEmailDynamodb = new HutchDynamoDBAccess(
	"send-trial-feedback-email-dynamodb",
	{
		tables: [
			{ arn: storage.subscriptionProvidersTable.arn, includeIndexes: false },
			{ arn: storage.usersTable.arn, includeIndexes: true },
			{ arn: storage.articlesTable.arn, includeIndexes: false },
			{ arn: storage.userArticlesTable.arn, includeIndexes: true },
		],
		actions: [
			"dynamodb:GetItem",
			"dynamodb:BatchGetItem",
			"dynamodb:Query",
			"dynamodb:UpdateItem",
		],
	},
);

const sendTrialFeedbackEmailQueue = new HutchSQS("send-trial-feedback-email", {
	visibilityTimeoutSeconds: 60,
});

const sendTrialFeedbackEmailLambda = new HutchLambda(
	LAMBDA_NAMES.sendTrialFeedbackEmail,
	{
		priorLogGroupLogicalName: "send-trial-feedback-email-log-group",
		entryPoint: "./src/runtime/send-trial-feedback-email.main.ts",
		outputDir: ".lib/send-trial-feedback-email",
		assetDir: "./src/runtime",
		memorySize: 256,
		timeout: 60,
		environment: {
			DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE: storage.subscriptionProvidersTable.name,
			DYNAMODB_USERS_TABLE: storage.usersTable.name,
			DYNAMODB_SESSIONS_TABLE: storage.sessionsTable.name,
			DYNAMODB_ARTICLES_TABLE: storage.articlesTable.name,
			DYNAMODB_USER_ARTICLES_TABLE: storage.userArticlesTable.name,
			RESEND_API_KEY: requireEnv("RESEND_API_KEY"),
			STATIC_BASE_URL: staticAssets.baseUrl,
			APP_ORIGIN: appOrigin,
		},
		policies: [...sendTrialFeedbackEmailDynamodb.policies],
	},
);

const sendTrialFeedbackEmailWithSQS = new HutchSQSBackedLambda(
	"send-trial-feedback-email",
	{
		lambda: sendTrialFeedbackEmailLambda,
		queue: sendTrialFeedbackEmailQueue,
		alertEmailDLQEntry: alertEmail,
		batchSize: 1,
	},
);

eventBus.subscribe(SendTrialFeedbackEmailCommand, sendTrialFeedbackEmailWithSQS);

// --- Analytics Dashboard ---
// The widget builder lives outside the Pulumi runtime so the dashboard JSON is
// constructable and assertable in tests that guard against coverage gaps and
// unknown references drifting from the analytics event constants.

const region = aws.config.requireRegion();

const excludedVisitorHashes = config.requireObject<string[]>("excludedVisitorHashes");
for (const hash of excludedVisitorHashes) {
	assert(/^[a-f0-9]+$/.test(hash), `excludedVisitorHashes entries must be lowercase hex (got: ${hash})`);
}

new aws.cloudwatch.LogMetricFilter("imports-completed-filter", {
	name: "imports-completed",
	logGroupName: lambda.logGroupName,
	pattern: `{ $.stream = "${STREAMS.analytics}" && $.event = "${ANALYTICS_EVENTS.importCommitted}" }`,
	metricTransformation: {
		name: METRICS.importsCompleted.name,
		namespace: METRICS.importsCompleted.namespace,
		value: "1",
		defaultValue: "0",
		unit: "Count",
	},
});

// --- Analytics log-group split (never-expire forwarder) ---
// Analytics / conversion / subscription log lines are copied out of each Lambda's
// own 30-day operational group into one never-expire /readplace/analytics group,
// so the dashboard scans only analytics bytes and the history is kept forever.
// CloudWatch Logs subscription filters on every source group feed a small
// forwarder Lambda that PutLogEvents each matched line's JSON payload into the
// destination (preamble stripped so Logs Insights can query the fields). Only the
// analytics streams match the filter; operational streams (parse-errors,
// crawl-outcomes) stay behind at 30-day retention.

const accountId = pulumi.output(aws.getCallerIdentity({})).accountId;

// Never expires (no retentionInDays): this is the durable analytics store.
// retainOnDelete guards the irreplaceable history against an accidental destroy.
const analyticsLogGroup = new aws.cloudwatch.LogGroup("analytics-log-group", {
	name: ANALYTICS_LOG_GROUP,
}, { retainOnDelete: true });

// The single group the dashboard's error widget reads. It exists because Logs
// Insights caps a query at 50 log groups and the account already holds 71 —
// an enumerating widget cannot cover the fleet, and the groups it omitted were
// silently unwatched (inbox and web-embed are shipping dark today).
const errorsLogGroup = new aws.cloudwatch.LogGroup("errors-log-group", {
	name: ERRORS_LOG_GROUP,
	retentionInDays: ERRORS_LOG_GROUP_RETENTION_DAYS,
}, { retainOnDelete: true });

// Async invokes that still fail after their retries park the original awslogs
// envelope here for replay. 14-day retention matches PutLogEvents' oldest-event
// limit, so a parked delivery is always still forwardable when it is drained.
const forwardAnalyticsFailures = new aws.sqs.Queue("forward-analytics-failures", {
	name: "forward-analytics-failures",
	messageRetentionSeconds: 1_209_600,
});

// Explicit least-privilege grants rather than leaning on the managed
// AWSLambdaBasicExecutionRole '*': the destination groups are this Lambda's data
// stores and the failure queue its on-failure sink, so the policy names all three.
const analyticsWritePolicy = {
	name: "forward-analytics-write",
	policy: pulumi.all([analyticsLogGroup.arn, errorsLogGroup.arn]).apply(([analyticsArn, errorsArn]) =>
		JSON.stringify({
			Version: "2012-10-17",
			Statement: [{
				Effect: "Allow",
				Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
				Resource: [`${analyticsArn}:*`, `${errorsArn}:*`],
			}],
		}),
	),
};

const analyticsFailurePolicy = {
	name: "forward-analytics-dlq-send",
	policy: forwardAnalyticsFailures.arn.apply((arn) =>
		JSON.stringify({
			Version: "2012-10-17",
			Statement: [{
				Effect: "Allow",
				Action: ["sqs:SendMessage"],
				Resource: [arn],
			}],
		}),
	),
};

const forwardAnalyticsLambda = new HutchLambda(FORWARD_ANALYTICS_LAMBDA_NAME, {
	entryPoint: "./src/runtime/forward-analytics.main.ts",
	outputDir: ".lib/forward-analytics",
	assetDir: "./src/runtime",
	memorySize: 128,
	timeout: 30,
	environment: {
		ANALYTICS_LOG_GROUP_NAME: analyticsLogGroup.name,
		ERRORS_LOG_GROUP_NAME: errorsLogGroup.name,
	},
	policies: [analyticsWritePolicy, analyticsFailurePolicy],
});

// A CloudWatch Logs subscription can only target Lambda/Kinesis/Firehose, so the
// forwarder is invoked directly with no SQS queue in front of it (the one place a
// naked Lambda is correct here). Async invokes retry twice, then the original
// envelope goes to the failure queue for replay.
new aws.lambda.FunctionEventInvokeConfig("forward-analytics-invoke-config", {
	functionName: forwardAnalyticsLambda.functionName,
	maximumRetryAttempts: 2,
	destinationConfig: {
		onFailure: { destination: forwardAnalyticsFailures.arn },
	},
});

const forwardAnalyticsDlqTopic = new aws.sns.Topic("forward-analytics-dlq-topic", {
	name: "forward-analytics-dlq-topic",
});

new aws.sns.TopicSubscription("forward-analytics-dlq-alarm-email", {
	topic: forwardAnalyticsDlqTopic.arn,
	protocol: "email",
	endpoint: alertEmail,
});

new aws.cloudwatch.MetricAlarm("forward-analytics-dlq-alarm", {
	name: "forward-analytics-dlq-alarm",
	comparisonOperator: "GreaterThanOrEqualToThreshold",
	evaluationPeriods: 1,
	metricName: "ApproximateNumberOfMessagesVisible",
	namespace: "AWS/SQS",
	period: 300,
	statistic: "Sum",
	threshold: 1,
	alarmDescription: "A log delivery entered the forward-analytics failure queue",
	dimensions: { QueueName: forwardAnalyticsFailures.name },
	alarmActions: [forwardAnalyticsDlqTopic.arn],
});

// The two hops AWS owns, where a dropped analytics line never reaches the handler —
// so neither the forwarder's Errors metric nor its failure queue would ever show it.
// A Metrics Insights query aggregates DeliveryErrors across every subscription filter
// in the account (including the one blog-site attaches to its own group, and any
// added later); a SEARCH expression cannot be used because an alarm may watch only
// one time series, and Metrics Insights is the one form allowed to aggregate many.
new aws.cloudwatch.MetricAlarm("forward-analytics-delivery-errors-alarm", {
	name: "forward-analytics-delivery-errors-alarm",
	comparisonOperator: "GreaterThanOrEqualToThreshold",
	evaluationPeriods: 1,
	threshold: 1,
	// The metric only exists once a delivery has failed, so absent data is healthy.
	treatMissingData: "notBreaching",
	alarmDescription:
		"CloudWatch Logs could not deliver matched analytics lines to the forwarder — those lines are lost before the Lambda runs",
	alarmActions: [forwardAnalyticsDlqTopic.arn],
	metricQueries: [{
		id: "dropped",
		expression: `SELECT SUM(DeliveryErrors) FROM "AWS/Logs"`,
		period: 300,
		returnData: true,
	}],
});

// Parking a failed delivery is itself best-effort: if Lambda cannot write the
// envelope to the on-failure queue, the delivery is gone and the depth alarm above
// stays silent because nothing ever arrives to be counted.
new aws.cloudwatch.MetricAlarm("forward-analytics-destination-delivery-alarm", {
	name: "forward-analytics-destination-delivery-alarm",
	comparisonOperator: "GreaterThanOrEqualToThreshold",
	evaluationPeriods: 1,
	metricName: "DestinationDeliveryFailures",
	namespace: "AWS/Lambda",
	period: 300,
	statistic: "Sum",
	threshold: 1,
	treatMissingData: "notBreaching",
	alarmDescription:
		"The forwarder could not park a failed delivery on its on-failure queue — that delivery is lost",
	dimensions: { FunctionName: forwardAnalyticsLambda.functionName },
	alarmActions: [forwardAnalyticsDlqTopic.arn],
});

// One wildcard grant rather than a statement per source group. Now that
// HutchLambda attaches a filter to every log group it creates, enumerating the
// sources here would mean ~53 statements in one function policy — approaching the
// 20KB policy limit — and would put concurrent AddPermission calls on a single
// policy document across a parallel, fail-fast:false deploy matrix, which is a
// ResourceConflictException waiting to happen. Enumerating would also reintroduce
// exactly the register-or-be-invisible list this change exists to delete.
//
// The scope traded away is real but narrow: any log group in THIS account could
// invoke the forwarder. The principal and account stay pinned, and the forwarder
// only ever writes to the two funnel groups.
new aws.lambda.Permission("forward-analytics-invoke-any-log-group", {
	action: "lambda:InvokeFunction",
	function: forwardAnalyticsLambda.functionName,
	principal: "logs.amazonaws.com",
	sourceAccount: accountId,
	sourceArn: pulumi.interpolate`arn:aws:logs:${region}:${accountId}:log-group:*`,
});

// The per-group subscription filters that used to live here are gone: every
// HutchLambda now attaches its own, so the list, its drift guard, and the
// blog-site special case all had nothing left to guard.

// Each subscription Lambda now owns its log group (HutchLambda), but those
// Lambdas only run after a trial ends — so until the first trial-end charge
// fires in a stack, AWS has never written to those groups. Depending on the
// Lambdas orders their managed groups ahead of this dashboard, so its Logs
// Insights queries render an empty result set instead of failing with
// `ResourceNotFoundException`.
new aws.cloudwatch.Dashboard("readplace-analytics", {
	dashboardName: "readplace-analytics",
	dashboardBody: pulumi.all([lambda.logGroupName, analyticsLogGroup.name, errorsLogGroup.name]).apply(([hutchLogGroupName, analyticsLogGroupName, errorsLogGroupName]) =>
		JSON.stringify(buildAnalyticsDashboardBody({
			region,
			hutchLogGroupName,
			analyticsLogGroupName,
			errorsLogGroupName,
			excludedVisitorHashes,
		})),
	),
}, {
	dependsOn: [
		analyticsLogGroup,
		subscriptionEventsLambda,
		sendTrialFeedbackEmailLambda,
	],
});


// --- Exports ---

export const apiUrl: pulumi.Input<string> = canonicalDomain ? `https://${canonicalDomain}` : gateway.apiUrl;
// Consumed by sibling deployables (blog-site, marketing-site) via a Pulumi
// StackReference to attach their own more-specific routes to this same API.
export const apiGatewayId = gateway.apiGatewayId;
export const apiGatewayExecutionArn = gateway.apiGatewayExecutionArn;
export const staticBaseUrl = staticAssets.baseUrl;
export const _dependencies = [gateway.defaultRoute];
