import { type WrapperFamily, isArchiveHost, wrapperFamilyOf } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";

export type ResolveWrapperTarget = (url: string) => Promise<string | undefined>;

export const neverResolveWrapperTarget: ResolveWrapperTarget = async () => undefined;

export type FetchRedirectHop = (
	url: string,
	init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export type ResolveAppleNewsStoryUrl = (url: string, init: { signal: AbortSignal }) => Promise<string | undefined>;

export const WRAPPER_RESOLVE_BUDGETS = { hopBudgetMs: 3000, totalBudgetMs: 6000 } as const;

const MAX_HOPS = 5;
const MEMENTO_ORIGINAL = /<([^>]+)>\s*;\s*rel="(?:[^"]*\s)?original(?:\s[^"]*)?"/;

type Outcome =
	| "resolved"
	| "not-a-redirect"
	| "no-location"
	| "non-http-location"
	| "hop-budget-exhausted"
	| "no-story-url"
	| "no-memento-original";

type Resolution = { target?: string; outcome: Outcome; hops: number };

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

export function initResolveWrapperTarget(deps: {
	fetchRedirectHop: FetchRedirectHop;
	resolveAppleNewsStoryUrl: ResolveAppleNewsStoryUrl;
	headers: Record<string, string>;
	hopBudgetMs: number;
	totalBudgetMs: number;
	logger: HutchLogger;
}): ResolveWrapperTarget {
	const hop = (url: string, deadline: AbortSignal) =>
		deps.fetchRedirectHop(url, {
			headers: deps.headers,
			signal: AbortSignal.any([deadline, AbortSignal.timeout(deps.hopBudgetMs)]),
		});

	const followTracker = async (url: string, deadline: AbortSignal): Promise<Resolution> => {
		let current = url;
		for (let hops = 1; hops <= MAX_HOPS; hops += 1) {
			const response = await hop(current, deadline);
			if (response.status < 300 || response.status > 399) return { outcome: "not-a-redirect", hops };
			const location = response.headers.get("location");
			if (location === null) return { outcome: "no-location", hops };
			const next = parseHttpLocation(location, current);
			if (next === undefined) return { outcome: "non-http-location", hops };
			if (wrapperFamilyOf(next) !== "newsletter-tracker") return { target: next, outcome: "resolved", hops };
			current = next;
		}
		return { outcome: "hop-budget-exhausted", hops: MAX_HOPS };
	};

	const resolveStory = async (url: string, deadline: AbortSignal): Promise<Resolution> => {
		const story = await deps.resolveAppleNewsStoryUrl(url, { signal: deadline });
		if (story === undefined) return { outcome: "no-story-url", hops: 1 };
		return { target: story, outcome: "resolved", hops: 1 };
	};

	const readMementoOriginal = async (url: string, deadline: AbortSignal): Promise<Resolution> => {
		let current = url;
		for (let hops = 1; hops <= MAX_HOPS; hops += 1) {
			const response = await hop(current, deadline);
			const link = response.headers.get("link");
			const original = link === null ? null : MEMENTO_ORIGINAL.exec(link);
			if (original !== null) {
				const target = parseHttpLocation(original[1], current);
				if (target === undefined) return { outcome: "non-http-location", hops };
				return { target, outcome: "resolved", hops };
			}
			const next = archiveRedirectOf(response, current);
			if (next === undefined) return { outcome: "no-memento-original", hops };
			current = next;
		}
		return { outcome: "hop-budget-exhausted", hops: MAX_HOPS };
	};

	const RESOLVERS: Record<WrapperFamily, (url: string, deadline: AbortSignal) => Promise<Resolution>> = {
		"newsletter-tracker": followTracker,
		"apple-news": resolveStory,
		"archive-snapshot": readMementoOriginal,
	};

	return async (url) => {
		const family = wrapperFamilyOf(url);
		if (family === undefined) return undefined;
		const wrapperHost = hostOf(url);
		try {
			const resolution = await RESOLVERS[family](url, AbortSignal.timeout(deps.totalBudgetMs));
			deps.logger.info(
				JSON.stringify({
					stream: "wrapper-resolve",
					family,
					wrapperHost,
					targetHost: hostOf(resolution.target),
					hops: resolution.hops,
					outcome: resolution.outcome,
				}),
			);
			return resolution.target;
		} catch (error) {
			deps.logger.warn(
				JSON.stringify({
					stream: "wrapper-resolve",
					family,
					wrapperHost,
					outcome: "failed",
					error: error instanceof Error ? error.message : String(error),
				}),
			);
			return undefined;
		}
	};
}
