import { readFileSync } from "node:fs";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import assert from "node:assert";
import { z } from "zod";
import { buildMediaRobotsTxt } from "@packages/domain/crawler-policy";
import {
	curlImpersonateLayerArnFromPlatformStack,
	HutchEventBus,
	HutchLambda,
	HutchDynamoDBAccess,
	HutchDLQEventHandler,
	HutchSharedDlq,
	HutchSQS,
	HutchSQSBackedLambda,
	HutchS3ReadWrite,
	HutchS3ContentMediaCDN,
	type LambdaPolicy,
} from "@packages/hutch-infra-components/infra";
import {
	SaveLinkCommand,
	SubmitLinkCommand,
	SaveAnonymousLinkCommand,
	SaveLinkRawHtmlCommand,
	SaveLinkRawPdfCommand,
	SimpleCrawlUnsupportedEvent,
	ComprehensiveCrawlCommand,
	LinkSavedEvent,
	AnonymousLinkSavedEvent,
	CanonicalContentChangedEvent,
	ComputeRelatedArticlesCommand,
	StaleCheckRequestedEvent,
	SummaryGeneratedEvent,
	SummaryGenerationFailedEvent,
	RefreshArticleContentCommand,
	UpdateFetchTimestampCommand,
	TierContentExtractedEvent,
	RecrawlLinkInitiatedEvent,
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	RemoveMyContentCommand,
	ReselectAfterRemovalEvent,
	SAVE_LINK_DLQ_SOURCES,
	SAVE_LINK_LAMBDA_NAMES,
} from "@packages/hutch-infra-components";
import { requireEnv } from "@packages/require-env";
import { GENERATE_SUMMARY_TIMEOUTS } from "../runtime/domain/generate-summary/timeouts";
import { RELATED_ARTICLES_TIMEOUTS } from "../runtime/domain/related-articles/timeouts";
import { SELECT_CONTENT_TIMEOUTS } from "../runtime/domain/select-content/timeouts";
import { OCR_LLM_CLEANUP_TIMEOUTS } from "../runtime/domain/pdf-page-llm-cleanup/timeouts";
import { OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS } from "../runtime/domain/pdf-document-diff-review/timeouts";
import { OCR_HTML_CONVERT_TIMEOUTS } from "../runtime/domain/pdf-page-html-convert/timeouts";

/* Pulumi requires unique resource names per stack. Two Lambdas that attach
 * the same shared queue's send-policy would collide on the policy's name,
 * so each callsite namespaces it with a per-Lambda prefix. */
function renamePolicies(
	policies: readonly LambdaPolicy[],
	prefix: string,
): LambdaPolicy[] {
	return policies.map((p) => ({ ...p, name: `${prefix}-${p.name}` }));
}

const SAVE_LINK_FAILURES_DLQ = "save-link-failures";
const SAVE_LINK_FAILURES_DLQ_CONSUMER = `${SAVE_LINK_FAILURES_DLQ}-dlq`;

const config = new pulumi.Config();
const alertEmail = config.require("alertEmail");
const articlesTableName = config.require("articlesTableName");
const articlesTableArn = config.require("articlesTableArn");
// Per-user queue rows, owned by the hutch stack. The removal Lambda reads the
// url-index GSI to count other savers before deciding to purge a URL.
const userArticlesTableName = config.require("userArticlesTableName");
const userArticlesTableArn = config.require("userArticlesTableArn");
// Owned by the hutch stack (same convention as the articles table): counters
// for per-IP throttles and the global paid-crawl budget share one TTL'd table.
const rateLimitsTableName = config.require("rateLimitsTableName");
const rateLimitsTableArn = config.require("rateLimitsTableArn");
// "<budget>/<windowSeconds>" ceiling on comprehensive-crawl runs (OCR + LLM
// cleanup spend); enforced by the runtime's DynamoDB circuit-breaker.
const paidCrawlBudget = config.require("paidCrawlBudget");
const contentBucketName = config.require("contentBucketName");
const pendingHtmlBucketName = config.require("pendingHtmlBucketName");
const pendingPdfBucketName = config.require("pendingPdfBucketName");
const contentMediaCdnDomain = config.get("contentMediaCdnDomain");

/**
 * Image URIs for the OCR container Lambdas, written by the image-build step
 * before `pulumi up` runs. The file is gitignored and recreated on every
 * deploy. If it's missing, the build step was skipped — re-run
 * `pnpm build-image` (or check CI ordering).
 */
const ocrImageTags = z
	.object({
		"comprehensive-crawl-command": z.string(),
		"pdf-page-ocr": z.string(),
		"save-link-raw-pdf-command": z.string(),
	})
	.parse(JSON.parse(readFileSync(".lib/ocr-image-tags.json", "utf-8")));

// The curl_chrome131 bash wrapper + statically-linked curl-impersonate binary
// (Chrome TLS fingerprint, bypassing Akamai/Cloudflare JA3/JA4 blocks) is
// published once by the platform stack — inbox and hutch need the same binary,
// so one owner beats three copies. Read its ARN via the platform StackReference.
const curlImpersonateLayerArn = curlImpersonateLayerArnFromPlatformStack(config);

// --- Content S3 Bucket ---

const contentBucket = new HutchS3ReadWrite("content-bucket", {
	bucketName: contentBucketName,
});

// Staging prefix the orchestrator writes the source PDF to before fanning out
// per-page Lambda invocations. Best-effort cleanup runs after fan-out; the
// 1-day lifecycle expiration is the backstop if cleanup itself fails or the
// orchestrator crashes mid-job. Scoped to a prefix so it cannot affect other
// content-bucket keys.
const PDF_STAGING_PREFIX = "pdf-rasterise-staging/";
new aws.s3.BucketLifecycleConfigurationV2("content-bucket-pdf-staging-lifecycle", {
	bucket: contentBucket.bucket,
	rules: [{
		id: "expire-pdf-staging",
		status: "Enabled",
		filter: { prefix: PDF_STAGING_PREFIX },
		expiration: { days: 1 },
		abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
	}],
});

// --- Pending-HTML S3 Bucket ---
// Holds extension-captured raw HTML between the web Lambda's PutObject and the
// save-link-raw-html worker's GetObject (pending-html/ prefix), plus
// freshly-fetched HTML staged by stale-check/hutch before publishing
// RefreshArticleContentCommand (refresh-html/ prefix). Separate from
// content-bucket so the aggressive 1-day expiration applies only to staging
// objects, never canonical content.

// Browser extensions upload large captures straight to these buckets via a
// presigned PUT (bypassing the API Gateway 6 MB payload limit), so the buckets
// must allow the cross-origin PUT. The presigned signature is the authorisation
// — see HutchS3ReadWrite.corsRules for why `["*"]` origins are safe.
const UPLOAD_CORS_RULES = [
	{
		allowedMethods: ["PUT"],
		allowedOrigins: ["*"],
		allowedHeaders: ["*"],
		maxAgeSeconds: 3600,
	},
];

const pendingHtmlBucket = new HutchS3ReadWrite("pending-html-bucket", {
	bucketName: pendingHtmlBucketName,
	expirationRules: [
		{
			id: "stage-html-expiry",
			expirationDays: 1,
			prefixes: ["pending-html/", "refresh-html/"],
		},
	],
	corsRules: UPLOAD_CORS_RULES,
});

// --- Pending-PDF S3 Bucket ---
// Holds browser-uploaded raw PDF bytes (tier-0 client upload) between the web
// Lambda's PutObject and the save-link-raw-pdf-command worker's GetObject
// (pending-pdf/ prefix). Same 1-day expiration as pending-html so staged
// uploads never linger.
const pendingPdfBucket = new HutchS3ReadWrite("pending-pdf-bucket", {
	bucketName: pendingPdfBucketName,
	expirationRules: [
		{
			id: "stage-pdf-expiry",
			expirationDays: 1,
			prefixes: ["pending-pdf/"],
		},
	],
	corsRules: UPLOAD_CORS_RULES,
});

// --- Content Images CDN ---

const contentMediaCustomDomain = contentMediaCdnDomain
	? (() => {
		const parts = contentMediaCdnDomain.split(".");
		assert(parts.length >= 2, `contentMediaCdnDomain ${contentMediaCdnDomain} must have a parent zone`);
		const parent = parts.slice(1).join(".");
		const zoneId = aws.route53.getZone({ name: parent }).then((z) => z.zoneId);
		return { domain: contentMediaCdnDomain, zoneId };
	})()
	: undefined;

const contentMediaCdn = new HutchS3ContentMediaCDN("content-media", {
	contentBucket,
	customDomain: contentMediaCustomDomain,
});

new aws.s3.BucketObject("content-media-robots-txt", {
	bucket: contentBucket.bucket,
	key: "robots.txt",
	content: buildMediaRobotsTxt(),
	contentType: "text/plain",
});

const deepseekApiKey = pulumi.secret(requireEnv("DEEPSEEK_API_KEY"));

const eventBus = HutchEventBus.fromPlatformStack(config);

// --- Queues ---

const failuresDlq = new HutchSharedDlq(SAVE_LINK_FAILURES_DLQ, {
	alertEmailDLQEntry: alertEmail,
});

const generateSummaryQueue = new HutchSQS(SAVE_LINK_DLQ_SOURCES.generateSummary, {
	visibilityTimeoutSeconds: GENERATE_SUMMARY_TIMEOUTS.sqsVisibilitySeconds,
	sharedDlq: failuresDlq,
});

const linkSavedQueue = new HutchSQS("link-saved", {
	visibilityTimeoutSeconds: 60,
});

// Simple-only crawl Lambda: HTML + oembed only, PDFs dispatched to the
// dedicated comprehensive-crawl-command Lambda. 240s timeout covers the
// worst HTML fetch + readability parse; 480s SQS visibility = 2× the
// Lambda timeout per AWS guidance.
//
// dlqMaxReceiveCount=1: no SQS retries for the tier-1 server crawl. Its
// dominant failure is a deterministic origin edge-block (e.g. Cloudflare 403
// on the Lambda egress IP), which reproduces identically on every retry from
// the same IP — so retrying only delays the terminal state by
// visibility×maxReceiveCount (~24 min) while the reader sits on a "fetching"
// placeholder. Fail on the first attempt so the row resolves fast and the
// browser-captured tier-0 source (which is not subject to the origin IP block)
// can become canonical instead. Trade-off: a genuinely transient tier-1 blip
// (503/timeout) does not self-heal at the SQS layer; the user re-saving (or
// /admin/recrawl) is the retry.
const saveLinkCommandQueue = new HutchSQS(SAVE_LINK_DLQ_SOURCES.saveLinkCommand, {
	visibilityTimeoutSeconds: 480,
	dlqMaxReceiveCount: 1,
	sharedDlq: failuresDlq,
});

// maxReceiveCount=1: SQS retries are removed for the anonymous save path.
// A failed save does not reprime when the user re-visits /view. The DLQ → SNS
// email alarm is the operator's redrive signal, and /admin/recrawl is the
// manual retry.
// Other queues that aren't user-retriable (select-most-complete-content,
// generate-summary) keep the default maxReceiveCount=3 so transient
// Deepseek/DDB blips still self-heal at the SQS layer.
//
// Now simple-only — PDFs go through the comprehensive Lambda — so the
// timeout/visibility shrink to match save-link-command above.
const saveAnonymousLinkCommandQueue = new HutchSQS(
	SAVE_LINK_DLQ_SOURCES.saveAnonymousLinkCommand,
	{
		visibilityTimeoutSeconds: 480,
		dlqMaxReceiveCount: 1,
		sharedDlq: failuresDlq,
	},
);

const saveLinkRawHtmlCommandQueue = new HutchSQS(
	SAVE_LINK_DLQ_SOURCES.saveLinkRawHtmlCommand,
	{
		visibilityTimeoutSeconds: 480,
		sharedDlq: failuresDlq,
	},
);

// OCR path: 1800s visibility = 2x the
// 900s Lambda timeout; dlqMaxReceiveCount=1 because a retry re-OCRs every page
// from scratch, so an automatic redrive is expensive and rarely succeeds.
const saveLinkRawPdfCommandQueue = new HutchSQS(
	SAVE_LINK_DLQ_SOURCES.saveLinkRawPdfCommand,
	{
		visibilityTimeoutSeconds: 1800,
		dlqMaxReceiveCount: 1,
		sharedDlq: failuresDlq,
	},
);

const anonymousLinkSavedQueue = new HutchSQS("anonymous-link-saved", {
	visibilityTimeoutSeconds: 60,
});

const summaryGeneratedQueue = new HutchSQS("summary-generated", {
	visibilityTimeoutSeconds: 60,
});

const summaryGenerationFailedQueue = new HutchSQS("summary-generation-failed", {
	visibilityTimeoutSeconds: 60,
});

// Simple-only — PDF recrawls dispatch to the comprehensive Lambda.
//
// dlqMaxReceiveCount=1: same tier-1 fail-fast rationale as save-link-command —
// a recrawl's tier-1 crawl hits the same deterministic origin block, so retries
// only delay giving up. Fail once so the row stops sitting in "fetching" for
// ~24 min and a tier-0 (extension) save can be picked up instead of the doomed
// server crawl.
const recrawlLinkInitiatedQueue = new HutchSQS(SAVE_LINK_DLQ_SOURCES.recrawlLinkInitiated, {
	visibilityTimeoutSeconds: 480,
	dlqMaxReceiveCount: 1,
	sharedDlq: failuresDlq,
});

// Simple-only — PDF refreshes dispatch the comprehensive-crawl-command with
// refresh=true so the comprehensive Lambda emits RefreshContentExtractedEvent.
const staleCheckRequestedQueue = new HutchSQS("stale-check-requested", {
	visibilityTimeoutSeconds: 480,
});

const recrawlContentExtractedQueue = new HutchSQS(
	SAVE_LINK_DLQ_SOURCES.recrawlContentExtracted,
	{
		visibilityTimeoutSeconds: SELECT_CONTENT_TIMEOUTS.sqsVisibilitySeconds,
		sharedDlq: failuresDlq,
	},
);

const removeMyContentCommandQueue = new HutchSQS("remove-my-content-command", {
	visibilityTimeoutSeconds: 60,
});

const reselectAfterRemovalQueue = new HutchSQS(SAVE_LINK_DLQ_SOURCES.reselectAfterRemoval, {
	visibilityTimeoutSeconds: SELECT_CONTENT_TIMEOUTS.sqsVisibilitySeconds,
	sharedDlq: failuresDlq,
});

new HutchDLQEventHandler(SAVE_LINK_FAILURES_DLQ_CONSUMER, {
	deadLetterQueueArn: failuresDlq.arn,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(
		generateSummaryQueue.policies,
		SAVE_LINK_FAILURES_DLQ_CONSUMER,
	),
});

// --- SaveLinkCommand handler ---

const saveLinkCommandDynamodb = new HutchDynamoDBAccess("save-link-command-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const saveLinkCommandLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.saveLinkCommand, {
	priorLogGroupLogicalName: "saveLinkCommand-log-group",
	entryPoint: "./src/runtime/save-link-command.main.ts",
	outputDir: ".lib/save-link-command",
	assetDir: "./src",
	// 1769 MB = 1 full vCPU. Large HTML pages (40 MB+ interactive research
	// papers) expand to 3-5× in linkedom; 512 MB OOM'd on those.
	memorySize: 1769,
	timeout: 240,
	layers: [curlImpersonateLayerArn],
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...saveLinkCommandDynamodb.policies,
		// readTierSnapshot HEAD-checks tier-0 source when logging the crawl outcome.
		...contentBucket.readPolicies("save-link-command-content-read"),
		...contentBucket.writePolicies("save-link-command-s3"),
		...renamePolicies(generateSummaryQueue.policies, "save-link-command"),
	],
});

eventBus.grantPublish(saveLinkCommandLambda);

const saveLinkCommandLambdaWithSQS = new HutchSQSBackedLambda("save-link-command", {
	lambda: saveLinkCommandLambda,
	queue: saveLinkCommandQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SaveLinkCommand, saveLinkCommandLambdaWithSQS);

// --- SubmitLinkCommand handler ---
// dlqMaxReceiveCount 3, not the crawl queues' fail-fast 1: crawl failures
// terminalise in-process inside the handler and never throw, so a thrown
// record is an accept-phase failure (DynamoDB/EventBridge blip) that a
// retry genuinely can heal. Its DLQ handler mutates no article row — the row
// either does not exist or belongs to another saver's in-flight crawl — it only
// publishes LinkQueueFailedEvent so a reader's saved-link read model is not left
// claiming a queue row that never landed. That fact means "the command gave up",
// not "nothing was queued" (the accept phase writes the queue row before several
// calls that can still throw), so its consumer lets an accepted save outrank it.
// The DLQ alarm stays wired alongside it.
const submitLinkQueue = new HutchSQS(SAVE_LINK_DLQ_SOURCES.submitLink, {
	visibilityTimeoutSeconds: 480,
	dlqMaxReceiveCount: 3,
	sharedDlq: failuresDlq,
});

const submitLinkArticlesDynamodb = new HutchDynamoDBAccess("submit-link-articles-dynamodb", {
	// routeId-index Query: updateArticleStatus resolves the row for the
	// read-to-unread resurface by reader hash id.
	tables: [{ arn: articlesTableArn, includeIndexes: true }],
	actions: [
		"dynamodb:GetItem",
		"dynamodb:PutItem",
		"dynamodb:UpdateItem",
		"dynamodb:Query",
	],
});

const submitLinkUserArticlesDynamodb = new HutchDynamoDBAccess(
	"submit-link-user-articles-dynamodb",
	{
		tables: [{ arn: userArticlesTableArn, includeIndexes: false }],
		actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
	},
);

const submitLinkLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.submitLink, {
	entryPoint: "./src/runtime/submit-link.main.ts",
	outputDir: ".lib/submit-link",
	assetDir: "./src",
	memorySize: 1769,
	timeout: 240,
	layers: [curlImpersonateLayerArn],
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		DYNAMODB_USER_ARTICLES_TABLE: userArticlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...submitLinkArticlesDynamodb.policies,
		...submitLinkUserArticlesDynamodb.policies,
		...contentBucket.readPolicies("submit-link-content-read"),
		...contentBucket.writePolicies("submit-link-s3"),
		...renamePolicies(generateSummaryQueue.policies, "submit-link"),
	],
});

eventBus.grantPublish(submitLinkLambda);

const submitLinkLambdaWithSQS = new HutchSQSBackedLambda("submit-link", {
	lambda: submitLinkLambda,
	queue: submitLinkQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SubmitLinkCommand, submitLinkLambdaWithSQS);

// --- SaveLinkRawHtmlCommand handler ---

const saveLinkRawHtmlCommandDynamodb = new HutchDynamoDBAccess("save-link-raw-html-command-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const saveLinkRawHtmlCommandLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.saveLinkRawHtmlCommand, {
	priorLogGroupLogicalName: "saveLinkRawHtmlCommand-log-group",
	entryPoint: "./src/runtime/save-link-raw-html-command.main.ts",
	outputDir: ".lib/save-link-raw-html-command",
	assetDir: "./src",
	// 1769 MB = 1 full vCPU.
	memorySize: 1769,
	timeout: 240,
	layers: [curlImpersonateLayerArn],
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		PENDING_HTML_BUCKET_NAME: pendingHtmlBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...saveLinkRawHtmlCommandDynamodb.policies,
		...pendingHtmlBucket.readPolicies("save-link-raw-html-command-pending-html"),
		// Worker writes the tier source and its sidecar; a separate content-selection
		// stage owns canonical reads/writes and the Deepseek selector contest.
		// Read access exists to HEAD-check the tier source when logging the crawl outcome.
		...contentBucket.readPolicies("save-link-raw-html-command-content-read"),
		...contentBucket.writePolicies("save-link-raw-html-command-s3"),
		...renamePolicies(generateSummaryQueue.policies, "save-link-raw-html-command"),
	],
});

eventBus.grantPublish(saveLinkRawHtmlCommandLambda);

const saveLinkRawHtmlCommandLambdaWithSQS = new HutchSQSBackedLambda("save-link-raw-html-command", {
	lambda: saveLinkRawHtmlCommandLambda,
	queue: saveLinkRawHtmlCommandQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SaveLinkRawHtmlCommand, saveLinkRawHtmlCommandLambdaWithSQS);

// --- SaveAnonymousLinkCommand handler ---

const saveAnonymousLinkCommandDynamodb = new HutchDynamoDBAccess("save-anonymous-link-command-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const saveAnonymousLinkCommandLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.saveAnonymousLinkCommand, {
	priorLogGroupLogicalName: "saveAnonymousLinkCommand-log-group",
	entryPoint: "./src/runtime/save-anonymous-link-command.main.ts",
	outputDir: ".lib/save-anonymous-link-command",
	assetDir: "./src",
	// 1769 MB = 1 full vCPU.
	memorySize: 1769,
	timeout: 240,
	layers: [curlImpersonateLayerArn],
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...saveAnonymousLinkCommandDynamodb.policies,
		// readTierSnapshot HEAD-checks tier-0 source when logging the crawl outcome.
		...contentBucket.readPolicies("save-anonymous-link-command-content-read"),
		...contentBucket.writePolicies("save-anonymous-link-command-s3"),
		...renamePolicies(generateSummaryQueue.policies, "save-anonymous-link-command"),
	],
});

eventBus.grantPublish(saveAnonymousLinkCommandLambda);

const saveAnonymousLinkCommandLambdaWithSQS = new HutchSQSBackedLambda("save-anonymous-link-command", {
	lambda: saveAnonymousLinkCommandLambda,
	queue: saveAnonymousLinkCommandQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SaveAnonymousLinkCommand, saveAnonymousLinkCommandLambdaWithSQS);

// --- SimpleCrawlUnsupported policy ---
// Event-to-command reactor: subscribes to `SimpleCrawlUnsupportedEvent`
// (emitted by the save-link Lambdas when the simple crawl bails on non-HTML)
// and dispatches `ComprehensiveCrawlCommand` to the dedicated PDF-handling
// Lambda. This intermediate event decouples the Command → Command dispatch
// that would otherwise violate the Command → System → Event(s) pattern.
// 60s visibility = 2× the 30s Lambda timeout.
const simpleCrawlUnsupportedPolicyQueue = new HutchSQS(
	SAVE_LINK_DLQ_SOURCES.simpleCrawlUnsupportedPolicy,
	{
		visibilityTimeoutSeconds: 60,
		sharedDlq: failuresDlq,
	},
);

const simpleCrawlUnsupportedPolicyLambda = new HutchLambda("simple-crawl-unsupported-policy", {
	entryPoint: "./src/runtime/simple-crawl-unsupported-policy.main.ts",
	outputDir: ".lib/simple-crawl-unsupported-policy",
	assetDir: "./src",
	memorySize: 128,
	timeout: 30,
	environment: {
		EVENT_BUS_NAME: eventBus.eventBusName,
	},
	policies: [],
});

eventBus.grantPublish(simpleCrawlUnsupportedPolicyLambda);

const simpleCrawlUnsupportedPolicyLambdaWithSQS = new HutchSQSBackedLambda("simple-crawl-unsupported-policy", {
	lambda: simpleCrawlUnsupportedPolicyLambda,
	queue: simpleCrawlUnsupportedPolicyQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SimpleCrawlUnsupportedEvent, simpleCrawlUnsupportedPolicyLambdaWithSQS);

// --- PDF page OCR Lambda (sync-invoked) ---
// Per-page OCR worker fanned out from comprehensive-crawl-command. The
// orchestrator stages the source PDF to S3, then sync-invokes this Lambda
// for each page; each invocation downloads the staged PDF, rasterises its
// assigned page via pdftoppm `-f N -l N`, runs Tesseract locally against
// the PNG with every installed `script/<Name>` bundle joined into the
// `-l` flag (Latin / Arabic / HanS / Hangul / Devanagari / …), and
// returns the HTML fragment. Wall-time collapses to ~max(per_page) +
// dispatch overhead instead of summing the sequential rasterisation cost.
//
// No HutchSQSBackedLambda wrapper / no DLQ on this Lambda: it is a
// synchronous request/response Lambda (the documented exception in
// .claude/skills/infrastructure-design/SKILL.md). The orchestrator is the
// queue analogue — per-page failures propagate to the orchestrator's catch,
// which fails the SQS record so the dead-letter queue captures the whole-job
// failure with the existing alarm + DLQ row-mutator semantics.
const pdfPageOcrStagingRead: LambdaPolicy = {
	name: "pdf-page-ocr-staging-read",
	policy: contentBucket.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{
			Effect: "Allow",
			Action: ["s3:GetObject"],
			Resource: `${arn}/${PDF_STAGING_PREFIX}*`,
		}],
	})),
};

const pdfPageOcrLambda = new HutchLambda("pdf-page-ocr", {
	// 1769 MB lands one vCPU per Lambda for CPU-bound pdftoppm + Tesseract.
	// 900 s timeout is AWS Lambda's hard ceiling — overprovisioned versus
	// observed per-page wall clocks (Tesseract finishes the heaviest CIA
	// reading-room pages in ~35 s), but Lambda is billed on actual
	// execution time so the headroom is free and absorbs any future
	// regression on dense-text pages.
	memorySize: 1769,
	// Each page invocation downloads the full staged PDF and writes it to /tmp
	// before pdftoppm rasterises its one page, so /tmp must hold the largest
	// supported PDF (plus the rendered PNG) — 2 GiB, up from the 512 MiB default.
	ephemeralStorageSize: 2048,
	timeout: 900,
	containerImage: { imageUri: ocrImageTags["pdf-page-ocr"] },
	environment: {
		CONTENT_BUCKET_NAME: contentBucketName,
	},
	// Narrowly-scoped S3 read so the page Lambda can only fetch from the
	// staging prefix — never tier sources, snapshots, or images.
	policies: [pdfPageOcrStagingRead],
});

// --- PDF page LLM cleanup Lambda (sync-invoked) ---
// Stage 1 of the LLM-assisted OCR cleanup pipeline. Sync-invoked from the
// comprehensive-crawl orchestrator per page after Tesseract returns. Pure
// network call (DeepSeek chat-completion); no rasterisation, no Tesseract
// binary, no S3 access. Sized small accordingly.
//
// No DLQ / no HutchSQSBackedLambda wrapper for the same reason as
// pdf-page-ocr: sync request/response Lambda, exception documented in
// .claude/skills/infrastructure-design/SKILL.md. Cleanup failures fall back
// to the original Tesseract text inside the orchestrator, so a Lambda-level
// failure here never strands the article — Tesseract output ships unchanged.
const pdfPageLlmCleanupLambda = new HutchLambda("pdf-page-llm-cleanup", {
	memorySize: 512,
	timeout: OCR_LLM_CLEANUP_TIMEOUTS.lambdaSeconds,
	entryPoint: "./src/runtime/pdf-page-llm-cleanup.main.ts",
	outputDir: ".lib/pdf-page-llm-cleanup",
	assetDir: "./src",
	environment: {
		DEEPSEEK_API_KEY: deepseekApiKey,
	},
	policies: [],
});

// --- PDF page semantic-HTML convert Lambda (sync-invoked) ---
// Stage 3 of the LLM-assisted OCR cleanup pipeline. Sync-invoked per page
// from the comprehensive-crawl orchestrator after Stage 2's diff review
// completes. Pure network call (DeepSeek chat-completion); no
// rasterisation, no Tesseract binary, no S3 access. Re-introduces the
// semantic-HTML emission the pipeline lost when it migrated from
// DeepInfra vision OCR to local Tesseract — so Readability renders the
// reader view with headings, lists, code blocks, blockquotes, and tables
// instead of a wall of paragraphs.
//
// No DLQ / no HutchSQSBackedLambda wrapper for the same reason as
// pdf-page-ocr / pdf-page-llm-cleanup: sync request/response Lambda,
// the documented exception in .claude/skills/infrastructure-design/SKILL.md.
// HTML-convert failures fall back to a `<p class="ocr-tesseract">` wrap
// inside the Stage 3 handler (and again inside the orchestrator if the
// invoke itself fails), so a Lambda-level failure never strands the
// article — the reader still gets the Stage 2 text.
const pdfPageHtmlConvertLambda = new HutchLambda("pdf-page-html-convert", {
	memorySize: 512,
	timeout: OCR_HTML_CONVERT_TIMEOUTS.lambdaSeconds,
	entryPoint: "./src/runtime/pdf-page-html-convert.main.ts",
	outputDir: ".lib/pdf-page-html-convert",
	assetDir: "./src",
	environment: {
		DEEPSEEK_API_KEY: deepseekApiKey,
	},
	policies: [],
});

// --- PDF document diff-review Lambda (sync-invoked) ---
// Stage 2 of the LLM-assisted OCR cleanup pipeline. Single invocation per
// document with every successful page's original + cleaned text; the Lambda
// computes word-level diffs, sends them plus the full cleaned text to
// DeepSeek with JSON mode, applies the model's APPROVE/REJECT/MODIFY/NEW
// decisions per-page, and returns one final text per page. Same DLQ
// exception as pdf-page-ocr (sync request/response).
//
// Larger memory than Stage 1 because the handler holds the whole document
// in memory across diff construction, the LLM call, and decision
// application. Longer timeout for the same reason — a 75-page document
// hits multiple chunked DeepSeek calls.
const pdfDocumentDiffReviewLambda = new HutchLambda("pdf-document-diff-review", {
	memorySize: 1024,
	timeout: OCR_DOCUMENT_DIFF_REVIEW_TIMEOUTS.lambdaSeconds,
	entryPoint: "./src/runtime/pdf-document-diff-review.main.ts",
	outputDir: ".lib/pdf-document-diff-review",
	assetDir: "./src",
	environment: {
		DEEPSEEK_API_KEY: deepseekApiKey,
	},
	policies: [],
});

// --- ComprehensiveCrawlCommand handler ---
// PDF / heavy crawl path runs in its own Lambda so it cannot starve the
// HTML-only save-link workers. The `simple-crawl-unsupported-policy` Lambda
// dispatches `ComprehensiveCrawlCommand` in reaction to
// `SimpleCrawlUnsupportedEvent`; this Lambda re-fetches the URL, runs the
// pdfinfo metadata extraction, stages the PDF to S3, fans out per-page OCR
// invocations against `pdf-page-ocr`, joins the resulting HTML, parses it,
// writes the tier-1 source, and emits the appropriate downstream event
// itself (TierContentExtractedEvent for normal saves,
// RecrawlContentExtractedEvent when the recrawl flag is set on the command).
//
// 1800s visibility = 2× the 900s Lambda timeout per AWS guidance.
// dlqMaxReceiveCount=1: SQS retries are disabled for the comprehensive path —
// a failed OCR run re-OCRs every page from scratch on retry (no resume), so
// the cost of an automatic redrive is high and the success rate of a literal
// re-run without changed inputs is low. The DLQ → SNS alarm is the operator
// signal; /admin/recrawl is the manual retry.
const comprehensiveCrawlCommandQueue = new HutchSQS(
	SAVE_LINK_DLQ_SOURCES.comprehensiveCrawlCommand,
	{
		visibilityTimeoutSeconds: 1800,
		dlqMaxReceiveCount: 1,
		sharedDlq: failuresDlq,
	},
);

const comprehensiveCrawlCommandDynamodb = new HutchDynamoDBAccess("comprehensive-crawl-command-dynamodb", {
	tables: [
		{ arn: articlesTableArn, includeIndexes: false },
		// Paid-crawl budget counter (conditional UpdateItem per crawl).
		{ arn: rateLimitsTableArn, includeIndexes: false },
	],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const comprehensiveCrawlCommandInvokePageOcr: LambdaPolicy = {
	name: "comprehensive-crawl-command-invoke-page-ocr",
	policy: pdfPageOcrLambda.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: arn }],
	})),
};

const comprehensiveCrawlCommandInvokePageLlmCleanup: LambdaPolicy = {
	name: "comprehensive-crawl-command-invoke-page-llm-cleanup",
	policy: pdfPageLlmCleanupLambda.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: arn }],
	})),
};

const comprehensiveCrawlCommandInvokeDocumentDiffReview: LambdaPolicy = {
	name: "comprehensive-crawl-command-invoke-document-diff-review",
	policy: pdfDocumentDiffReviewLambda.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: arn }],
	})),
};

const comprehensiveCrawlCommandInvokePageHtmlConvert: LambdaPolicy = {
	name: "comprehensive-crawl-command-invoke-page-html-convert",
	policy: pdfPageHtmlConvertLambda.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: arn }],
	})),
};

const comprehensiveCrawlCommandStagingDelete: LambdaPolicy = {
	name: "comprehensive-crawl-command-staging-delete",
	policy: contentBucket.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{
			Effect: "Allow",
			Action: ["s3:DeleteObject"],
			Resource: `${arn}/${PDF_STAGING_PREFIX}*`,
		}],
	})),
};

const comprehensiveCrawlCommandLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.comprehensiveCrawlCommand, {
	priorLogGroupLogicalName: "comprehensiveCrawlCommand-log-group",
	// The orchestrator buffers the whole PDF (the AWS SDK stream collector alone
	// peaks ~3× the file transiently) and writes it to /tmp for pdfinfo + S3
	// staging, so a 500 MB upload needs headroom well above the post-fan-out
	// workload: 3008 MB matches the select-content ceiling, /tmp at 2 GiB.
	memorySize: 3008,
	ephemeralStorageSize: 2048,
	timeout: 900,
	containerImage: { imageUri: ocrImageTags["comprehensive-crawl-command"] },
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		DYNAMODB_RATE_LIMITS_TABLE: rateLimitsTableName,
		PAID_CRAWL_BUDGET: paidCrawlBudget,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
		PDF_PAGE_OCR_FUNCTION_NAME: pdfPageOcrLambda.functionName,
		PDF_PAGE_LLM_CLEANUP_FUNCTION_NAME: pdfPageLlmCleanupLambda.functionName,
		PDF_DOCUMENT_DIFF_REVIEW_FUNCTION_NAME: pdfDocumentDiffReviewLambda.functionName,
		PDF_PAGE_HTML_CONVERT_FUNCTION_NAME: pdfPageHtmlConvertLambda.functionName,
	},
	policies: [
		...comprehensiveCrawlCommandDynamodb.policies,
		// readTierSnapshot HEAD-checks tier-0 source when logging the crawl outcome.
		...contentBucket.readPolicies("comprehensive-crawl-command-content-read"),
		...contentBucket.writePolicies("comprehensive-crawl-command-s3"),
		comprehensiveCrawlCommandStagingDelete,
		comprehensiveCrawlCommandInvokePageOcr,
		comprehensiveCrawlCommandInvokePageLlmCleanup,
		comprehensiveCrawlCommandInvokeDocumentDiffReview,
		comprehensiveCrawlCommandInvokePageHtmlConvert,
		...renamePolicies(generateSummaryQueue.policies, "comprehensive-crawl-command"),
	],
});

eventBus.grantPublish(comprehensiveCrawlCommandLambda);

const comprehensiveCrawlCommandLambdaWithSQS = new HutchSQSBackedLambda("comprehensive-crawl-command", {
	lambda: comprehensiveCrawlCommandLambda,
	queue: comprehensiveCrawlCommandQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(ComprehensiveCrawlCommand, comprehensiveCrawlCommandLambdaWithSQS);

// --- SaveLinkRawPdfCommand handler ---
// Client-uploaded PDFs (tier-0) arrive already in the browser, so there is no
// HTTP crawl: this worker reads the staged PDF from pending-pdf and runs the
// same OCR orchestration as comprehensive-crawl-command (pdfinfo metadata, S3
// staging, per-page OCR fan-out, LLM cleanup, diff review, semantic-HTML
// convert), writes the tier-0 source, and emits the downstream event.

const saveLinkRawPdfCommandDynamodb = new HutchDynamoDBAccess("save-link-raw-pdf-command-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const saveLinkRawPdfCommandInvokePageOcr: LambdaPolicy = {
	name: "save-link-raw-pdf-command-invoke-page-ocr",
	policy: pdfPageOcrLambda.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: arn }],
	})),
};

const saveLinkRawPdfCommandInvokePageLlmCleanup: LambdaPolicy = {
	name: "save-link-raw-pdf-command-invoke-page-llm-cleanup",
	policy: pdfPageLlmCleanupLambda.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: arn }],
	})),
};

const saveLinkRawPdfCommandInvokeDocumentDiffReview: LambdaPolicy = {
	name: "save-link-raw-pdf-command-invoke-document-diff-review",
	policy: pdfDocumentDiffReviewLambda.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: arn }],
	})),
};

const saveLinkRawPdfCommandInvokePageHtmlConvert: LambdaPolicy = {
	name: "save-link-raw-pdf-command-invoke-page-html-convert",
	policy: pdfPageHtmlConvertLambda.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: arn }],
	})),
};

const saveLinkRawPdfCommandStagingDelete: LambdaPolicy = {
	name: "save-link-raw-pdf-command-staging-delete",
	policy: contentBucket.arn.apply((arn) => JSON.stringify({
		Version: "2012-10-17",
		Statement: [{
			Effect: "Allow",
			Action: ["s3:DeleteObject"],
			Resource: `${arn}/${PDF_STAGING_PREFIX}*`,
		}],
	})),
};

const saveLinkRawPdfCommandLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.saveLinkRawPdfCommand, {
	priorLogGroupLogicalName: "saveLinkRawPdfCommand-log-group",
	// Reads the whole staged PDF into memory (SDK stream collector peaks ~3× the
	// file) and writes it to /tmp for pdfinfo + S3 staging before per-page fan-out.
	// A 500 MB client upload needs 3008 MB + a 2 GiB /tmp, matching the OCR path.
	memorySize: 3008,
	ephemeralStorageSize: 2048,
	timeout: 900,
	containerImage: { imageUri: ocrImageTags["save-link-raw-pdf-command"] },
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		PENDING_PDF_BUCKET_NAME: pendingPdfBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
		PDF_PAGE_OCR_FUNCTION_NAME: pdfPageOcrLambda.functionName,
		PDF_PAGE_LLM_CLEANUP_FUNCTION_NAME: pdfPageLlmCleanupLambda.functionName,
		PDF_DOCUMENT_DIFF_REVIEW_FUNCTION_NAME: pdfDocumentDiffReviewLambda.functionName,
		PDF_PAGE_HTML_CONVERT_FUNCTION_NAME: pdfPageHtmlConvertLambda.functionName,
	},
	policies: [
		...saveLinkRawPdfCommandDynamodb.policies,
		...pendingPdfBucket.readPolicies("save-link-raw-pdf-command-pending-pdf"),
		...contentBucket.readPolicies("save-link-raw-pdf-command-content-read"),
		...contentBucket.writePolicies("save-link-raw-pdf-command-s3"),
		saveLinkRawPdfCommandStagingDelete,
		saveLinkRawPdfCommandInvokePageOcr,
		saveLinkRawPdfCommandInvokePageLlmCleanup,
		saveLinkRawPdfCommandInvokeDocumentDiffReview,
		saveLinkRawPdfCommandInvokePageHtmlConvert,
		...renamePolicies(generateSummaryQueue.policies, "save-link-raw-pdf-command"),
	],
});

eventBus.grantPublish(saveLinkRawPdfCommandLambda);

const saveLinkRawPdfCommandLambdaWithSQS = new HutchSQSBackedLambda("save-link-raw-pdf-command", {
	lambda: saveLinkRawPdfCommandLambda,
	queue: saveLinkRawPdfCommandQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SaveLinkRawPdfCommand, saveLinkRawPdfCommandLambdaWithSQS);

// --- StaleCheckRequested handler ---
// Background worker that runs the freshness/conditional-GET path. Reads
// freshness + crawl status from DDB; on a stale
// row publishes RefreshArticleContent (200) or UpdateFetchTimestamp (304); on
// a failed/missing crawl status republishes SaveAnonymousLinkCommand to redrive
// the crawl pipeline. PDFs (or any non-HTML body) emit SimpleCrawlUnsupportedEvent
// with `refresh=true` so the policy → comprehensive-crawl-command chain runs the
// OCR + tier-1 write off this Lambda's concurrency budget. No DLQ row-mutator
// is wired: a stale-check failure must not flip the article to crawlStatus='failed' —
// the row already has whatever state the upstream pipeline produced, and the
// user can still read it.

const staleCheckRequestedDynamodb = new HutchDynamoDBAccess("stale-check-requested-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const staleCheckRequestedLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.staleCheckRequested, {
	priorLogGroupLogicalName: "staleCheckRequested-log-group",
	entryPoint: "./src/runtime/stale-check.main.ts",
	outputDir: ".lib/stale-check-requested",
	assetDir: "./src",
	// 1769 MB = 1 full vCPU.
	memorySize: 1769,
	timeout: 240,
	layers: [curlImpersonateLayerArn],
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
		PENDING_HTML_BUCKET_NAME: pendingHtmlBucketName,
	},
	policies: [
		...staleCheckRequestedDynamodb.policies,
		...renamePolicies(generateSummaryQueue.policies, "stale-check-requested"),
		// Stages the refreshed HTML under refresh-html/ before publishing
		// RefreshArticleContentCommand; consumer reads from the same bucket.
		...pendingHtmlBucket.writePolicies("stale-check-requested-refresh-html"),
		// finalizeArticle uploads thumbnail + body images to the content bucket
		// as part of the unified crawl-and-finalize pipeline.
		...contentBucket.writePolicies("stale-check-requested-s3"),
	],
});

eventBus.grantPublish(staleCheckRequestedLambda);

const staleCheckRequestedLambdaWithSQS = new HutchSQSBackedLambda("stale-check-requested", {
	lambda: staleCheckRequestedLambda,
	queue: staleCheckRequestedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(StaleCheckRequestedEvent, staleCheckRequestedLambdaWithSQS);

// --- SelectMostCompleteContent handler ---
// Subscribes to TierContentExtractedEvent emitted by the three save-link
// workers. Reads available per-tier sources from S3, runs the Deepseek
// selector when there is competition, short-circuits when only one tier is
// present, and is the only Lambda that promotes to canonical (S3 CopyObject
// + Dynamo UpdateItem with contentSourceTier). Emits LinkSavedEvent /
// AnonymousLinkSavedEvent (only on canonical change) and
// CrawlArticleCompletedEvent (every successful selection).

const selectMostCompleteContentQueue = new HutchSQS(
	SAVE_LINK_DLQ_SOURCES.selectMostCompleteContent,
	{
		visibilityTimeoutSeconds: SELECT_CONTENT_TIMEOUTS.sqsVisibilitySeconds,
		sharedDlq: failuresDlq,
	},
);

const selectMostCompleteContentDynamodb = new HutchDynamoDBAccess(`${SAVE_LINK_LAMBDA_NAMES.selectMostCompleteContent}-dynamodb`, {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const selectMostCompleteContentLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.selectMostCompleteContent, {
	priorLogGroupLogicalName: "selectMostCompleteContent-log-group",
			entryPoint: "./src/runtime/select-most-complete-content.main.ts",
		outputDir: ".lib/select-most-complete-content",
		assetDir: "./src",
		// 3008 MB (this AWS account's Lambda memory ceiling — the 10240 MB
		// platform max needs a quota increase AWS rejected with a 3008 cap):
		// this finalize handler loads the full tier-source HTML from S3, so a
		// page carrying many MB of inline base64 images OOM'd at 256 MB.
	memorySize: 3008,
	timeout: SELECT_CONTENT_TIMEOUTS.lambdaSeconds,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		DEEPSEEK_API_KEY: deepseekApiKey,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...selectMostCompleteContentDynamodb.policies,
		...contentBucket.readPolicies("select-most-complete-content-content-read"),
		...contentBucket.writePolicies("select-most-complete-content-content-write"),
		...renamePolicies(generateSummaryQueue.policies, SAVE_LINK_LAMBDA_NAMES.selectMostCompleteContent),
	],
});

eventBus.grantPublish(selectMostCompleteContentLambda);

const selectMostCompleteContentLambdaWithSQS = new HutchSQSBackedLambda(SAVE_LINK_LAMBDA_NAMES.selectMostCompleteContent, {
	lambda: selectMostCompleteContentLambda,
	queue: selectMostCompleteContentQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(TierContentExtractedEvent, selectMostCompleteContentLambdaWithSQS);

// --- RemoveMyContentCommand handler ---
// Content-removal orchestrator. Deletes the S3 objects the removing user
// authored (their attributed snapshot, plus their tier-0 capture once it is the
// last one they authored), prunes the pruned minute-ids from the crawlVersions
// log, then — only when that leaves the canonical copy derived from a source
// that is gone — re-selects from surviving sources, re-crawls for the savers
// still holding the URL, or purges every stored object and tombstones the row.
// Idempotent throughout so an at-least-once redelivery converges.

const removeMyContentCommandDynamodb = new HutchDynamoDBAccess("remove-my-content-command-dynamodb", {
	tables: [
		{ arn: articlesTableArn, includeIndexes: false },
		// url-index GSI: countSaversByUrl reads it to decide purge vs re-crawl.
		{ arn: userArticlesTableArn, includeIndexes: true },
	],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Query"],
});

const removeMyContentCommandLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.removeMyContentCommand, {
	entryPoint: "./src/runtime/remove-my-content-command.main.ts",
	outputDir: ".lib/remove-my-content-command",
	assetDir: "./src",
	memorySize: 256,
	timeout: 60,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		DYNAMODB_USER_ARTICLES_TABLE: userArticlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
	},
	policies: [
		...removeMyContentCommandDynamodb.policies,
		...contentBucket.readPolicies("remove-my-content-command-content-read"),
		...contentBucket.deletePolicies("remove-my-content-command-content-delete"),
	],
});

eventBus.grantPublish(removeMyContentCommandLambda);

const removeMyContentCommandLambdaWithSQS = new HutchSQSBackedLambda("remove-my-content-command", {
	lambda: removeMyContentCommandLambda,
	queue: removeMyContentCommandQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(RemoveMyContentCommand, removeMyContentCommandLambdaWithSQS);

// --- ReselectAfterRemoval handler ---
// Re-runs the tier-selection core over the sources that survive a removal,
// with no userId so a canonical flip never fires a "saved!" notification at the
// remover. Same shape as select-most-complete-content (3008 MB to hold full
// tier-source HTML from S3).

const reselectAfterRemovalDynamodb = new HutchDynamoDBAccess("reselect-after-removal-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const reselectAfterRemovalLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.reselectAfterRemoval, {
	entryPoint: "./src/runtime/reselect-after-removal.main.ts",
	outputDir: ".lib/reselect-after-removal",
	assetDir: "./src",
	memorySize: 3008,
	timeout: SELECT_CONTENT_TIMEOUTS.lambdaSeconds,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		DEEPSEEK_API_KEY: deepseekApiKey,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...reselectAfterRemovalDynamodb.policies,
		...contentBucket.readPolicies("reselect-after-removal-content-read"),
		...contentBucket.writePolicies("reselect-after-removal-content-write"),
		...renamePolicies(generateSummaryQueue.policies, "reselect-after-removal"),
	],
});

eventBus.grantPublish(reselectAfterRemovalLambda);

const reselectAfterRemovalLambdaWithSQS = new HutchSQSBackedLambda("reselect-after-removal", {
	lambda: reselectAfterRemovalLambda,
	queue: reselectAfterRemovalQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(ReselectAfterRemovalEvent, reselectAfterRemovalLambdaWithSQS);

// --- GenerateSummary handler ---

const generateSummaryDynamodb = new HutchDynamoDBAccess("generate-summary-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const generateSummaryLambda = new HutchLambda("generate-summary", {
	entryPoint: "./src/runtime/generate-summary.main.ts",
	outputDir: ".lib/generate-summary",
	assetDir: "./src",
	// Loads the full canonical content from S3 and strips it via linkedom before
	// summarising; a 40 MB HTML upload needs headroom above the old 512 MB (the
	// input is also char-capped in link-summariser so the model call can't overflow).
	memorySize: 1769,
	timeout: GENERATE_SUMMARY_TIMEOUTS.lambdaSeconds,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		DEEPSEEK_API_KEY: deepseekApiKey,
		EVENT_BUS_NAME: eventBus.eventBusName,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...generateSummaryDynamodb.policies,
		...renamePolicies(generateSummaryQueue.policies, "generate-summary"),
		...contentBucket.readPolicies("generate-summary-s3"),
	],
});

eventBus.grantPublish(generateSummaryLambda);

new HutchSQSBackedLambda("generate-summary", {
	lambda: generateSummaryLambda,
	queue: generateSummaryQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

// --- LinkSaved handler ---

const linkSavedDynamodb = new HutchDynamoDBAccess("link-saved-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem"],
});

const linkSavedLambda = new HutchLambda("link-saved", {
	entryPoint: "./src/runtime/link-saved.main.ts",
	outputDir: ".lib/link-saved",
	assetDir: "./src",
	memorySize: 256,
	timeout: 30,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...linkSavedDynamodb.policies,
		...generateSummaryQueue.policies,
		...contentBucket.readPolicies("link-saved-s3"),
	],
});

const linkSavedLambdaWithSQS = new HutchSQSBackedLambda("link-saved", {
	lambda: linkSavedLambda,
	queue: linkSavedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(LinkSavedEvent, linkSavedLambdaWithSQS);

// --- AnonymousLinkSaved handler ---

const anonymousLinkSavedDynamodb = new HutchDynamoDBAccess("anonymous-link-saved-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem"],
});

const anonymousLinkSavedLambda = new HutchLambda("anonymous-link-saved", {
	entryPoint: "./src/runtime/anonymous-link-saved.main.ts",
	outputDir: ".lib/anonymous-link-saved",
	assetDir: "./src",
	memorySize: 256,
	timeout: 30,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...anonymousLinkSavedDynamodb.policies,
		// Rename the shared queue's send-policy so the Pulumi URN doesn't
		// collide with the link-saved Lambda's attachment of the same policy.
		...renamePolicies(generateSummaryQueue.policies, "anonymous"),
		...contentBucket.readPolicies("anonymous-link-saved-s3"),
	],
});

const anonymousLinkSavedLambdaWithSQS = new HutchSQSBackedLambda("anonymous-link-saved", {
	lambda: anonymousLinkSavedLambda,
	queue: anonymousLinkSavedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(AnonymousLinkSavedEvent, anonymousLinkSavedLambdaWithSQS);

// --- CanonicalContentChanged handler ---
// Subscribes to CanonicalContentChangedEvent (published by the tier selector
// when the canonical tier flips or the readable text changes) and re-primes the
// summary axis via markSummaryPending so the generate-summary worker regenerates
// against the new canonical instead of cache-hitting a stale terminal summary.
// This is the OCP seam: future derived-artifact consumers (transcript,
// embeddings) attach as new eventBus.subscribe(CanonicalContentChangedEvent, …)
// without touching the publisher. No dedicated DLQ event handler — the crawl has
// already succeeded, so there is no terminal row state to flip on the rare
// read-your-writes lag; the HutchSQSBackedLambda DLQ + email alarm is the
	// operator signal.

const canonicalContentChangedQueue = new HutchSQS("canonical-content-changed", {
	visibilityTimeoutSeconds: 60,
});

const canonicalContentChangedDynamodb = new HutchDynamoDBAccess("canonical-content-changed-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const canonicalContentChangedLambda = new HutchLambda("canonical-content-changed", {
	entryPoint: "./src/runtime/canonical-content-changed.main.ts",
	outputDir: ".lib/canonical-content-changed",
	assetDir: "./src",
	memorySize: 256,
	timeout: 30,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...canonicalContentChangedDynamodb.policies,
		...renamePolicies(generateSummaryQueue.policies, "canonical-content-changed"),
		...contentBucket.readPolicies("canonical-content-changed-s3"),
	],
});

eventBus.grantPublish(canonicalContentChangedLambda);

const canonicalContentChangedLambdaWithSQS = new HutchSQSBackedLambda("canonical-content-changed", {
	lambda: canonicalContentChangedLambda,
	queue: canonicalContentChangedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(CanonicalContentChangedEvent, canonicalContentChangedLambdaWithSQS);

// --- ComputeRelatedArticles handler ---
// Consumes the command every interactive save publishes and writes the selected
// relations onto the per-user save row. Waits (throw → SQS retry) while the
// article's crawl metadata is still landing, so the model never compares against
// the stub title a fresh save starts with. No dedicated DLQ event handler — an
// absent relatedStatus renders as the hidden reader slot, so there is no terminal
// row state to flip; the HutchSQSBackedLambda DLQ + email alarm is the operator
// signal.

const computeRelatedArticlesQueue = new HutchSQS("compute-related-articles", {
	visibilityTimeoutSeconds: RELATED_ARTICLES_TIMEOUTS.sqsVisibilitySeconds,
});

const computeRelatedArticlesArticlesDynamodb = new HutchDynamoDBAccess("compute-related-articles-articles-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:BatchGetItem"],
});

const computeRelatedArticlesUserArticlesDynamodb = new HutchDynamoDBAccess("compute-related-articles-user-articles-dynamodb", {
	tables: [{ arn: userArticlesTableArn, includeIndexes: true }],
	actions: [
		"dynamodb:GetItem",
		"dynamodb:BatchGetItem",
		"dynamodb:Query",
		"dynamodb:UpdateItem",
	],
});

const computeRelatedArticlesLambda = new HutchLambda("compute-related-articles", {
	entryPoint: "./src/runtime/compute-related-articles.main.ts",
	outputDir: ".lib/compute-related-articles",
	assetDir: "./src",
	memorySize: 256,
	timeout: RELATED_ARTICLES_TIMEOUTS.lambdaSeconds,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		DYNAMODB_USER_ARTICLES_TABLE: userArticlesTableName,
		DEEPSEEK_API_KEY: deepseekApiKey,
		EVENT_BUS_NAME: eventBus.eventBusName,
	},
	policies: [
		...computeRelatedArticlesArticlesDynamodb.policies,
		...computeRelatedArticlesUserArticlesDynamodb.policies,
	],
});

eventBus.grantPublish(computeRelatedArticlesLambda);

const computeRelatedArticlesLambdaWithSQS = new HutchSQSBackedLambda("compute-related-articles", {
	lambda: computeRelatedArticlesLambda,
	queue: computeRelatedArticlesQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(ComputeRelatedArticlesCommand, computeRelatedArticlesLambdaWithSQS);

// --- RecrawlLinkInitiated handler ---

const recrawlLinkInitiatedDynamodb = new HutchDynamoDBAccess("recrawl-link-initiated-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const recrawlLinkInitiatedLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.recrawlLinkInitiated, {
	priorLogGroupLogicalName: "recrawlLinkInitiated-log-group",
	entryPoint: "./src/runtime/recrawl-link-initiated.main.ts",
	outputDir: ".lib/recrawl-link-initiated",
	assetDir: "./src",
			// 1769 MB = 1 full vCPU.
	memorySize: 1769,
	timeout: 240,
	layers: [curlImpersonateLayerArn],
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...recrawlLinkInitiatedDynamodb.policies,
		// readTierSnapshot HEAD-checks tier-0 source when logging the crawl outcome.
		...contentBucket.readPolicies("recrawl-link-initiated-content-read"),
		...contentBucket.writePolicies("recrawl-link-initiated-s3"),
		...renamePolicies(generateSummaryQueue.policies, "recrawl-link-initiated"),
	],
});

eventBus.grantPublish(recrawlLinkInitiatedLambda);

const recrawlLinkInitiatedLambdaWithSQS = new HutchSQSBackedLambda("recrawl-link-initiated", {
	lambda: recrawlLinkInitiatedLambda,
	queue: recrawlLinkInitiatedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(RecrawlLinkInitiatedEvent, recrawlLinkInitiatedLambdaWithSQS);

// --- RecrawlContentExtracted handler ---
// Always dispatches GenerateSummaryCommand regardless of canonical change —
// recrawl is the operator opting out of the user-save dedup gate.

const recrawlContentExtractedDynamodb = new HutchDynamoDBAccess("recrawl-content-extracted-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const recrawlContentExtractedLambda = new HutchLambda("recrawl-content-extracted", {
			entryPoint: "./src/runtime/recrawl-content-extracted.main.ts",
		outputDir: ".lib/recrawl-content-extracted",
		assetDir: "./src",
		// 3008 MB (this AWS account's Lambda memory ceiling — the 10240 MB
		// platform max needs a quota increase AWS rejected with a 3008 cap):
		// this finalize handler loads the full tier-source HTML from S3, so a
		// page carrying many MB of inline base64 images OOM'd at 256 MB.
	memorySize: 3008,
	timeout: SELECT_CONTENT_TIMEOUTS.lambdaSeconds,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		DEEPSEEK_API_KEY: deepseekApiKey,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...recrawlContentExtractedDynamodb.policies,
		...contentBucket.readPolicies("recrawl-content-extracted-content-read"),
		...contentBucket.writePolicies("recrawl-content-extracted-content-write"),
		...renamePolicies(generateSummaryQueue.policies, "recrawl"),
	],
});

eventBus.grantPublish(recrawlContentExtractedLambda);

const recrawlContentExtractedLambdaWithSQS = new HutchSQSBackedLambda("recrawl-content-extracted", {
	lambda: recrawlContentExtractedLambda,
	queue: recrawlContentExtractedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(RecrawlContentExtractedEvent, recrawlContentExtractedLambdaWithSQS);

// --- SummaryGenerated handler ---

const summaryGeneratedLambda = new HutchLambda("summary-generated", {
	entryPoint: "./src/runtime/summary-generated.main.ts",
	outputDir: ".lib/summary-generated",
	assetDir: "./src",
	memorySize: 128,
	timeout: 10,
	environment: {},
	policies: [],
});

const summaryGeneratedLambdaWithSQS = new HutchSQSBackedLambda("summary-generated", {
	lambda: summaryGeneratedLambda,
	queue: summaryGeneratedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SummaryGeneratedEvent, summaryGeneratedLambdaWithSQS);

// --- SummaryGenerationFailed handler ---

const summaryGenerationFailedLambda = new HutchLambda(SAVE_LINK_LAMBDA_NAMES.summaryGenerationFailed, {
	priorLogGroupLogicalName: "summaryGenerationFailed-log-group",
	entryPoint: "./src/runtime/summary-generation-failed.main.ts",
	outputDir: ".lib/summary-generation-failed",
	assetDir: "./src",
	memorySize: 128,
	timeout: 10,
	environment: {},
	policies: [],
});

const summaryGenerationFailedLambdaWithSQS = new HutchSQSBackedLambda("summary-generation-failed", {
	lambda: summaryGenerationFailedLambda,
	queue: summaryGenerationFailedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(SummaryGenerationFailedEvent, summaryGenerationFailedLambdaWithSQS);

// --- RefreshArticleContent handler ---
// Writes the freshly-fetched HTML as a tier-1 source and publishes
// RefreshContentExtractedEvent; the selector + transition step lives in the
// refresh-content-extracted handler below (same shape as the recrawl path).

const refreshArticleContentQueue = new HutchSQS("refresh-article-content", {
	visibilityTimeoutSeconds: 60,
});

const refreshArticleContentLambda = new HutchLambda("refresh-article-content", {
	entryPoint: "./src/runtime/refresh-article-content.main.ts",
	outputDir: ".lib/refresh-article-content",
	assetDir: "./src",
	// Bumped 256→512 MB: handler now holds the S3 GetObject buffer (the refreshed
	// HTML staged under refresh-html/) plus the same bytes passed to putTierSource.
	memorySize: 512,
	timeout: 30,
	environment: {
		EVENT_BUS_NAME: eventBus.eventBusName,
		CONTENT_BUCKET_NAME: contentBucketName,
		PENDING_HTML_BUCKET_NAME: pendingHtmlBucketName,
	},
	policies: [
		...contentBucket.writePolicies("refresh-article-content-content-write"),
		...pendingHtmlBucket.readPolicies("refresh-article-content-refresh-html"),
	],
});

eventBus.grantPublish(refreshArticleContentLambda);

const refreshArticleContentWithSQS = new HutchSQSBackedLambda("refresh-article-content", {
	lambda: refreshArticleContentLambda,
	queue: refreshArticleContentQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(RefreshArticleContentCommand, refreshArticleContentWithSQS);

// --- RefreshContentExtracted handler ---

const refreshContentExtractedQueue = new HutchSQS("refresh-content-extracted", {
	visibilityTimeoutSeconds: SELECT_CONTENT_TIMEOUTS.sqsVisibilitySeconds,
});

const refreshContentExtractedDynamodb = new HutchDynamoDBAccess("refresh-content-extracted-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const refreshContentExtractedLambda = new HutchLambda("refresh-content-extracted", {
			entryPoint: "./src/runtime/refresh-content-extracted.main.ts",
		outputDir: ".lib/refresh-content-extracted",
		assetDir: "./src",
		// 3008 MB (this AWS account's Lambda memory ceiling — the 10240 MB
		// platform max needs a quota increase AWS rejected with a 3008 cap):
		// this finalize handler loads the full tier-source HTML from S3, so a
		// page carrying many MB of inline base64 images OOM'd at 256 MB.
	memorySize: 3008,
	timeout: SELECT_CONTENT_TIMEOUTS.lambdaSeconds,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		DEEPSEEK_API_KEY: deepseekApiKey,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	policies: [
		...refreshContentExtractedDynamodb.policies,
		...contentBucket.readPolicies("refresh-content-extracted-content-read"),
		...contentBucket.writePolicies("refresh-content-extracted-content-write"),
		...renamePolicies(generateSummaryQueue.policies, "refresh-content-extracted"),
	],
});

eventBus.grantPublish(refreshContentExtractedLambda);

const refreshContentExtractedLambdaWithSQS = new HutchSQSBackedLambda("refresh-content-extracted", {
	lambda: refreshContentExtractedLambda,
	queue: refreshContentExtractedQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(RefreshContentExtractedEvent, refreshContentExtractedLambdaWithSQS);

// --- UpdateFetchTimestamp handler ---

const updateFetchTimestampQueue = new HutchSQS("update-fetch-timestamp", {
	visibilityTimeoutSeconds: 60,
});

const updateFetchTimestampDynamodb = new HutchDynamoDBAccess("update-fetch-timestamp-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:UpdateItem"],
});

const updateFetchTimestampLambda = new HutchLambda("update-fetch-timestamp", {
	entryPoint: "./src/runtime/update-fetch-timestamp.main.ts",
	outputDir: ".lib/update-fetch-timestamp",
	assetDir: "./src",
	memorySize: 128,
	timeout: 10,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
	},
	policies: [
		...updateFetchTimestampDynamodb.policies,
	],
});

const updateFetchTimestampWithSQS = new HutchSQSBackedLambda("update-fetch-timestamp", {
	lambda: updateFetchTimestampLambda,
	queue: updateFetchTimestampQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(UpdateFetchTimestampCommand, updateFetchTimestampWithSQS);

// --- Exports ---

export const saveLinkCommandQueueUrl = saveLinkCommandQueue.queueUrl;
export const saveLinkCommandDlqUrl = saveLinkCommandQueue.dlqUrl;
export const saveAnonymousLinkCommandQueueUrl = saveAnonymousLinkCommandQueue.queueUrl;
export const saveAnonymousLinkCommandDlqUrl = saveAnonymousLinkCommandQueue.dlqUrl;
export const saveLinkRawHtmlCommandQueueUrl = saveLinkRawHtmlCommandQueue.queueUrl;
export const saveLinkRawHtmlCommandDlqUrl = saveLinkRawHtmlCommandQueue.dlqUrl;
export const saveLinkRawPdfCommandQueueUrl = saveLinkRawPdfCommandQueue.queueUrl;
export const saveLinkRawPdfCommandDlqUrl = saveLinkRawPdfCommandQueue.dlqUrl;
export const simpleCrawlUnsupportedPolicyQueueUrl = simpleCrawlUnsupportedPolicyQueue.queueUrl;
export const simpleCrawlUnsupportedPolicyDlqUrl = simpleCrawlUnsupportedPolicyQueue.dlqUrl;
export const comprehensiveCrawlCommandQueueUrl = comprehensiveCrawlCommandQueue.queueUrl;
export const comprehensiveCrawlCommandDlqUrl = comprehensiveCrawlCommandQueue.dlqUrl;
export const linkSavedQueueUrl = linkSavedQueue.queueUrl;
export const linkSavedDlqUrl = linkSavedQueue.dlqUrl;
export const anonymousLinkSavedQueueUrl = anonymousLinkSavedQueue.queueUrl;
export const anonymousLinkSavedDlqUrl = anonymousLinkSavedQueue.dlqUrl;
export const canonicalContentChangedQueueUrl = canonicalContentChangedQueue.queueUrl;
export const canonicalContentChangedDlqUrl = canonicalContentChangedQueue.dlqUrl;
export const generateSummaryQueueUrl = generateSummaryQueue.queueUrl;
export const generateSummaryDlqUrl = generateSummaryQueue.dlqUrl;
export const summaryGeneratedQueueUrl = summaryGeneratedQueue.queueUrl;
export const summaryGeneratedDlqUrl = summaryGeneratedQueue.dlqUrl;
export const summaryGenerationFailedQueueUrl = summaryGenerationFailedQueue.queueUrl;
export const summaryGenerationFailedDlqUrl = summaryGenerationFailedQueue.dlqUrl;
export const refreshArticleContentQueueUrl = refreshArticleContentQueue.queueUrl;
export const refreshArticleContentDlqUrl = refreshArticleContentQueue.dlqUrl;
export const updateFetchTimestampQueueUrl = updateFetchTimestampQueue.queueUrl;
export const updateFetchTimestampDlqUrl = updateFetchTimestampQueue.dlqUrl;
export const selectMostCompleteContentQueueUrl = selectMostCompleteContentQueue.queueUrl;
export const selectMostCompleteContentDlqUrl = selectMostCompleteContentQueue.dlqUrl;
export const recrawlLinkInitiatedQueueUrl = recrawlLinkInitiatedQueue.queueUrl;
export const recrawlLinkInitiatedDlqUrl = recrawlLinkInitiatedQueue.dlqUrl;
export const recrawlContentExtractedQueueUrl = recrawlContentExtractedQueue.queueUrl;
export const recrawlContentExtractedDlqUrl = recrawlContentExtractedQueue.dlqUrl;
export const removeMyContentCommandQueueUrl = removeMyContentCommandQueue.queueUrl;
export const removeMyContentCommandDlqUrl = removeMyContentCommandQueue.dlqUrl;
export const reselectAfterRemovalQueueUrl = reselectAfterRemovalQueue.queueUrl;
export const reselectAfterRemovalDlqUrl = reselectAfterRemovalQueue.dlqUrl;
export const staleCheckRequestedQueueUrl = staleCheckRequestedQueue.queueUrl;
export const staleCheckRequestedDlqUrl = staleCheckRequestedQueue.dlqUrl;
export const contentBucketOutputName = contentBucket.bucket;
export const contentBucketOutputArn = contentBucket.arn;
