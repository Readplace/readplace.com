import assert from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initCreateDeepseekMessage } from "@packages/ai-message";
import {
	initDynamoDbPastReads,
	initDynamoDbRelatedArticles,
} from "@packages/article-store";
import type { UserId } from "@packages/domain/user";
import { UserIdSchema, normalizeEmail } from "@packages/domain/user";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	batchGetFromTable,
	createDynamoDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import type {
	ReadlistReadCandidate,
	RelatedArticleLink,
} from "@packages/provider-contracts/related-articles";
import { getEnv, requireEnv } from "@packages/require-env";
import OpenAI from "openai";
import { z } from "zod";
import {
	RELATED_CANDIDATES_MAX,
	RELATED_REASON_MAX_CHARS,
} from "../../domain/related-articles/related-articles-limits";
import {
	type RelatedArticleTarget,
	initSelectRelatedArticles,
} from "../../domain/related-articles/related-articles-selector";
import { computePastReadsFingerprint } from "../../domain/related-articles/related-past-reads-fingerprint";
import { PAST_READS_PROMPT } from "../../domain/related-articles/related-past-reads-prompt";
import { initSelectRelatedArticlesWithoutSharedBoilerplate } from "../../domain/related-articles/shared-boilerplate";
import { RELATED_ARTICLES_TIMEOUTS } from "../../domain/related-articles/timeouts";

const logger = HutchLogger.from(consoleLogger);

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
const accountEmail = requireEnv("PAST_READS_SIM_USER_EMAIL");
const anchorCount = Number(getEnv("PAST_READS_SIM_ANCHORS") ?? "30");
const concurrency = Number(getEnv("PAST_READS_SIM_CONCURRENCY") ?? "4");
const variantsWanted = (getEnv("PAST_READS_SIM_VARIANTS") ?? "full,reversed,small")
	.split(",")
	.map((variant) => variant.trim())
	.filter((variant) => variant.length > 0);
const decoysFile = getEnv("PAST_READS_SIM_DECOYS_FILE");
const anchorKeysFile = getEnv("PAST_READS_SIM_ANCHOR_KEYS_FILE");

assert(Number.isInteger(anchorCount) && anchorCount >= 1, "PAST_READS_SIM_ANCHORS must be a positive integer");
assert(Number.isInteger(concurrency) && concurrency >= 1, "PAST_READS_SIM_CONCURRENCY must be a positive integer");

const SMALL_POOL_SIZE = 8;
const RECALL_SHORTLIST_SIZE = 40;
const DECOY_URL_PREFIX = "decoy.invalid/";

const dynamoClient = createDynamoDocumentClient();
const deepseekClient = new OpenAI({
	apiKey: deepseekApiKey,
	baseURL: "https://api.deepseek.com",
	timeout: RELATED_ARTICLES_TIMEOUTS.deepseekMs,
});
const createMessage = initCreateDeepseekMessage({
	createChatCompletion: (params) => deepseekClient.chat.completions.create(params),
});

const { selectRelatedArticles: selectPastReads } =
	initSelectRelatedArticlesWithoutSharedBoilerplate(
		initSelectRelatedArticles({ createMessage, logger, system: PAST_READS_PROMPT }),
	);

const { findRelatedTargetArticle } = initDynamoDbRelatedArticles({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
});
const { findReadCandidatesAcrossReadlists } = initDynamoDbPastReads({
	client: dynamoClient,
	tableName: articlesTable,
	userArticlesTableName: userArticlesTable,
});

const UserRow = z.object({ email: z.string(), userId: UserIdSchema });
const users = defineDynamoTable({ client: dynamoClient, tableName: usersTable, schema: UserRow });

const IndexRow = z.looseObject({ url: z.string(), status: z.string() });
const userArticles = defineDynamoTable({
	client: dynamoClient,
	tableName: userArticlesTable,
	schema: IndexRow,
});

const DecoyKind = z.enum(["positive", "broad-field", "same-site", "passing-mention"]);
const DecoysFileSchema = z.object({
	anchors: z.array(
		z.object({
			anchorKey: z.string(),
			decoys: z.array(
				z.object({
					kind: DecoyKind,
					title: z.string(),
					siteName: z.string(),
					description: z.string(),
				}),
			),
		}),
	),
});
type Decoys = z.infer<typeof DecoysFileSchema>["anchors"][number]["decoys"];

const AnchorKeysSchema = z.array(z.string());

interface Anchor {
	key: string;
	url: string;
	status: string;
	target: RelatedArticleTarget;
}

interface Pick {
	url: string;
	title: string;
	siteName: string;
	description: string;
	reason: string;
	reasonLength: number;
	readlist?: string;
	decoyKind?: string;
}

interface VariantResult {
	label: string;
	poolSize: number;
	kind: "ready" | "shared-boilerplate" | "no-text-block" | "error";
	picks: Pick[];
	inputTokens: number;
	outputTokens: number;
	durationMs: number;
	overProductionTimeout: boolean;
	error?: string;
	injectedDecoys?: string[];
}

interface AnchorReport {
	key: string;
	url: string;
	status: string;
	title: string;
	siteName: string;
	description: string;
	pool: {
		size: number;
		awaitingCrawl: number;
		fromCustomReadlists: number;
		fingerprint: string;
		fingerprintStableAcrossGathers: boolean;
		fingerprintOrderIndependent: boolean;
	};
	variants: VariantResult[];
	recallShortlist: { url: string; title: string; siteName: string; description: string; score: number }[];
}

async function resolveUserId(): Promise<UserId> {
	const row = await users.get({ email: normalizeEmail(accountEmail) }, { projection: ["email", "userId"] });
	assert(row, `no account in ${usersTable} for the configured email`);
	return row.userId;
}

async function newestKeys(params: {
	userId: UserId;
	indexName: "userId-savedAt-index" | "userId-readAt-index";
	wanted: number;
}): Promise<{ key: string; status: string }[]> {
	const rows: { key: string; status: string }[] = [];
	let exclusiveStartKey: Record<string, unknown> | undefined;
	do {
		const { items, lastEvaluatedKey } = await userArticles.query({
			IndexName: params.indexName,
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": params.userId },
			ScanIndexForward: false,
			ExclusiveStartKey: exclusiveStartKey,
		});
		for (const item of items) {
			if (rows.length >= params.wanted) break;
			rows.push({ key: item.url, status: item.status });
		}
		exclusiveStartKey = lastEvaluatedKey;
	} while (exclusiveStartKey && rows.length < params.wanted);
	return rows;
}

async function countUnread(userId: UserId, cap: number): Promise<number> {
	let count = 0;
	let exclusiveStartKey: Record<string, unknown> | undefined;
	do {
		const { items, lastEvaluatedKey } = await userArticles.query({
			IndexName: "userId-savedAt-index",
			KeyConditionExpression: "userId = :userId",
			FilterExpression: "#status = :status",
			ExpressionAttributeNames: { "#status": "status" },
			ExpressionAttributeValues: { ":userId": userId, ":status": "unread" },
			ExclusiveStartKey: exclusiveStartKey,
		});
		count += items.length;
		exclusiveStartKey = lastEvaluatedKey;
	} while (exclusiveStartKey && count < cap);
	return count;
}

async function originalUrlsFor(keys: string[]): Promise<Map<string, string>> {
	const rows = await batchGetFromTable({
		client: dynamoClient,
		tableName: articlesTable,
		schema: z.looseObject({ url: z.string() }),
		keys: keys.map((url) => ({ url })),
		projection: ["url", "originalUrl"],
	});
	const byKey = new Map<string, string>();
	for (const row of rows) {
		if (typeof row.originalUrl === "string") byKey.set(row.url, row.originalUrl);
	}
	return byKey;
}

async function resolveAnchors(userId: UserId): Promise<Anchor[]> {
	const [saves, reads] = await Promise.all([
		newestKeys({ userId, indexName: "userId-savedAt-index", wanted: anchorCount * 4 }),
		newestKeys({ userId, indexName: "userId-readAt-index", wanted: anchorCount * 4 }),
	]);
	const pinned = anchorKeysFile
		? AnchorKeysSchema.parse(JSON.parse(readFileSync(anchorKeysFile, "utf-8")))
		: undefined;
	const interleaved: { key: string; status: string }[] = [];
	const seen = new Set<string>();
	const pool = pinned
		? pinned.map((key) => ({ key, status: "pinned" }))
		: Array.from({ length: Math.max(saves.length, reads.length) }).flatMap((_, index) =>
				[reads[index], saves[index]].filter((row) => row !== undefined),
			);
	for (const row of pool) {
		if (seen.has(row.key)) continue;
		seen.add(row.key);
		interleaved.push(row);
	}
	const byKey = await originalUrlsFor(interleaved.map((row) => row.key));
	const anchors: Anchor[] = [];
	for (const row of interleaved) {
		if (anchors.length >= anchorCount) break;
		const url = byKey.get(row.key);
		if (!url) continue;
		const lookup = await findRelatedTargetArticle(url);
		if (lookup.state !== "found") continue;
		if (lookup.article.crawlStatus === "pending" || lookup.article.hasStubMetadata) continue;
		anchors.push({
			key: row.key,
			url,
			status: row.status,
			target: {
				title: lookup.article.title,
				siteName: lookup.article.siteName,
				description: lookup.article.description,
			},
		});
	}
	return anchors;
}

const STOPWORDS = new Set(
	"that this with from have what your their about which when will more into than them they were been also just like some only over such most other very these those would could should there where while after before because between through during without within against among".split(
		" ",
	),
);

function tokens(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((word) => word.length >= 4 && !STOPWORDS.has(word)),
	);
}

function overlap(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let shared = 0;
	for (const word of a) if (b.has(word)) shared += 1;
	return shared / Math.sqrt(a.size * b.size);
}

function picksOf(
	related: readonly RelatedArticleLink[],
	byUrl: ReadonlyMap<string, ReadlistReadCandidate & { decoyKind?: string }>,
): Pick[] {
	return related.map((link) => {
		const candidate = byUrl.get(link.url);
		assert(candidate, "a pick always resolves to a candidate the selector was given");
		return {
			url: link.url,
			title: candidate.title,
			siteName: candidate.siteName,
			description: candidate.description,
			reason: link.reason,
			reasonLength: link.reason.length,
			...(candidate.readlist !== undefined ? { readlist: candidate.readlist } : {}),
			...(candidate.decoyKind !== undefined ? { decoyKind: candidate.decoyKind } : {}),
		};
	});
}

async function runVariant(params: {
	label: string;
	target: RelatedArticleTarget;
	pool: readonly (ReadlistReadCandidate & { decoyKind?: string })[];
	injectedDecoys?: string[];
}): Promise<VariantResult> {
	const byUrl = new Map(params.pool.map((candidate) => [candidate.url, candidate]));
	const startedAt = Date.now();
	const base = {
		label: params.label,
		poolSize: params.pool.length,
		...(params.injectedDecoys ? { injectedDecoys: params.injectedDecoys } : {}),
	};
	try {
		const result = await selectPastReads({
			target: params.target,
			unreadCandidates: [],
			readCandidates: params.pool,
		});
		const durationMs = Date.now() - startedAt;
		const overProductionTimeout = durationMs > RELATED_ARTICLES_TIMEOUTS.deepseekMs;
		if (result.kind !== "ready") {
			return { ...base, kind: result.kind, picks: [], inputTokens: 0, outputTokens: 0, durationMs, overProductionTimeout };
		}
		return {
			...base,
			kind: "ready",
			picks: picksOf(result.related, byUrl),
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			durationMs,
			overProductionTimeout,
		};
	} catch (error) {
		const durationMs = Date.now() - startedAt;
		return {
			...base,
			kind: "error",
			picks: [],
			inputTokens: 0,
			outputTokens: 0,
			durationMs,
			overProductionTimeout: durationMs > RELATED_ARTICLES_TIMEOUTS.deepseekMs,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function smallPoolFor(
	candidates: readonly ReadlistReadCandidate[],
	carriedUrls: ReadonlySet<string>,
): ReadlistReadCandidate[] {
	const carried = candidates.filter((candidate) => carriedUrls.has(candidate.url));
	const others = candidates.filter((candidate) => !carriedUrls.has(candidate.url));
	const wanted = Math.max(0, SMALL_POOL_SIZE - carried.length);
	const step = Math.max(1, Math.floor(others.length / Math.max(1, wanted)));
	const sampled = others.filter((_, index) => index % step === 0).slice(0, wanted);
	return [...carried, ...sampled];
}

function withDecoys(
	candidates: readonly ReadlistReadCandidate[],
	anchorIndex: number,
	decoys: Decoys,
): { pool: (ReadlistReadCandidate & { decoyKind?: string })[]; injected: string[] } {
	const pool: (ReadlistReadCandidate & { decoyKind?: string })[] = [...candidates];
	const injected: string[] = [];
	for (const [slot, decoy] of decoys.entries()) {
		const url = `${DECOY_URL_PREFIX}${anchorIndex}/${decoy.kind}`;
		const position = Math.floor(((slot + 1) * pool.length) / (decoys.length + 1));
		pool.splice(position, 0, {
			url,
			title: decoy.title,
			siteName: decoy.siteName,
			description: decoy.description,
			decoyKind: decoy.kind,
		});
		injected.push(url);
	}
	return { pool, injected };
}

async function simulateAnchor(params: {
	userId: UserId;
	anchor: Anchor;
	anchorIndex: number;
	decoysByKey: ReadonlyMap<string, Decoys>;
}): Promise<AnchorReport> {
	const { userId, anchor, anchorIndex } = params;
	const gather = () =>
		findReadCandidatesAcrossReadlists({ userId, excludeUrl: anchor.url, limit: RELATED_CANDIDATES_MAX });
	const first = await gather();
	const second = await gather();
	const fingerprintInput = { url: anchor.url, ...anchor.target };
	const urls = first.candidates.map((candidate) => candidate.url);
	const fingerprint = computePastReadsFingerprint({ target: fingerprintInput, candidateUrls: urls });

	const variants: VariantResult[] = [];
	if (variantsWanted.includes("full")) {
		variants.push(await runVariant({ label: "full", target: anchor.target, pool: first.candidates }));
	}
	if (variantsWanted.includes("reversed")) {
		variants.push(
			await runVariant({ label: "reversed", target: anchor.target, pool: [...first.candidates].reverse() }),
		);
	}
	if (variantsWanted.includes("small")) {
		const carried = new Set(variants.flatMap((variant) => variant.picks.map((pick) => pick.url)));
		variants.push(
			await runVariant({ label: "small", target: anchor.target, pool: smallPoolFor(first.candidates, carried) }),
		);
	}
	const decoys = params.decoysByKey.get(anchor.key);
	if (variantsWanted.includes("decoys") && decoys) {
		const { pool, injected } = withDecoys(first.candidates, anchorIndex, decoys);
		variants.push(await runVariant({ label: "decoys", target: anchor.target, pool, injectedDecoys: injected }));
	}

	const picked = new Set(variants.flatMap((variant) => variant.picks.map((pick) => pick.url)));
	const anchorTokens = tokens(`${anchor.target.title} ${anchor.target.description}`);
	const recallShortlist = first.candidates
		.filter((candidate) => !picked.has(candidate.url))
		.map((candidate) => ({
			url: candidate.url,
			title: candidate.title,
			siteName: candidate.siteName,
			description: candidate.description,
			score: overlap(anchorTokens, tokens(`${candidate.title} ${candidate.description}`)),
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, RECALL_SHORTLIST_SIZE);

	logger.info("[past-reads-sim] anchor done", {
		anchorIndex,
		pool: first.candidates.length,
		picks: variants.map((variant) => `${variant.label}:${variant.kind}:${variant.picks.length}`).join(" "),
	});

	return {
		key: anchor.key,
		url: anchor.url,
		status: anchor.status,
		title: anchor.target.title,
		siteName: anchor.target.siteName,
		description: anchor.target.description,
		pool: {
			size: first.candidates.length,
			awaitingCrawl: first.awaitingCrawl,
			fromCustomReadlists: first.candidates.filter((candidate) => candidate.readlist !== undefined).length,
			fingerprint,
			fingerprintStableAcrossGathers:
				computePastReadsFingerprint({
					target: fingerprintInput,
					candidateUrls: second.candidates.map((candidate) => candidate.url),
				}) === fingerprint,
			fingerprintOrderIndependent:
				computePastReadsFingerprint({ target: fingerprintInput, candidateUrls: [...urls].reverse() }) ===
				fingerprint,
		},
		variants,
		recallShortlist,
	};
}

async function inPool<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			const item = items[index];
			assert(item !== undefined, "the pool only indexes within the item list");
			results[index] = await work(item, index);
		}
	});
	await Promise.all(workers);
	return results;
}

async function main(): Promise<void> {
	const userId = await resolveUserId();
	const [anchors, unreadCount] = await Promise.all([resolveAnchors(userId), countUnread(userId, 5000)]);
	assert(anchors.length > 0, "no usable anchors among the account's newest saves and reads");
	logger.info("[past-reads-sim] anchors resolved", { anchors: anchors.length, unreadCount, variants: variantsWanted.join(",") });

	const decoysByKey = new Map<string, Decoys>(
		decoysFile
			? DecoysFileSchema.parse(JSON.parse(readFileSync(decoysFile, "utf-8"))).anchors.map((entry) => [
					entry.anchorKey,
					entry.decoys,
				])
			: [],
	);

	const reports = await inPool(anchors, concurrency, (anchor, anchorIndex) =>
		simulateAnchor({ userId, anchor, anchorIndex, decoysByKey }),
	);

	const runId = new Date().toISOString().replace(/[:.]/g, "-");
	const outputDir = join(__dirname, "../../../../test-results/past-reads-simulation", runId);
	mkdirSync(outputDir, { recursive: true });

	const allVariants = reports.flatMap((report) => report.variants);
	const summary = {
		runId,
		unreadCount,
		unreadCountCapped: unreadCount >= 5000,
		anchors: reports.length,
		variants: variantsWanted,
		reasonMaxChars: RELATED_REASON_MAX_CHARS,
		calls: allVariants.length,
		errors: allVariants.filter((variant) => variant.kind === "error").length,
		noTextBlocks: allVariants.filter((variant) => variant.kind === "no-text-block").length,
		sharedBoilerplate: allVariants.filter((variant) => variant.kind === "shared-boilerplate").length,
		overProductionTimeout: allVariants.filter((variant) => variant.overProductionTimeout).length,
		inputTokens: allVariants.reduce((total, variant) => total + variant.inputTokens, 0),
		outputTokens: allVariants.reduce((total, variant) => total + variant.outputTokens, 0),
		slowestCallMs: Math.max(...allVariants.map((variant) => variant.durationMs)),
	};
	writeFileSync(join(outputDir, "report.json"), JSON.stringify({ summary, reports }, null, 2), "utf-8");
	logger.info("[past-reads-sim] done", { outputDir, ...summary });
}

main().catch((error) => {
	logger.error("[past-reads-sim] failed", { error });
	process.exitCode = 1;
});
