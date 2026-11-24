import { setTimeout as sleep } from "node:timers/promises";
import type {
	GetQueryResultsRequest,
	GetQueryResultsResponse,
	StartQueryRequest,
	StartQueryResponse,
} from "@aws-sdk/client-cloudwatch-logs";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ANALYTICS_LOG_GROUP, ENGAGEMENT_EVENTS } from "@packages/dashboard-widgets";
import { ReaderArticleHashId } from "@packages/domain/article";
import type { ResolveOnViewSurface } from "@packages/provider-contracts/events";
import { z } from "zod";

export interface FailureHistoryArticle {
	key: string;
	originalUrl: string;
	savedAt: string;
	fullCrawlRequestedAt?: string;
	resolutionOnViewClaimedAt?: string;
}

export interface FailureHistoryLogMatch {
	admissionSurface: ResolveOnViewSurface | undefined;
	admissionCovered: boolean;
	ownerOpenTimes: readonly number[];
	ownerOpensCovered: boolean;
}

type QueryRow = ReadonlyMap<string, string>;
type QueryInput = {
	logGroupNames: string[];
	queryString: string;
	startTime: number;
	endTime: number;
};

export type ReadFailureHistoryQuery = (input: QueryInput, signal?: AbortSignal) => Promise<readonly QueryRow[] | undefined>;

type LogClient = {
	startQuery: (input: StartQueryRequest, options: { abortSignal: AbortSignal }) => Promise<StartQueryResponse>;
	getQueryResults: (input: GetQueryResultsRequest, options: { abortSignal: AbortSignal }) => Promise<GetQueryResultsResponse>;
};

const QUERY_LIMIT = 10_000;
const POLL_INTERVAL_MS = 1_000;
const QUERY_TIMEOUT_MS = 75_000;
const LOOKUP_TIMEOUT_MS = 180_000;
const QUERY_CONCURRENCY = 3;
const DAY_MS = 86_400_000;
const WORKER_RETENTION_MS = 30 * DAY_MS;
const ADMISSION_PRECEDING_MS = 1_000;
const ADMISSION_FOLLOWING_MS = 60_000;
const OWNER_PARTITION_MS = 12 * DAY_MS;
const OWNER_IDS_PER_QUERY = 200;
const ISO_TIME = z.iso.datetime();

const WORKER_LOG_GROUPS = [
	"/aws/lambda/submit-link-handler",
	"/aws/lambda/recrawl-link-initiated-handler",
	"/aws/lambda/save-anonymous-link-command-handler",
];
const RESOLUTION_DISPATCH = "[ResolveOnView] dispatched";
const ADMISSION_LABELS = String.raw`\[ResolveOnView\] dispatched|\[SaveAnonymousLinkCommand\] processing|\[RecrawlLinkInitiated\] processing|\[SubmitLinkCommand\] saved`;
const ADMISSION_QUERY = String.raw`filter @message like /\t(${ADMISSION_LABELS}) \{/
| parse @message /\t(?<dispatch>${ADMISSION_LABELS}) \{\s*url: /
| parse @message /\{\s*url: '(?<singleQuotedUrl>[^'\\\r\n]+)'\s*[,}]/
| parse @message /\{\s*url: "(?<doubleQuotedUrl>[^"\\\r\n]+)"\s*[,}]/
| parse @message /\{\s*url: \x60(?<backtickUrl>[^\x60\\\r\n]+)\x60\s*[,}]/
| parse @message /[,\s]surface: '(?<surface>[a-z-]+)'/
| fields toMillis(@timestamp) as dispatchTime
| display dispatchTime, dispatch, surface, singleQuotedUrl, doubleQuotedUrl, backtickUrl`;

const SURFACES = z.enum({
	"readlist-html": "readlist-html",
	"readlist-siren": "readlist-siren",
	reader: "reader",
	"reader-capture-gave-up": "reader-capture-gave-up",
	"queue-digest": "queue-digest",
} satisfies { [Surface in ResolveOnViewSurface]: Surface });

type ArticleMatch = {
	article: FailureHistoryArticle;
	savedAt: number;
	ownerId: string;
	admissionSurface: ResolveOnViewSurface | undefined;
	admissionCovered: boolean;
	ownerOpenTimes: Set<number>;
	ownerOpensCovered: boolean;
};

type Admission = {
	match: ArticleMatch;
	requestedAt: number;
	start: number;
	end: number;
};

const wakeAfterPoll = (signal: AbortSignal) => sleep(POLL_INTERVAL_MS, undefined, { signal });

export function initFailureHistoryQuery(deps: { client: LogClient; wake?: (signal: AbortSignal) => Promise<void> }): ReadFailureHistoryQuery {
	const wake = deps.wake ?? wakeAfterPoll;

	return async (input, outerSignal) => {
		const queryTimeout = AbortSignal.timeout(QUERY_TIMEOUT_MS);
		const abortSignal = outerSignal === undefined ? queryTimeout : AbortSignal.any([outerSignal, queryTimeout]);
		const options = { abortSignal };
		try {
			abortSignal.throwIfAborted();
			const { queryId } = await deps.client.startQuery({ ...input, limit: QUERY_LIMIT }, options);
			if (queryId === undefined) return undefined;
			let response = await deps.client.getQueryResults({ queryId, maxItems: QUERY_LIMIT }, options);
			while (response.status === "Scheduled" || response.status === "Running") {
				await wake(abortSignal);
				abortSignal.throwIfAborted();
				response = await deps.client.getQueryResults({ queryId, maxItems: QUERY_LIMIT }, options);
			}
			const { results, statistics, nextToken } = response;
			if (
				response.status !== "Complete" || results === undefined || nextToken !== undefined ||
				results.length >= QUERY_LIMIT || results.length !== statistics?.recordsMatched
			) return undefined;
			return results.map((fields) => new Map(fields.flatMap(({ field, value }) =>
				field === undefined || value === undefined || field === "@ptr" ? [] : [[field, value]],
			)));
		} catch {
			return undefined;
		}
	};
}

function parseTime(value: string | undefined): number {
	return ISO_TIME.safeParse(value).success && value !== undefined ? Date.parse(value) : Number.NaN;
}

function admissionWindow(match: ArticleMatch, bounds: { retentionStart: number; cutoff: number }): Admission | undefined {
	const { fullCrawlRequestedAt, resolutionOnViewClaimedAt } = match.article;
	if (fullCrawlRequestedAt === undefined || fullCrawlRequestedAt !== resolutionOnViewClaimedAt) return undefined;
	const requestedAt = parseTime(fullCrawlRequestedAt);
	const start = requestedAt - ADMISSION_PRECEDING_MS;
	const end = requestedAt + ADMISSION_FOLLOWING_MS;
	if (!(match.savedAt <= requestedAt && start >= bounds.retentionStart && end <= bounds.cutoff)) return undefined;
	return { match, requestedAt, start, end };
}

function queryInput(input: { logGroupNames: string[]; queryString: string; start: number; end: number }): QueryInput {
	return {
		logGroupNames: input.logGroupNames,
		queryString: input.queryString,
		startTime: Math.floor(input.start / 1_000),
		endTime: Math.ceil(input.end / 1_000),
	};
}

function admissionBatches(admissions: readonly Admission[]): Admission[][] {
	const byDay = new Map<number, Admission[]>();
	for (const admission of admissions) {
		const day = Math.floor(admission.requestedAt / DAY_MS);
		const batch = byDay.get(day) ?? [];
		batch.push(admission);
		byDay.set(day, batch);
	}
	return [...byDay.values()];
}

function parseDispatch(row: QueryRow) {
	const url = row.get("singleQuotedUrl") ?? row.get("doubleQuotedUrl") ?? row.get("backtickUrl");
	const time = Number(row.get("dispatchTime"));
	const dispatch = row.get("dispatch");
	if (url === undefined || !URL.canParse(url) || !Number.isSafeInteger(time) || dispatch === undefined) return undefined;
	const surface = SURFACES.safeParse(row.get("surface"));
	return {
		url,
		key: ArticleResourceUniqueId.parse(url).value,
		time,
		surface: dispatch === RESOLUTION_DISPATCH && surface.success ? surface.data : undefined,
	};
}

function matchAdmissions(admissions: readonly Admission[], rows: readonly QueryRow[] | undefined) {
	if (rows === undefined) return;
	const dispatches = rows.map(parseDispatch);
	if (dispatches.includes(undefined)) return;
	for (const { match, requestedAt, start, end } of admissions) {
		const nearby = dispatches.filter((dispatch) =>
			dispatch !== undefined && dispatch.time >= start && dispatch.time <= end &&
			(dispatch.key === match.article.key || dispatch.url === match.article.originalUrl),
		);
		match.admissionCovered = true;
		const [only] = nearby;
		if (nearby.length === 1 && only?.key === match.article.key && only.time >= requestedAt) {
			match.admissionSurface = only.surface;
		}
	}
}

type Job = (signal: AbortSignal) => Promise<void>;

function* ownerJobs(input: { matches: readonly ArticleMatch[]; cutoff: number; read: ReadFailureHistoryQuery }): Generator<Job> {
	const targets = input.matches.filter((match) => match.ownerOpensCovered);
	const firstSave = targets.reduce((earliest, match) => Math.min(earliest, match.savedAt), Infinity);
	for (let end = input.cutoff; end >= firstSave; end -= OWNER_PARTITION_MS) {
		const start = Math.max(firstSave, end - OWNER_PARTITION_MS + 1);
		const active = targets.filter((match) => match.savedAt <= end);
		for (let index = 0; index < active.length; index += OWNER_IDS_PER_QUERY) {
			const batch = active.slice(index, index + OWNER_IDS_PER_QUERY);
			yield async (signal) => {
				const byId = new Map(batch.map((match) => [match.ownerId, match]));
				const queryString = `filter event = "${ENGAGEMENT_EVENTS.activity}" and activity_kind = "reader-open" and article_id in ${JSON.stringify([...byId.keys()])}
| display timestamp, article_id`;
				const rows = await input.read(queryInput({ logGroupNames: [ANALYTICS_LOG_GROUP], queryString, start, end }), signal);
				const opens = rows?.map((row) => ({
					match: byId.get(row.get("article_id") ?? ""),
					time: parseTime(row.get("timestamp")),
				}));
				if (opens === undefined || opens.some(({ match, time }) => match === undefined || !Number.isFinite(time))) {
					for (const match of batch) match.ownerOpensCovered = false;
					return;
				}
				for (const { match, time } of opens) {
					if (match !== undefined && time >= match.savedAt && time >= start && time <= end) {
						match.ownerOpenTimes.add(time);
					}
				}
			};
		}
	}
}

async function runJobs(jobs: Iterator<Job>, signal: AbortSignal) {
	await Promise.all(Array.from({ length: QUERY_CONCURRENCY }, async () => {
		for (let job = jobs.next(); !job.done; job = jobs.next()) {
			await job.value(signal);
		}
	}));
}

export function initFailureHistoryLogs(deps: { client: LogClient; wake?: (signal: AbortSignal) => Promise<void>; now?: () => number }) {
	const read = initFailureHistoryQuery(deps);
	const now = deps.now ?? Date.now;

	return async (input: { articles: readonly FailureHistoryArticle[]; cutoff: Date }): Promise<ReadonlyMap<string, FailureHistoryLogMatch>> => {
		const cutoff = input.cutoff.getTime();
		const retentionStart = now() - WORKER_RETENTION_MS;
		const matches: ArticleMatch[] = input.articles.map((article) => {
			const savedAt = parseTime(article.savedAt);
			return {
				article, savedAt, ownerId: ReaderArticleHashId.fromResourceUniqueId(article.key).value,
				admissionSurface: undefined, admissionCovered: false, ownerOpenTimes: new Set(),
				ownerOpensCovered: Number.isFinite(savedAt) && savedAt >= 0 && savedAt <= cutoff,
			};
		});
		const admissions = matches.flatMap((match) => admissionWindow(match, { retentionStart, cutoff }) ?? []);
		const jobs = function* (): Generator<Job> {
			for (const batch of admissionBatches(admissions)) {
				yield async (signal) => {
					const start = Math.min(...batch.map((admission) => admission.start));
					const end = Math.max(...batch.map((admission) => admission.end));
					const rows = await read(queryInput({ logGroupNames: WORKER_LOG_GROUPS, queryString: ADMISSION_QUERY, start, end }), signal);
					matchAdmissions(batch, rows);
				};
			}
			yield* ownerJobs({ matches, cutoff, read });
		};
		await runJobs(jobs(), AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
		return new Map(matches.map((match) => [match.article.key, {
			admissionSurface: match.admissionSurface,
			admissionCovered: match.admissionCovered,
			ownerOpensCovered: match.ownerOpensCovered,
			ownerOpenTimes: [...match.ownerOpenTimes].sort((a, b) => a - b),
		}]));
	};
}
