import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ANALYTICS_LOG_GROUP } from "@packages/dashboard-widgets";
import { validateSaveableUrl } from "@packages/domain/article";
import { z } from "zod";
import type { FailureHistoryArticle, ReadFailureHistoryQuery } from "./failure-history-logs";

const WINDOW_MS = 12 * 86_400_000;
const LOOKUP_TIMEOUT_MS = 180_000;
const HOST_QUERY_BUDGET = 8_000;
const VIEW_PREFIX = "/view/";
const ISO_TIME = z.iso.datetime();

type PublicViewTarget = {
	key: string;
	host: string;
	savedAt: number;
	admittedAt: number;
	uncoveredUntil: number;
};

export type PublicViewEvidence = {
	opened: ReadonlySet<string>;
	covered: ReadonlySet<string>;
};

function parseTime(value: string | undefined): number {
	const parsed = ISO_TIME.safeParse(value);
	return parsed.success ? Date.parse(parsed.data) : Number.NaN;
}

function canonicalPublicPath(url: URL): string {
	const scheme = url.protocol === "http:" ? "http://" : "";
	const tail = `${url.host}${url.pathname}${url.search}${url.hash}`
		.replaceAll("%25", "%2525")
		.replaceAll("?", "%3F")
		.replaceAll("#", "%23")
		.replaceAll("^", "%5E")
		.replaceAll("|", "%7C");
	return `${VIEW_PREFIX}${scheme}${tail}`;
}

function publicViewKey(path: string | undefined, host: string | undefined): string | undefined {
	if (path === undefined || host === undefined || !path.startsWith(VIEW_PREFIX)) return undefined;
	const tail = path.slice(VIEW_PREFIX.length);
	const scheme = tail.startsWith("http://") ? "http://" : "";
	let decoded: string;
	try {
		decoded = decodeURIComponent(tail.slice(scheme.length));
	} catch {
		return undefined;
	}
	const validated = validateSaveableUrl(`${scheme || "https://"}${decoded}`);
	if (validated.status !== "SUCCESS") return undefined;
	const url = new URL(validated.url);
	if (url.hostname !== host) return undefined;

	// `view_opened` logs the requested path and the resolved host. Require the
	// canonical browser spelling of the decoded URL so ambiguous escapes (such
	// as an encoded slash that would split into two segments) supply no proof.
	if (path !== canonicalPublicPath(url)) return undefined;
	return ArticleResourceUniqueId.parse(validated.url).value;
}

function publicViewHost(key: string, originalUrl: string | undefined): string | undefined {
	for (const candidate of [originalUrl, `https://${key}`, `http://${key}`]) {
		const validated = validateSaveableUrl(candidate);
		if (validated.status === "SUCCESS" && ArticleResourceUniqueId.parse(validated.url).value === key) {
			return new URL(validated.url).hostname;
		}
	}
	return undefined;
}

function* hostBatches(hosts: Iterable<string>): Generator<string[]> {
	let batch: string[] = [];
	let size = 0;
	for (const host of hosts) {
		const length = JSON.stringify(host).length + 1;
		if (size + length > HOST_QUERY_BUDGET) {
			yield batch;
			batch = [];
			size = 0;
		}
		batch.push(host);
		size += length;
	}
	if (batch.length > 0) yield batch;
}

function isInSaveWindow(target: PublicViewTarget, time: number): boolean {
	return time >= target.savedAt && time < target.admittedAt;
}

export function initLoadPublicViewEvidence(deps: { query: ReadFailureHistoryQuery }) {
	return async (input: {
		rows: readonly (Pick<FailureHistoryArticle, "key" | "savedAt" | "fullCrawlRequestedAt"> &
			Partial<Pick<FailureHistoryArticle, "originalUrl">>)[];
		now: Date;
	}): Promise<PublicViewEvidence> => {
		const cutoff = input.now.getTime();
		const targets = new Map<string, PublicViewTarget>();
		const seen = new Set<string>();
		for (const row of input.rows) {
			if (seen.has(row.key)) {
				targets.delete(row.key);
				continue;
			}
			seen.add(row.key);
			const savedAt = parseTime(row.savedAt);
			const admittedAt = parseTime(row.fullCrawlRequestedAt);
			if (!(savedAt >= 0 && savedAt < admittedAt && admittedAt <= cutoff)) continue;
			const host = publicViewHost(row.key, row.originalUrl);
			if (host === undefined) continue;
			targets.set(row.key, { key: row.key, host, savedAt, admittedAt, uncoveredUntil: admittedAt });
		}

		const firstSave = Array.from(targets.values()).reduce((first, row) => Math.min(first, row.savedAt), Infinity);
		const lastAdmission = Array.from(targets.values()).reduce((last, row) => Math.max(last, row.admittedAt), 0);
		const opened = new Set<string>();
		const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
		for (let end = lastAdmission; end > firstSave && !signal.aborted; end -= WINDOW_MS) {
			const start = Math.max(firstSave, end - WINDOW_MS);
			const byHost = new Map<string, PublicViewTarget[]>();
			for (const target of targets.values()) {
				if (target.savedAt >= end || target.admittedAt <= start) continue;
				const entries = byHost.get(target.host) ?? [];
				entries.push(target);
				byHost.set(target.host, entries);
			}
			for (const batch of hostBatches(byHost.keys())) {
				if (signal.aborted) break;
				const events = await deps.query({
					logGroupNames: [ANALYTICS_LOG_GROUP],
					queryString: `filter event = "view_opened" and article_host in ${JSON.stringify(batch)}
| display timestamp, path, article_host`,
					startTime: Math.floor(start / 1_000),
					endTime: Math.ceil(end / 1_000),
				}, signal);
				if (events === undefined) continue;
				const batchTargets = batch.flatMap((host) => byHost.get(host) ?? []);
				const batchHosts = new Set(batch);
				const uncertain = new Set<PublicViewTarget>();
				for (const event of events) {
					const time = parseTime(event.get("timestamp"));
					const hasTime = Number.isFinite(time);
					if (hasTime && (time < start || time >= end)) continue;
					const host = event.get("article_host");
					if (host !== undefined && !batchHosts.has(host)) continue;
					const key = publicViewKey(event.get("path"), host);
					const target = key === undefined ? undefined : targets.get(key);
					if (key === undefined) {
						// An unresolved path could refer to any matching article on its logged host.
						const affected = host === undefined ? batchTargets : byHost.get(host) ?? [];
						for (const possible of affected) {
							if (!hasTime || isInSaveWindow(possible, time)) uncertain.add(possible);
						}
					} else if (target !== undefined && !hasTime) {
						uncertain.add(target);
					} else if (target !== undefined && isInSaveWindow(target, time)) {
						opened.add(target.key);
					}
				}
				for (const target of batchTargets) {
					// Walk backward through consecutive successful windows. A gap leaves
					// this boundary ahead of all older queries, even after a timeout.
					if (!uncertain.has(target) && target.uncoveredUntil <= end) {
						target.uncoveredUntil = Math.max(target.savedAt, start);
					}
				}
			}
		}
		const covered = new Set(Array.from(targets.values())
			.filter((target) => target.uncoveredUntil === target.savedAt)
			.map((target) => target.key));
		return { opened, covered };
	};
}
