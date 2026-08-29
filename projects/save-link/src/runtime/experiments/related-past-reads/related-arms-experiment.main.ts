import assert from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CloudWatchLogsClient,
	CreateLogStreamCommand,
	PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { initCreateDeepseekMessage } from "@packages/ai-message";
import { initDynamoDbRelatedArticles } from "@packages/article-store";
import {
	EXPERIMENT_RESULT_STREAM,
	RELATED_PAST_READS_EXPERIMENT,
	type ExperimentArmResultEvent,
} from "@packages/hutch-infra-components";
import {
	NEXT_READ_MINIMUM_SAVES,
	hasEnoughSavesForNextRead,
} from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { UserIdSchema, normalizeEmail } from "@packages/domain/user";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	batchGetFromTable,
	createDynamoDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import type {
	RelatedArticleLink,
	RelatedCandidate,
} from "@packages/provider-contracts/related-articles";
import { getEnv, requireEnv } from "@packages/require-env";
import OpenAI from "openai";
import { z } from "zod";
import {
	RELATED_CANDIDATES_MAX,
	RELATED_CANDIDATE_TEXT_MAX_CHARS,
	RELATED_MAX_OUTPUT_TOKENS,
	RELATED_REASON_MAX_CHARS,
	RELATED_RESULTS_MAX,
} from "../../domain/related-articles/related-articles-limits";
import type { RelatedArticleTarget } from "../../domain/related-articles/related-articles-selector";
import { initSelectRelatedArticles } from "../../domain/related-articles/related-articles-selector";
import { RELATED_ARTICLES_TIMEOUTS } from "../../domain/related-articles/timeouts";

const logger = HutchLogger.from(consoleLogger);

const EXPERIMENT_TIMEOUT_MS = 600_000;
const DEFAULT_ANCHOR_COUNT = 6;
const DEEPSEEK_INPUT_USD_PER_MTOK = 0.28;
const DEEPSEEK_OUTPUT_USD_PER_MTOK = 0.42;

const BASELINE_PROMPT = readFileSync(
	join(__dirname, "arm-b-production-baseline-prompt.md"),
	"utf-8",
)
	.replace("{{RELATED_RESULTS_MAX}}", String(RELATED_RESULTS_MAX))
	.replace("{{RELATED_REASON_MAX_CHARS}}", String(RELATED_REASON_MAX_CHARS));

const STATIC_CREDENTIAL_VARS = [
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
] as const;

const awsProfile = requireEnv("AWS_PROFILE");
assert(
	awsProfile === "hutch-production",
	`AWS_PROFILE must be hutch-production to read the real account, got ${awsProfile}`,
);
for (const name of STATIC_CREDENTIAL_VARS) {
	assert(
		getEnv(name) === undefined,
		`${name} must be unset: static credentials take precedence over AWS_PROFILE and would silently read staging`,
	);
}

const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
const deepseekApiKey = requireEnv("DEEPSEEK_API_KEY");
const accountEmail = requireEnv("RELATED_ARMS_USER_EMAIL");
const anchorUrlOverride = getEnv("RELATED_ARMS_ANCHOR_URLS");
const repeats = Number(getEnv("RELATED_ARMS_REPEATS") ?? "1");
assert(
	Number.isInteger(repeats) && repeats >= 1,
	`RELATED_ARMS_REPEATS must be a positive integer, got ${repeats}`,
);

const dynamoClient = createDynamoDocumentClient();

const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: EXPERIMENT_TIMEOUT_MS,
});

const createMessage = initCreateDeepseekMessage({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
});

const { selectRelatedArticles } = initSelectRelatedArticles({ createMessage, logger });

const {
	findRelatedCandidateArticles,
	findRelatedReadCandidateArticles,
	findRelatedTargetArticle,
} = initDynamoDbRelatedArticles({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
});

const UserRow = z.object({ email: z.string(), userId: UserIdSchema });
const users = defineDynamoTable({
	client: dynamoClient,
	tableName: usersTable,
	schema: UserRow,
});

const SavedRow = z.looseObject({ url: z.string(), status: z.string() });
const userArticles = defineDynamoTable({
	client: dynamoClient,
	tableName: userArticlesTable,
	schema: SavedRow,
});

const ArticleUrlRow = z.looseObject({ url: z.string() });

async function resolveUserId(): Promise<UserId> {
	const row = await users.get(
		{ email: normalizeEmail(accountEmail) },
		{ projection: ["email", "userId"] },
	);
	assert(row, `no account in ${usersTable} for ${accountEmail}`);
	return row.userId;
}

interface Anchor {
	url: string;
	key: string;
	status: string;
	target: RelatedArticleTarget;
}

async function newestSavedKeys(userId: UserId, wanted: number): Promise<
	Array<{ key: string; status: string }>
> {
	const rows: Array<{ key: string; status: string }> = [];
	let exclusiveStartKey: Record<string, unknown> | undefined;
	do {
		const { items, lastEvaluatedKey } = await userArticles.query({
			IndexName: "userId-savedAt-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
			ScanIndexForward: false,
			ExclusiveStartKey: exclusiveStartKey,
		});
		for (const item of items) {
			if (rows.length >= wanted) break;
			rows.push({ key: item.url, status: item.status });
		}
		exclusiveStartKey = lastEvaluatedKey;
	} while (exclusiveStartKey && rows.length < wanted);
	return rows;
}

async function originalUrlsFor(keys: string[]): Promise<Map<string, string>> {
	const rows = await batchGetFromTable({
		client: dynamoClient,
		tableName: articlesTable,
		schema: ArticleUrlRow,
		keys: keys.map((url) => ({ url })),
		projection: ["url", "originalUrl"],
	});
	const byKey = new Map<string, string>();
	for (const row of rows) {
		const originalUrl = row.originalUrl;
		if (typeof originalUrl !== "string") continue;
		byKey.set(row.url, originalUrl);
	}
	return byKey;
}

async function anchorFor(input: {
	url: string;
	key: string;
	status: string;
}): Promise<Anchor | undefined> {
	const lookup = await findRelatedTargetArticle(input.url);
	if (lookup.state !== "found") return undefined;
	const target = lookup.article;
	if (target.crawlStatus === "pending") return undefined;
	if (target.hasStubMetadata) return undefined;
	return {
		url: input.url,
		key: input.key,
		status: input.status,
		target: {
			title: target.title,
			siteName: target.siteName,
			description: target.description,
		},
	};
}

async function resolveAnchors(userId: UserId): Promise<Anchor[]> {
	if (anchorUrlOverride) {
		const urls = anchorUrlOverride
			.split(",")
			.map((url) => url.trim())
			.filter((url) => url.length > 0);
		const anchors: Anchor[] = [];
		for (const url of urls) {
			const anchor = await anchorFor({ url, key: url, status: "override" });
			assert(anchor, `RELATED_ARMS_ANCHOR_URLS names an unusable article: ${url}`);
			anchors.push(anchor);
		}
		return anchors;
	}

	const anchors: Anchor[] = [];
	const scanned = await newestSavedKeys(userId, DEFAULT_ANCHOR_COUNT * 6);
	const byKey = await originalUrlsFor(scanned.map((row) => row.key));
	for (const row of scanned) {
		if (anchors.length >= DEFAULT_ANCHOR_COUNT) break;
		const url = byKey.get(row.key);
		if (!url) continue;
		const anchor = await anchorFor({ url, key: row.key, status: row.status });
		if (!anchor) continue;
		anchors.push(anchor);
	}
	assert(
		anchors.length > 0,
		`no usable anchor among the ${scanned.length} newest saves for ${accountEmail}`,
	);
	return anchors;
}

function clip(text: string, maxLength: number): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLength) return collapsed;
	const slice = collapsed.slice(0, maxLength - 1);
	const lastSpace = slice.lastIndexOf(" ");
	const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trimEnd()}…`;
}

function describe(article: RelatedArticleTarget | RelatedCandidate): string {
	return [
		`Title: ${clip(article.title, RELATED_CANDIDATE_TEXT_MAX_CHARS)}`,
		`Site: ${clip(article.siteName, RELATED_CANDIDATE_TEXT_MAX_CHARS)}`,
		`About: ${clip(article.description, RELATED_CANDIDATE_TEXT_MAX_CHARS)}`,
	].join("\n");
}

const RelatedPayload = z.object({
	related: z.array(z.object({ index: z.number().int(), reason: z.string() })),
});

interface CallOutcome {
	related: RelatedArticleLink[];
	inputTokens: number;
	outputTokens: number;
	rawText: string;
}

async function runBaselineUnreadCall(params: {
	target: RelatedArticleTarget;
	candidates: readonly RelatedCandidate[];
}): Promise<CallOutcome> {
	const candidateBlocks = params.candidates.map(
		(candidate, index) => `[${index}]\n${describe(candidate)}`,
	);
	const message = [
		"SAVED ARTICLE",
		describe(params.target),
		"",
		"CANDIDATES",
		...candidateBlocks,
	].join("\n");

	const response = await createMessage({
		max_tokens: RELATED_MAX_OUTPUT_TOKENS,
		system: BASELINE_PROMPT,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "document",
						source: { type: "text", media_type: "text/plain", data: message },
						title: "Saved article and candidate earlier saves",
						citations: { enabled: false },
					},
				],
			},
		],
	});

	const textBlock = response.content.find((block) => block.type === "text");
	const rawText = textBlock?.text ?? "";
	assert(rawText, "the baseline call answered with no text block");

	const parsed = RelatedPayload.parse(JSON.parse(rawText));
	const seen = new Set<number>();
	const related: RelatedArticleLink[] = [];
	for (const entry of parsed.related) {
		if (related.length >= RELATED_RESULTS_MAX) break;
		const candidate = params.candidates[entry.index];
		if (!candidate) continue;
		if (seen.has(entry.index)) continue;
		seen.add(entry.index);
		related.push({
			url: candidate.url,
			reason: clip(entry.reason, RELATED_REASON_MAX_CHARS),
		});
	}
	return {
		related,
		inputTokens: response.usage.input_tokens,
		outputTokens: response.usage.output_tokens,
		rawText,
	};
}

async function runSectionedCall(params: {
	target: RelatedArticleTarget;
	unreadCandidates: readonly RelatedCandidate[];
	readCandidates: readonly RelatedCandidate[];
}): Promise<CallOutcome> {
	const result = await selectRelatedArticles(params);
	assert(result.kind === "ready", "the sectioned call answered with no text block");
	return {
		related: result.related,
		inputTokens: result.inputTokens,
		outputTokens: result.outputTokens,
		rawText: JSON.stringify(result.related),
	};
}

interface RecordedCall extends CallOutcome {
	label: string;
	unreadCount: number;
	readCount: number;
	durationMs: number;
	overProductionTimeout: boolean;
	error?: string;
}

async function record(
	label: string,
	counts: { unreadCount: number; readCount: number },
	run: () => Promise<CallOutcome>,
): Promise<RecordedCall> {
	const startedAt = Date.now();
	try {
		const outcome = await run();
		const durationMs = Date.now() - startedAt;
		return {
			...outcome,
			...counts,
			label,
			durationMs,
			overProductionTimeout: durationMs > RELATED_ARTICLES_TIMEOUTS.deepseekMs,
		};
	} catch (error) {
		const durationMs = Date.now() - startedAt;
		return {
			label,
			...counts,
			related: [],
			inputTokens: 0,
			outputTokens: 0,
			rawText: "",
			durationMs,
			overProductionTimeout: durationMs > RELATED_ARTICLES_TIMEOUTS.deepseekMs,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

interface ArmResult {
	arm: "A" | "B" | "C";
	description: string;
	calls: RecordedCall[];
	effective: RelatedArticleLink[];
}

async function runArmA(
	anchor: Anchor,
	pools: { unread: readonly RelatedCandidate[]; read: readonly RelatedCandidate[] },
): Promise<ArmResult> {
	const unreadCandidates = pools.unread.slice(0, RELATED_CANDIDATES_MAX);
	const readCandidates = pools.read.slice(
		0,
		Math.max(0, RELATED_CANDIDATES_MAX - unreadCandidates.length),
	);
	const call = await record(
		"single",
		{ unreadCount: unreadCandidates.length, readCount: readCandidates.length },
		() => runSectionedCall({ target: anchor.target, unreadCandidates, readCandidates }),
	);
	return {
		arm: "A",
		description: `one call, ${RELATED_CANDIDATES_MAX} candidates shared between both pools`,
		calls: [call],
		effective: call.related,
	};
}

async function runArmB(
	anchor: Anchor,
	pools: { unread: readonly RelatedCandidate[]; read: readonly RelatedCandidate[] },
): Promise<ArmResult> {
	const unreadCandidates = pools.unread.slice(0, RELATED_CANDIDATES_MAX);
	const readCandidates = pools.read.slice(0, RELATED_CANDIDATES_MAX);
	const unreadCall = await record(
		"unread (production baseline)",
		{ unreadCount: unreadCandidates.length, readCount: 0 },
		() => runBaselineUnreadCall({ target: anchor.target, candidates: unreadCandidates }),
	);
	const readCall = await record(
		"past reads",
		{ unreadCount: 0, readCount: readCandidates.length },
		() =>
			runSectionedCall({
				target: anchor.target,
				unreadCandidates: [],
				readCandidates,
			}),
	);
	return {
		arm: "B",
		description: `two calls, up to ${RELATED_CANDIDATES_MAX} candidates each`,
		calls: [unreadCall, readCall],
		effective: unreadCall.related.length > 0 ? unreadCall.related : readCall.related,
	};
}

async function runArmC(
	anchor: Anchor,
	pools: { unread: readonly RelatedCandidate[]; read: readonly RelatedCandidate[] },
): Promise<ArmResult> {
	const unreadCandidates = pools.unread.slice(0, RELATED_CANDIDATES_MAX);
	const readCandidates = pools.read.slice(0, RELATED_CANDIDATES_MAX);
	const call = await record(
		"single",
		{ unreadCount: unreadCandidates.length, readCount: readCandidates.length },
		() => runSectionedCall({ target: anchor.target, unreadCandidates, readCandidates }),
	);
	return {
		arm: "C",
		description: `one call, up to ${RELATED_CANDIDATES_MAX * 2} candidates`,
		calls: [call],
		effective: call.related,
	};
}

interface AnchorReport {
	anchor: { url: string; title: string; siteName: string; status: string };
	pools: { unreadUrls: string[]; readUrls: string[] };
	repeat: number;
	arms: ArmResult[];
}

function poolOf(url: string, readUrls: ReadonlySet<string>): "read" | "unread" {
	return readUrls.has(url) ? "read" : "unread";
}

function titleOf(url: string, byUrl: ReadonlyMap<string, RelatedCandidate>): string {
	return byUrl.get(url)?.title ?? url;
}

function tokensOf(arm: ArmResult): { input: number; output: number } {
	return arm.calls.reduce(
		(total, call) => ({
			input: total.input + call.inputTokens,
			output: total.output + call.outputTokens,
		}),
		{ input: 0, output: 0 },
	);
}

function usdOf(tokens: { input: number; output: number }): number {
	return (
		(tokens.input / 1_000_000) * DEEPSEEK_INPUT_USD_PER_MTOK +
		(tokens.output / 1_000_000) * DEEPSEEK_OUTPUT_USD_PER_MTOK
	);
}

function renderMarkdown(reports: AnchorReport[]): string {
	const lines: string[] = [
		"# Similar past reads — prompt arm comparison",
		"",
		`Account: \`${accountEmail}\``,
		`Anchors: ${reports.length} run(s) across ${new Set(reports.map((report) => report.anchor.url)).size} article(s)`,
		`Production DeepSeek timeout: ${RELATED_ARTICLES_TIMEOUTS.deepseekMs} ms`,
		"",
		"## Summary",
		"",
		"| Anchor | Repeat | Arm | Picks | Unread | Read | Input tokens | Output tokens | USD | Slowest call (ms) | Over production timeout |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	];

	for (const report of reports) {
		const readUrls = new Set(report.pools.readUrls);
		for (const arm of report.arms) {
			const tokens = tokensOf(arm);
			const slowest = Math.max(...arm.calls.map((call) => call.durationMs));
			const over = arm.calls.some((call) => call.overProductionTimeout);
			lines.push(
				`| ${report.anchor.title} | ${report.repeat} | ${arm.arm} | ${arm.effective.length} | ${arm.effective.filter((pick) => !readUrls.has(pick.url)).length} | ${arm.effective.filter((pick) => readUrls.has(pick.url)).length} | ${tokens.input} | ${tokens.output} | ${usdOf(tokens).toFixed(4)} | ${slowest} | ${over ? "YES" : "no"} |`,
			);
		}
	}

	return `${lines.join("\n")}\n`;
}

function renderAnchorSection(
	report: AnchorReport,
	byUrl: ReadonlyMap<string, RelatedCandidate>,
): string {
	const readUrls = new Set(report.pools.readUrls);
	const lines: string[] = [
		"",
		`## ${report.anchor.title}`,
		"",
		`- URL: ${report.anchor.url}`,
		`- Site: ${report.anchor.siteName}`,
		`- Reader status: ${report.anchor.status}`,
		`- Pools: ${report.pools.unreadUrls.length} unread, ${report.pools.readUrls.length} read`,
		`- Repeat: ${report.repeat}`,
	];

	for (const arm of report.arms) {
		lines.push("", `### Arm ${arm.arm} — ${arm.description}`, "");
		for (const call of arm.calls) {
			lines.push(
				`- Call \`${call.label}\`: ${call.unreadCount} unread + ${call.readCount} read, ${call.inputTokens} in / ${call.outputTokens} out, ${call.durationMs} ms${call.overProductionTimeout ? " **OVER PRODUCTION TIMEOUT**" : ""}${call.error ? ` — FAILED: ${call.error}` : ""}`,
			);
			if (call.related.length > 0) {
				lines.push("", "| Pool | Pick | Reason |", "| --- | --- | --- |");
				for (const pick of call.related) {
					lines.push(
						`| ${poolOf(pick.url, readUrls)} | ${titleOf(pick.url, byUrl)} | ${pick.reason} |`,
					);
				}
				lines.push("");
			}
		}
		lines.push("", "Effective result:", "");
		if (arm.effective.length === 0) {
			lines.push("- (nothing)");
		}
		for (const pick of arm.effective) {
			lines.push(
				`- [${poolOf(pick.url, readUrls)}] ${titleOf(pick.url, byUrl)} — ${pick.reason}`,
			);
		}
	}

	return lines.join("\n");
}

function armResultEvents(
	runId: string,
	reports: AnchorReport[],
): ExperimentArmResultEvent[] {
	const readUrlsByAnchor = new Map(
		reports.map((report) => [report.anchor.url, new Set(report.pools.readUrls)]),
	);
	const events: ExperimentArmResultEvent[] = [];
	for (const report of reports) {
		const readUrls = readUrlsByAnchor.get(report.anchor.url);
		assert(readUrls, "every report carries its own read pool");
		for (const arm of report.arms) {
			const tokens = tokensOf(arm);
			events.push({
				stream: EXPERIMENT_RESULT_STREAM,
				event: "arm-result",
				timestamp: new Date().toISOString(),
				experiment: RELATED_PAST_READS_EXPERIMENT,
				run_id: runId,
				arm: arm.arm,
				anchor_url: report.anchor.url,
				repeat: report.repeat,
				picks: arm.effective.length,
				unread_picks: arm.effective.filter((pick) => !readUrls.has(pick.url)).length,
				read_picks: arm.effective.filter((pick) => readUrls.has(pick.url)).length,
				unread_pool: report.pools.unreadUrls.length,
				read_pool: report.pools.readUrls.length,
				input_tokens: tokens.input,
				output_tokens: tokens.output,
				latency_ms: Math.max(...arm.calls.map((call) => call.durationMs)),
				over_production_timeout: arm.calls.some((call) => call.overProductionTimeout),
				failed: arm.calls.some((call) => call.error !== undefined),
			});
		}
	}
	return events;
}

/**
 * Writing into the production analytics group is a side effect on real business
 * history, so it is opt-in: a dry run leaves the account untouched and only the
 * local report is produced.
 */
async function publishArmResults(
	runId: string,
	reports: AnchorReport[],
): Promise<void> {
	if (getEnv("RELATED_ARMS_PUBLISH") !== "1") {
		logger.info("[related-arms] not published (set RELATED_ARMS_PUBLISH=1 to plot on the dashboard)");
		return;
	}

	const logGroupName = requireEnv("ANALYTICS_LOG_GROUP_NAME");
	const client = new CloudWatchLogsClient({});
	const logStreamName = `related-arms-experiment/${runId}`;
	await client.send(
		new CreateLogStreamCommand({ logGroupName, logStreamName }),
	);
	const events = armResultEvents(runId, reports);
	await client.send(
		new PutLogEventsCommand({
			logGroupName,
			logStreamName,
			logEvents: events.map((event) => ({
				timestamp: Date.parse(event.timestamp),
				message: JSON.stringify(event),
			})),
		}),
	);
	logger.info("[related-arms] published", { logGroupName, logStreamName, events: events.length });
}

async function main(): Promise<void> {
	const userId = await resolveUserId();
	logger.info("[related-arms] resolved account", { userId });

	const anchors = await resolveAnchors(userId);
	logger.info("[related-arms] anchors", {
		count: anchors.length,
		urls: anchors.map((anchor) => anchor.url),
	});

	const poolsByAnchor = new Map<
		string,
		{ unread: readonly RelatedCandidate[]; read: readonly RelatedCandidate[] }
	>();
	for (const anchor of anchors) {
		const [unread, read] = await Promise.all([
			findRelatedCandidateArticles({
				userId,
				excludeUrl: anchor.url,
				limit: RELATED_CANDIDATES_MAX,
			}),
			findRelatedReadCandidateArticles({
				userId,
				excludeUrl: anchor.url,
				limit: RELATED_CANDIDATES_MAX,
			}),
		]);
		poolsByAnchor.set(anchor.url, {
			unread: unread.candidates,
			read: read.candidates,
		});
		logger.info("[related-arms] pools", {
			url: anchor.url,
			unread: unread.candidates.length,
			read: read.candidates.length,
		});
	}

	const firstAnchor = anchors[0];
	assert(firstAnchor, "resolveAnchors returns at least one anchor");
	const firstPools = poolsByAnchor.get(firstAnchor.url);
	assert(firstPools, "every anchor has its pools fetched before any call");
	assert(
		hasEnoughSavesForNextRead(firstPools.read.length),
		`this account has only ${firstPools.read.length} past reads to compare against, below the ${NEXT_READ_MINIMUM_SAVES} the production gate needs — pick an account with more reading history before spending tokens`,
	);

	const reports: AnchorReport[] = [];
	const sections: string[] = [];

	for (let repeat = 1; repeat <= repeats; repeat += 1) {
		for (const anchor of anchors) {
			const pools = poolsByAnchor.get(anchor.url);
			assert(pools, "every anchor has its pools fetched before any call");
			const byUrl = new Map<string, RelatedCandidate>();
			for (const candidate of [...pools.unread, ...pools.read]) {
				byUrl.set(candidate.url, candidate);
			}

			logger.info("[related-arms] running arms", { url: anchor.url, repeat });
			const arms = [
				await runArmA(anchor, pools),
				await runArmB(anchor, pools),
				await runArmC(anchor, pools),
			];

			const report: AnchorReport = {
				anchor: {
					url: anchor.url,
					title: anchor.target.title,
					siteName: anchor.target.siteName,
					status: anchor.status,
				},
				pools: {
					unreadUrls: pools.unread.map((candidate) => candidate.url),
					readUrls: pools.read.map((candidate) => candidate.url),
				},
				repeat,
				arms,
			};
			reports.push(report);
			sections.push(renderAnchorSection(report, byUrl));
		}
	}

	const runId = new Date().toISOString().replace(/[:.]/g, "-");
	const outputDir = join(
		__dirname,
		"../../../../test-results/related-arms-experiment",
		runId,
	);
	mkdirSync(outputDir, { recursive: true });

	const markdown = `${renderMarkdown(reports)}${sections.join("\n")}\n`;
	writeFileSync(join(outputDir, "report.md"), markdown, "utf-8");
	writeFileSync(
		join(outputDir, "report.json"),
		JSON.stringify({ account: accountEmail, runId, reports }, null, 2),
		"utf-8",
	);

	await publishArmResults(runId, reports);

	const spent = reports
		.flatMap((report) => report.arms)
		.reduce(
			(total, arm) => {
				const tokens = tokensOf(arm);
				return {
					input: total.input + tokens.input,
					output: total.output + tokens.output,
				};
			},
			{ input: 0, output: 0 },
		);
	logger.info("[related-arms] done", {
		outputDir,
		inputTokens: spent.input,
		outputTokens: spent.output,
		estimatedUsd: usdOf(spent).toFixed(2),
	});
}

main().catch((error) => {
	logger.error("[related-arms] failed", { error });
	process.exitCode = 1;
});
