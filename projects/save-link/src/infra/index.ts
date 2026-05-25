import { readFileSync } from "node:fs";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import assert from "node:assert";
import { z } from "zod";
import {
	HutchEventBus,
	HutchLambda,
	HutchDynamoDBAccess,
	HutchDLQEventHandler,
	HutchSQS,
	HutchSQSBackedLambda,
	HutchS3ReadWrite,
	HutchS3ContentMediaCDN,
	type LambdaPolicy,
} from "@packages/hutch-infra-components/infra";
import {
	SaveLinkCommand,
	SaveAnonymousLinkCommand,
	SaveLinkRawHtmlCommand,
	SimpleCrawlUnsupportedEvent,
	ComprehensiveCrawlCommand,
	LinkSavedEvent,
	AnonymousLinkSavedEvent,
	StaleCheckRequestedEvent,
	SummaryGeneratedEvent,
	SummaryGenerationFailedEvent,
	RefreshArticleContentCommand,
	UpdateFetchTimestampCommand,
	TierContentExtractedEvent,
	RecrawlLinkInitiatedEvent,
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
} from "@packages/hutch-infra-components";
import { requireEnv } from "../require-env";
import { GENERATE_SUMMARY_TIMEOUTS } from "../runtime/domain/generate-summary/timeouts";
import { SELECT_CONTENT_TIMEOUTS } from "../runtime/domain/select-content/timeouts";

/* Pulumi requires unique resource names per stack. Two Lambdas that attach
 * the same shared queue's send-policy would collide on the policy's name,
 * so each callsite namespaces it with a per-Lambda prefix. */
function renamePolicies(
	policies: readonly LambdaPolicy[],
	prefix: string,
): LambdaPolicy[] {
	return policies.map((p) => ({ ...p, name: `${prefix}-${p.name}` }));
}

const config = new pulumi.Config();
const alertEmail = config.require("alertEmail");
const articlesTableName = config.require("articlesTableName");
const articlesTableArn = config.require("articlesTableArn");
const contentBucketName = config.require("contentBucketName");
const pendingHtmlBucketName = config.require("pendingHtmlBucketName");
const contentMediaCdnDomain = config.get("contentMediaCdnDomain");

/**
 * Image URIs for the OCR container Lambdas, written by `tools/build-image.mjs`
 * before `pulumi up` runs. The file is in .gitignore (`.lib/`) and recreated
 * on every deploy. If it's missing, the build step was skipped — re-run
 * `pnpm build-image` (or check CI ordering).
 */
const ocrImageTags = z
	.object({
		"comprehensive-crawl-command": z.string(),
		"pdf-page-ocr": z.string(),
	})
	.parse(JSON.parse(readFileSync(".lib/ocr-image-tags.json", "utf-8")));

// --- curl-impersonate Lambda Layer ---
// Contains the curl_chrome116 bash wrapper and the statically-linked
// curl-impersonate-chrome binary (BoringSSL embedded) that produce a Chrome
// TLS fingerprint, bypassing Akamai/Cloudflare JA3/JA4 blocks.
// Built by tools/build-curl-impersonate-layer.mjs before `pulumi up`.
const curlImpersonateLayer = new aws.lambda.LayerVersion("curl-impersonate", {
	layerName: "curl-impersonate-chrome",
	compatibleRuntimes: [aws.lambda.Runtime.NodeJS22dX],
	code: new pulumi.asset.FileArchive(".lib/curl-impersonate-layer.zip"),
	description: "curl-impersonate Chrome variant (curl_chrome116) for TLS fingerprint bypass",
});

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

const pendingHtmlBucket = new HutchS3ReadWrite("pending-html-bucket", {
	bucketName: pendingHtmlBucketName,
	expirationRules: [
		{
			id: "stage-html-expiry",
			expirationDays: 1,
			prefixes: ["pending-html/", "refresh-html/"],
		},
	],
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

const deepseekApiKey = pulumi.secret(requireEnv("DEEPSEEK_API_KEY"));
const deepInfraApiKey = pulumi.secret(requireEnv("DEEPINFRA_API_KEY"));

const eventBus = HutchEventBus.fromPlatformStack(config);

// --- Queues ---

const generateSummaryQueue = new HutchSQS("generate-summary", {
	visibilityTimeoutSeconds: GENERATE_SUMMARY_TIMEOUTS.sqsVisibilitySeconds,
});

const linkSavedQueue = new HutchSQS("link-saved", {
	visibilityTimeoutSeconds: 60,
});

// Simple-only crawl Lambda: HTML + oembed only, PDFs dispatched to the
// dedicated comprehensive-crawl-command Lambda. 240s timeout covers the
// worst HTML fetch + readability parse; 480s SQS visibility = 2× the
// Lambda timeout per AWS guidance.
const saveLinkCommandQueue = new HutchSQS("save-link-command", {
	visibilityTimeoutSeconds: 480,
});

// maxReceiveCount=1: SQS retries are removed for the anonymous save path.
// Auto-heal-on-view is gone (Plan 3.2): a failed save no longer reprimes when
// the user re-visits /view. The DLQ → SNS email alarm wired by HutchSQSBackedLambda
// is the operator's redrive signal, and /admin/recrawl is the manual retry.
// Other queues that aren't user-retriable (select-most-complete-content,
// generate-summary) keep the default maxReceiveCount=3 so transient
// Deepseek/DDB blips still self-heal at the SQS layer.
//
// Now simple-only — PDFs go through the comprehensive Lambda — so the
// timeout/visibility shrink to match save-link-command above.
const saveAnonymousLinkCommandQueue = new HutchSQS("save-anonymous-link-command", {
	visibilityTimeoutSeconds: 480,
	dlqMaxReceiveCount: 1,
});

const saveLinkRawHtmlCommandQueue = new HutchSQS("save-link-raw-html-command", {
	visibilityTimeoutSeconds: 480,
});

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
const recrawlLinkInitiatedQueue = new HutchSQS("recrawl-link-initiated", {
	visibilityTimeoutSeconds: 480,
});

// Simple-only — PDF refreshes dispatch the comprehensive-crawl-command with
// refresh=true so the comprehensive Lambda emits RefreshContentExtractedEvent.
const staleCheckRequestedQueue = new HutchSQS("stale-check-requested", {
	visibilityTimeoutSeconds: 480,
});

const recrawlContentExtractedQueue = new HutchSQS("recrawl-content-extracted", {
	visibilityTimeoutSeconds: SELECT_CONTENT_TIMEOUTS.sqsVisibilitySeconds,
});

// --- SaveLinkCommand handler ---

const saveLinkCommandDynamodb = new HutchDynamoDBAccess("save-link-command-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const saveLinkCommandLambda = new HutchLambda("save-link-command", {
	entryPoint: "./src/runtime/save-link-command.main.ts",
	outputDir: ".lib/save-link-command",
	assetDir: "./src",
	// Simple-only crawl: HTML/oembed text fetch + readability parse + media
	// download. PDFs are dispatched to the comprehensive-crawl-command Lambda
	// so this Lambda no longer needs the mupdf / OCR headroom.
	memorySize: 512,
	timeout: 240,
	layers: [curlImpersonateLayer.arn],
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

// --- SaveLinkCommand DLQ consumer ---
new HutchDLQEventHandler("save-link-dlq", {
	sourceQueue: saveLinkCommandQueue,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(generateSummaryQueue.policies, "save-link-dlq"),
});

// --- SaveLinkRawHtmlCommand handler ---

const saveLinkRawHtmlCommandDynamodb = new HutchDynamoDBAccess("save-link-raw-html-command-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const saveLinkRawHtmlCommandLambda = new HutchLambda("save-link-raw-html-command", {
	entryPoint: "./src/runtime/save-link-raw-html-command.main.ts",
	outputDir: ".lib/save-link-raw-html-command",
	assetDir: "./src",
	// Text-only path (readability/linkedom on large XHTML).
	// No canvas rendering or OCR, so less headroom than the OCR-capable Lambdas.
	memorySize: 512,
	timeout: 240,
	layers: [curlImpersonateLayer.arn],
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
		// Worker writes sources/tier-0.html + sidecar; the select-content Lambda
		// owns canonical reads/writes and the Deepseek selector contest.
		// readTierSnapshot HEAD-checks tier-0 source when logging the crawl outcome.
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

// --- SaveLinkRawHtmlCommand DLQ consumer ---
new HutchDLQEventHandler("save-link-raw-html-dlq", {
	sourceQueue: saveLinkRawHtmlCommandQueue,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(generateSummaryQueue.policies, "save-link-raw-html-dlq"),
});

// --- SaveAnonymousLinkCommand handler ---

const saveAnonymousLinkCommandDynamodb = new HutchDynamoDBAccess("save-anonymous-link-command-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const saveAnonymousLinkCommandLambda = new HutchLambda("save-anonymous-link-command", {
	entryPoint: "./src/runtime/save-anonymous-link-command.main.ts",
	outputDir: ".lib/save-anonymous-link-command",
	assetDir: "./src",
	// Mirrors save-link-command (simple-only) — PDFs dispatched out.
	memorySize: 512,
	timeout: 240,
	layers: [curlImpersonateLayer.arn],
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

// --- SaveAnonymousLinkCommand DLQ consumer ---
new HutchDLQEventHandler("save-anonymous-link-dlq", {
	sourceQueue: saveAnonymousLinkCommandQueue,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(generateSummaryQueue.policies, "save-anonymous-link-dlq"),
});

// --- SimpleCrawlUnsupported policy ---
// Event-to-command reactor: subscribes to `SimpleCrawlUnsupportedEvent`
// (emitted by the save-link Lambdas when the simple crawl bails on non-HTML)
// and dispatches `ComprehensiveCrawlCommand` to the dedicated PDF-handling
// Lambda. This intermediate event decouples the Command → Command dispatch
// that would otherwise violate the Command → System → Event(s) pattern.
// 60s visibility = 2× the 30s Lambda timeout.
const simpleCrawlUnsupportedPolicyQueue = new HutchSQS("simple-crawl-unsupported-policy", {
	visibilityTimeoutSeconds: 60,
});

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

// --- SimpleCrawlUnsupported policy DLQ consumer ---
// Flips crawlStatus to "exhausted" when the policy Lambda exhausts its
// maxReceiveCount. The article is stuck at `comprehensive-fetching` because
// the policy never managed to dispatch ComprehensiveCrawlCommand.
new HutchDLQEventHandler("simple-crawl-unsupported-policy-dlq", {
	sourceQueue: simpleCrawlUnsupportedPolicyQueue,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(generateSummaryQueue.policies, "simple-crawl-unsupported-policy-dlq"),
});

// --- PDF page OCR Lambda (sync-invoked) ---
// Per-page OCR worker fanned out from comprehensive-crawl-command. The
// orchestrator stages the source PDF to S3, then sync-invokes this Lambda
// for each page; each invocation downloads the staged PDF, rasterises its
// assigned page via pdftoppm `-f N -l N`, sends the PNG to DeepInfra vision,
// and returns the HTML fragment. Wall-time collapses to ~max(per_page) +
// dispatch overhead instead of summing the sequential rasterisation cost.
//
// No HutchSQSBackedLambda wrapper / no DLQ on this Lambda: it is a
// synchronous request/response Lambda (the documented exception in
// .claude/skills/infrastructure-design/SKILL.md). The orchestrator is the
// queue analogue — per-page failures propagate to the orchestrator's catch,
// which fails the SQS record so comprehensive-crawl-command-dlq captures the
// whole-job failure with the existing alarm + DLQ row-mutator semantics.
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
	// 1769 MB lands one vCPU per Lambda for CPU-bound pdftoppm. 900 s
	// timeout is AWS Lambda's hard ceiling — overprovisioned versus the
	// SDK config in pdf-page-ocr.main.ts (timeout=400s, maxRetries=0) and
	// the observed DeepInfra server-side cap of ~302s, but the headroom is
	// free (Lambda is billed on actual execution time, not configured
	// timeout) and covers cases where successful vision calls run up to
	// the SDK ceiling, S3 download, pdftoppm rasterisation, the text-
	// layer fallback path, HTML stitching, and serialisation.
	memorySize: 1769,
	timeout: 900,
	containerImage: { imageUri: ocrImageTags["pdf-page-ocr"] },
	environment: {
		CONTENT_BUCKET_NAME: contentBucketName,
		DEEPINFRA_API_KEY: deepInfraApiKey,
	},
	// Narrowly-scoped S3 read so the page Lambda can only fetch from the
	// staging prefix — never tier sources, snapshots, or images.
	policies: [pdfPageOcrStagingRead],
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
const comprehensiveCrawlCommandQueue = new HutchSQS("comprehensive-crawl-command", {
	visibilityTimeoutSeconds: 1800,
	dlqMaxReceiveCount: 1,
});

const comprehensiveCrawlCommandDynamodb = new HutchDynamoDBAccess("comprehensive-crawl-command-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const comprehensiveCrawlCommandInvokePageOcr: LambdaPolicy = {
	name: "comprehensive-crawl-command-invoke-page-ocr",
	policy: pdfPageOcrLambda.arn.apply((arn) => JSON.stringify({
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

const comprehensiveCrawlCommandLambda = new HutchLambda("comprehensive-crawl-command", {
	// Post-fan-out the orchestrator only runs pdfinfo, one S3 PutObject, up to
	// 32 concurrent JSON Lambda responses, HTML join + sanitisation, and one
	// tier-write — same workload shape as the simple-only save-link Lambdas at
	// 512 MB. Timeout stays at the Lambda 900 s ceiling so a 200-page PDF with
	// concurrency=32 still fits its worst-case ⌈pages/concurrency⌉ batches.
	memorySize: 512,
	timeout: 900,
	containerImage: { imageUri: ocrImageTags["comprehensive-crawl-command"] },
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
		PDF_PAGE_OCR_FUNCTION_NAME: pdfPageOcrLambda.functionName,
	},
	policies: [
		...comprehensiveCrawlCommandDynamodb.policies,
		// readTierSnapshot HEAD-checks tier-0 source when logging the crawl outcome.
		...contentBucket.readPolicies("comprehensive-crawl-command-content-read"),
		...contentBucket.writePolicies("comprehensive-crawl-command-s3"),
		comprehensiveCrawlCommandStagingDelete,
		comprehensiveCrawlCommandInvokePageOcr,
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

// --- ComprehensiveCrawlCommand DLQ consumer ---
// Mirrors save-link-dlq: flips crawlStatus to "exhausted" and publishes
// CrawlArticleFailedEvent when a comprehensive-crawl-command message exhausts
// maxReceiveCount on its queue. The entry point is derived from the component
// name, i.e. ./src/runtime/comprehensive-crawl-dlq.main.ts.
new HutchDLQEventHandler("comprehensive-crawl-dlq", {
	sourceQueue: comprehensiveCrawlCommandQueue,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(generateSummaryQueue.policies, "comprehensive-crawl-dlq"),
});

// --- StaleCheckRequested handler ---
// Background worker that runs the freshness/conditional-GET path that used to
// happen inline on /view. Reads freshness + crawl status from DDB; on a stale
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

const staleCheckRequestedLambda = new HutchLambda("stale-check-requested", {
	entryPoint: "./src/runtime/stale-check.main.ts",
	outputDir: ".lib/stale-check-requested",
	assetDir: "./src",
	// Simple-only crawl: HTML/oembed text fetch + readability parse. PDFs are
	// deferred through SimpleCrawlUnsupportedEvent → policy →
	// ComprehensiveCrawlCommand (refresh=true) so this Lambda no longer needs
	// the mupdf / OCR headroom.
	memorySize: 512,
	timeout: 240,
	layers: [curlImpersonateLayer.arn],
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
		PENDING_HTML_BUCKET_NAME: pendingHtmlBucketName,
	},
	policies: [
		...staleCheckRequestedDynamodb.policies,
		...renamePolicies(generateSummaryQueue.policies, "stale-check-requested"),
		// Stages the refreshed HTML under refresh-html/ before publishing
		// RefreshArticleContentCommand; consumer reads from the same bucket.
		...pendingHtmlBucket.writePolicies("stale-check-requested-refresh-html"),
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

const selectMostCompleteContentQueue = new HutchSQS("select-most-complete-content", {
	visibilityTimeoutSeconds: SELECT_CONTENT_TIMEOUTS.sqsVisibilitySeconds,
});

const selectMostCompleteContentDynamodb = new HutchDynamoDBAccess("select-most-complete-content-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const selectMostCompleteContentLambda = new HutchLambda("select-most-complete-content", {
	entryPoint: "./src/runtime/select-most-complete-content.main.ts",
	outputDir: ".lib/select-most-complete-content",
	assetDir: "./src",
	memorySize: 256,
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
		...renamePolicies(generateSummaryQueue.policies, "select-most-complete-content"),
	],
});

eventBus.grantPublish(selectMostCompleteContentLambda);

const selectMostCompleteContentLambdaWithSQS = new HutchSQSBackedLambda("select-most-complete-content", {
	lambda: selectMostCompleteContentLambda,
	queue: selectMostCompleteContentQueue,
	alertEmailDLQEntry: alertEmail,
	batchSize: 1,
});

eventBus.subscribe(TierContentExtractedEvent, selectMostCompleteContentLambdaWithSQS);

// --- SelectMostCompleteContent DLQ consumer ---
// Mirrors save-link-dlq: flips crawlStatus to "failed" and publishes
// CrawlArticleFailedEvent when a TierContentExtractedEvent message
// exhausts maxReceiveCount on the selector queue.
new HutchDLQEventHandler("select-most-complete-content-dlq", {
	sourceQueue: selectMostCompleteContentQueue,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(generateSummaryQueue.policies, "select-most-complete-content-dlq"),
});

// --- GenerateSummary handler ---

const generateSummaryDynamodb = new HutchDynamoDBAccess("generate-summary-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const generateSummaryLambda = new HutchLambda("generate-summary", {
	entryPoint: "./src/runtime/generate-summary.main.ts",
	outputDir: ".lib/generate-summary",
	assetDir: "./src",
	memorySize: 512,
	timeout: GENERATE_SUMMARY_TIMEOUTS.lambdaSeconds,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		DEEPSEEK_API_KEY: deepseekApiKey,
		EVENT_BUS_NAME: eventBus.eventBusName,
		CONTENT_BUCKET_NAME: contentBucketName,
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

// --- GenerateSummary DLQ consumer ---
// Flips the summaryStatus row to "failed" and publishes SummaryGenerationFailedEvent
// when a message lands in generate-summary-dlq. The entry point is derived from the
// component name, i.e. ./src/runtime/generate-summary-dlq.main.ts.
new HutchDLQEventHandler("generate-summary-dlq", {
	sourceQueue: generateSummaryQueue,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(generateSummaryQueue.policies, "generate-summary-dlq"),
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
		CONTENT_BUCKET_NAME: contentBucketName,
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
		CONTENT_BUCKET_NAME: contentBucketName,
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

// --- RecrawlLinkInitiated handler ---

const recrawlLinkInitiatedDynamodb = new HutchDynamoDBAccess("recrawl-link-initiated-dynamodb", {
	tables: [{ arn: articlesTableArn, includeIndexes: false }],
	actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
});

const recrawlLinkInitiatedLambda = new HutchLambda("recrawl-link-initiated", {
	entryPoint: "./src/runtime/recrawl-link-initiated.main.ts",
	outputDir: ".lib/recrawl-link-initiated",
	assetDir: "./src",
	// Mirrors save-link-command (simple-only) — PDF recrawls dispatch the
	// comprehensive-crawl-command with recrawl=true so the comprehensive
	// Lambda emits RecrawlContentExtractedEvent instead of TierContentExtracted.
	memorySize: 512,
	timeout: 240,
	layers: [curlImpersonateLayer.arn],
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

// --- RecrawlLinkInitiated DLQ consumer ---
new HutchDLQEventHandler("recrawl-link-initiated-dlq", {
	sourceQueue: recrawlLinkInitiatedQueue,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(generateSummaryQueue.policies, "recrawl-link-initiated-dlq"),
});

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
	memorySize: 256,
	timeout: SELECT_CONTENT_TIMEOUTS.lambdaSeconds,
	environment: {
		DYNAMODB_ARTICLES_TABLE: articlesTableName,
		CONTENT_BUCKET_NAME: contentBucketName,
		EVENT_BUS_NAME: eventBus.eventBusName,
		DEEPSEEK_API_KEY: deepseekApiKey,
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
		IMAGES_CDN_BASE_URL: contentMediaCdn.baseUrl,
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

// --- RecrawlContentExtracted DLQ consumer ---
new HutchDLQEventHandler("recrawl-content-extracted-dlq", {
	sourceQueue: recrawlContentExtractedQueue,
	tableArn: articlesTableArn,
	tableName: articlesTableName,
	eventBus,
	batchSize: 1,
	additionalDynamoActions: ["dynamodb:GetItem"],
	additionalEnvironment: {
		GENERATE_SUMMARY_QUEUE_URL: generateSummaryQueue.queueUrl,
	},
	additionalPolicies: renamePolicies(generateSummaryQueue.policies, "recrawl-content-extracted-dlq"),
});

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

const summaryGenerationFailedLambda = new HutchLambda("summary-generation-failed", {
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
	memorySize: 256,
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
export const simpleCrawlUnsupportedPolicyQueueUrl = simpleCrawlUnsupportedPolicyQueue.queueUrl;
export const simpleCrawlUnsupportedPolicyDlqUrl = simpleCrawlUnsupportedPolicyQueue.dlqUrl;
export const comprehensiveCrawlCommandQueueUrl = comprehensiveCrawlCommandQueue.queueUrl;
export const comprehensiveCrawlCommandDlqUrl = comprehensiveCrawlCommandQueue.dlqUrl;
export const linkSavedQueueUrl = linkSavedQueue.queueUrl;
export const linkSavedDlqUrl = linkSavedQueue.dlqUrl;
export const anonymousLinkSavedQueueUrl = anonymousLinkSavedQueue.queueUrl;
export const anonymousLinkSavedDlqUrl = anonymousLinkSavedQueue.dlqUrl;
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
export const staleCheckRequestedQueueUrl = staleCheckRequestedQueue.queueUrl;
export const staleCheckRequestedDlqUrl = staleCheckRequestedQueue.dlqUrl;
export const contentBucketOutputName = contentBucket.bucket;
export const contentBucketOutputArn = contentBucket.arn;
