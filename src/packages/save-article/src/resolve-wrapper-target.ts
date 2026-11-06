import { type WrapperFamily, isArchiveHost, isUnlockableTrackerUrl, wrapperFamilyOf } from "@packages/domain/article";
import type { Logger } from "@packages/logger";

export type ResolvedWrapperTarget = { url: string; contentSourceUrl?: string };

export type ResolveWrapperTarget = (url: string) => Promise<ResolvedWrapperTarget | { ownOriginal: true } | undefined>;

export const neverResolveWrapperTarget: ResolveWrapperTarget = async () => undefined;

export type FetchRedirectHop = (
	url: string,
	init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export type TrackerHop = { response: Response; pageTarget: string | undefined };

export type FetchTrackerHop = (
	url: string,
	init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<TrackerHop>;

export type ResolveChallengedTracker = (
	url: string,
	init: { signal: AbortSignal; budgetMs: number },
) => Promise<{ kind: "navigated"; url: string; status: number } | { kind: "not-navigated"; status: number } | { kind: "not-attempted" }>;

export const neverResolveChallengedTracker: ResolveChallengedTracker = async () => ({ kind: "not-attempted" });

export type ResolveAppleNewsStoryUrl = (
	url: string,
	init: { signal: AbortSignal },
) => Promise<{ kind: "story"; url: string } | { kind: "no-story-url" } | { kind: "unavailable" }>;

export const WRAPPER_RESOLVE_BUDGETS = { hopBudgetMs: 3000, totalBudgetMs: 6000, challengeBudgetMs: 30_000 } as const;

const MAX_HOPS = 5;
const MEMENTO_ORIGINAL = /<([^>]+)>\s*;\s*rel="(?:[^"]*\s)?original(?:\s[^"]*)?"/;

type Outcome =
	| "resolved"
	| "not-a-redirect"
	| "no-location"
	| "non-http-location"
	| "hop-budget-exhausted"
	| "no-story-url"
	| "shell-unavailable"
	| "no-memento-original"
	| "archive-unreachable"
	| "page-link-not-a-tracker"
	| "challenge-unresolved"
	| "challenge-failed"
	| "challenge-deferred";

type Resolution = {
	target?: string;
	contentSourceUrl?: string;
	ownOriginal?: true;
	outcome: Outcome;
	hops: number;
	status?: number;
	error?: string;
	transport?: "proxy";
};

type Deadlines = { total: AbortSignal; challenge: AbortSignal };

function parseHttpLocation(location: string, base: string): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(location, base);
	} catch {
		return undefined;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
	return parsed.href;
}

function archiveRedirectOf(response: Response, current: string): string | undefined {
	if (response.status < 300 || response.status > 399) return undefined;
	const location = response.headers.get("location");
	const next = location === null ? undefined : parseHttpLocation(location, current);
	return next !== undefined && isArchiveHost(next) ? next : undefined;
}

function hostOf(url: string | undefined): string | undefined {
	return url === undefined ? undefined : new URL(url).hostname;
}

function errorMessageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isCloudflareChallenge(response: Response): boolean {
	return response.status === 403 && response.headers.get("cf-mitigated") === "challenge";
}

export function initResolveWrapperTarget(deps: {
	fetchRedirectHop: FetchRedirectHop;
	fetchTrackerHop: FetchTrackerHop;
	resolveChallengedTracker: ResolveChallengedTracker;
	resolveAppleNewsStoryUrl: ResolveAppleNewsStoryUrl;
	headers: Record<string, string>;
	hopBudgetMs: number;
	totalBudgetMs: number;
	challengeBudgetMs: number;
	logger: Logger;
}): ResolveWrapperTarget {
	const hopSignal = (deadline: AbortSignal) => AbortSignal.any([deadline, AbortSignal.timeout(deps.hopBudgetMs)]);
	const hop = (url: string, deadline: AbortSignal) =>
		deps.fetchRedirectHop(url, { headers: deps.headers, signal: hopSignal(deadline) });

	const unlockChallenge = async (url: string, params: { hops: number; deadline: AbortSignal }): Promise<Resolution> => {
		const { hops } = params;
		try {
			const unlocked = await deps.resolveChallengedTracker(url, {
				signal: params.deadline,
				budgetMs: deps.challengeBudgetMs,
			});
			if (unlocked.kind === "not-attempted") return { outcome: "challenge-deferred", hops, status: 403 };
			if (unlocked.kind === "not-navigated") {
				return { outcome: "challenge-unresolved", hops, status: unlocked.status, transport: "proxy" };
			}
			return { target: unlocked.url, outcome: "resolved", hops, status: unlocked.status, transport: "proxy" };
		} catch (error) {
			return { outcome: "challenge-failed", hops, error: errorMessageOf(error), transport: "proxy" };
		}
	};

	const followTracker = async (url: string, deadlines: Deadlines): Promise<Resolution> => {
		let current = url;
		for (let hops = 1; hops <= MAX_HOPS; hops += 1) {
			const { response, pageTarget } = await deps.fetchTrackerHop(current, {
				headers: deps.headers,
				signal: hopSignal(deadlines.total),
			});
			if (pageTarget !== undefined) {
				if (wrapperFamilyOf(pageTarget) !== "newsletter-tracker") {
					return { outcome: "page-link-not-a-tracker", hops, status: response.status };
				}
				current = pageTarget;
				continue;
			}
			if (isCloudflareChallenge(response) && isUnlockableTrackerUrl(current)) {
				return unlockChallenge(current, { hops, deadline: deadlines.challenge });
			}
			if (response.status < 300 || response.status > 399) return { outcome: "not-a-redirect", hops, status: response.status };
			const location = response.headers.get("location");
			if (location === null) return { outcome: "no-location", hops };
			const next = parseHttpLocation(location, current);
			if (next === undefined) return { outcome: "non-http-location", hops };
			if (wrapperFamilyOf(next) !== "newsletter-tracker") return { target: next, outcome: "resolved", hops };
			current = next;
		}
		return { outcome: "hop-budget-exhausted", hops: MAX_HOPS };
	};

	const resolveStory = async (url: string, { total }: Deadlines): Promise<Resolution> => {
		const shell = await deps.resolveAppleNewsStoryUrl(url, { signal: total });
		if (shell.kind === "story") return { target: shell.url, outcome: "resolved", hops: 1 };
		if (shell.kind === "no-story-url") return { ownOriginal: true, outcome: "no-story-url", hops: 1 };
		return { outcome: "shell-unavailable", hops: 1 };
	};

	const readMementoOriginal = async (url: string, { total: deadline }: Deadlines): Promise<Resolution> => {
		let current = url;
		for (let hops = 1; hops <= MAX_HOPS; hops += 1) {
			let response: Response;
			try {
				response = await hop(current, deadline);
			} catch (error) {
				return { ownOriginal: true, outcome: "archive-unreachable", hops, error: errorMessageOf(error) };
			}
			const next = archiveRedirectOf(response, current);
			if (next !== undefined) {
				current = next;
				continue;
			}
			if (response.status >= 400) return { ownOriginal: true, outcome: "archive-unreachable", hops, status: response.status };
			const link = response.headers.get("link");
			const original = link === null ? null : MEMENTO_ORIGINAL.exec(link);
			if (original !== null) {
				const target = parseHttpLocation(original[1], current);
				if (target === undefined) return { outcome: "non-http-location", hops };
				return { target, contentSourceUrl: current, outcome: "resolved", hops };
			}
			return { outcome: "no-memento-original", hops };
		}
		return { outcome: "hop-budget-exhausted", hops: MAX_HOPS };
	};

	const RESOLVERS: Record<Exclude<WrapperFamily, "archive-outbound" | "share-intent">, (url: string, deadlines: Deadlines) => Promise<Resolution>> = {
		"newsletter-tracker": followTracker,
		"apple-news": resolveStory,
		"archive-snapshot": readMementoOriginal,
	};

	return async (url) => {
		const family = wrapperFamilyOf(url);
		if (family === undefined || family === "archive-outbound" || family === "share-intent") return undefined;
		const wrapperHost = hostOf(url);
		try {
			const resolution = await RESOLVERS[family](url, {
				total: AbortSignal.timeout(deps.totalBudgetMs),
				challenge: AbortSignal.timeout(deps.challengeBudgetMs),
			});
			deps.logger.info(
				JSON.stringify({
					stream: "wrapper-resolve",
					family,
					wrapperHost,
					targetHost: hostOf(resolution.target),
					hops: resolution.hops,
					outcome: resolution.outcome,
					status: resolution.status,
					error: resolution.error,
					transport: resolution.transport,
				}),
			);
			if (resolution.ownOriginal === true) return { ownOriginal: true };
			return resolution.target === undefined ? undefined : { url: resolution.target, contentSourceUrl: resolution.contentSourceUrl };
		} catch (error) {
			deps.logger.warn(
				JSON.stringify({
					stream: "wrapper-resolve",
					family,
					wrapperHost,
					outcome: "failed",
					error: errorMessageOf(error),
				}),
			);
			return undefined;
		}
	};
}
