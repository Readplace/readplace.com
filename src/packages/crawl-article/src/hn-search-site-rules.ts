import { parseHTML } from "linkedom";
import { noExtract, noRecovery, noTransform } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";
import type { CrawlFetch } from "./crawl-fetch";
import { escapeHtmlText } from "./pdf-html-helpers";

const FETCH_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 2_000_000;
const SEARCH_KEYS = ["dateRange", "page", "prefix", "query", "sort", "type"] as const;

type SearchControls = { query: string; page: string };
type SearchHit = {
	objectID: string;
	title: string;
	url?: string | null;
	story_text?: string | null;
	points?: number | null;
	num_comments?: number | null;
	author?: string | null;
	created_at?: string | null;
};
type StoryNode = {
	readonly nodeType: number;
	readonly nodeName: string;
	readonly textContent: string;
	readonly childNodes: ArrayLike<StoryNode>;
};

function searchControls(url: string): SearchControls | undefined {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return undefined;
	}
	if (target.protocol !== "https:" || target.hostname !== "hn.algolia.com" || target.port || target.pathname !== "/") return undefined;
	if (target.username || target.password || target.hash || target.searchParams.size !== SEARCH_KEYS.length) return undefined;
	if (SEARCH_KEYS.some((key) => target.searchParams.getAll(key).length !== 1)) return undefined;
	const query = target.searchParams.get("query");
	if (query === null || query.trim() === "") return undefined;
	if (
		target.searchParams.get("dateRange") !== "all" ||
		target.searchParams.get("page") !== "0" ||
		target.searchParams.get("prefix") !== "true" ||
		target.searchParams.get("sort") !== "byPopularity" ||
		target.searchParams.get("type") !== "story"
	) return undefined;
	return { query, page: "0" };
}

function apiUrl(controls: SearchControls): string {
	const target = new URL("https://hn.algolia.com/api/v1/search");
	target.searchParams.set("query", controls.query);
	target.searchParams.set("tags", "story");
	target.searchParams.set("page", controls.page);
	target.searchParams.set("hitsPerPage", "30");
	target.searchParams.set("queryType", "prefixLast");
	target.searchParams.set("restrictSearchableAttributes", "title,comment_text,url,story_text,author");
	return target.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || typeof value === "string";
}

function optionalNumber(value: unknown): value is number | null | undefined {
	return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value));
}

function parseHits(payload: unknown, controls: SearchControls): SearchHit[] | undefined {
	if (!isRecord(payload) || payload.query !== controls.query || payload.page !== 0 || payload.hitsPerPage !== 30) return undefined;
	if (!Array.isArray(payload.hits) || payload.hits.length === 0 || payload.hits.length > 30) return undefined;
	const ids = new Set<string>();
	const hits: SearchHit[] = [];
	for (const value of payload.hits) {
		if (!isRecord(value)) return undefined;
		if (typeof value.objectID !== "string" || !/^\d+$/.test(value.objectID) || ids.has(value.objectID)) return undefined;
		if (typeof value.title !== "string" || value.title.trim() === "") return undefined;
		if (!Array.isArray(value._tags) || !value._tags.includes("story")) return undefined;
		if (!optionalString(value.url) || !optionalString(value.story_text) || !optionalString(value.author) || !optionalString(value.created_at)) return undefined;
		if (!optionalNumber(value.points) || !optionalNumber(value.num_comments)) return undefined;
		ids.add(value.objectID);
		hits.push({
			objectID: value.objectID,
			title: value.title,
			url: typeof value.url === "string" ? value.url : null,
			story_text: typeof value.story_text === "string" ? value.story_text : null,
			points: typeof value.points === "number" ? value.points : null,
			num_comments: typeof value.num_comments === "number" ? value.num_comments : null,
			author: typeof value.author === "string" ? value.author : null,
			created_at: typeof value.created_at === "string" ? value.created_at : null,
		});
	}
	return hits;
}

function safeHttpUrl(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const target = new URL(value);
		if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return undefined;
		return target.toString();
	} catch {
		return undefined;
	}
}

function storyParagraphs(storyText: string): string {
	const { document } = parseHTML(`<html><body>${storyText}</body></html>`);
	const paragraphs: string[] = [];
	let current = "";
	const flush = () => {
		const text = current.replace(/\s+/g, " ").trim();
		if (text) paragraphs.push(text);
		current = "";
	};
	const visit = (node: StoryNode) => {
		if (node.nodeType === 3) {
			current += node.textContent;
			return;
		}
		if (node.nodeType !== 1) return;
		const name = node.nodeName.toLowerCase();
		if (["script", "style", "iframe", "svg", "form", "template"].includes(name)) return;
		if (name === "br") {
			flush();
			return;
		}
		const block = ["p", "div", "li", "blockquote", "pre", "h1", "h2", "h3", "h4"].includes(name);
		if (block) flush();
		for (const child of Array.from(node.childNodes)) visit(child);
		if (block) flush();
	};
	visit(document.body);
	flush();
	return paragraphs.map((text) => `<p>${escapeHtmlText(text)}</p>`).join("");
}

async function readResponseBody(response: Response, signal: AbortSignal): Promise<string> {
	if (!response.body) throw new Error("HN search API response has no body");
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let total = 0;
	const aborted = new Promise<never>((_resolve, reject) => {
		const onAbort = () => reject(new Error("HN search API deadline exceeded"));
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		for (;;) {
			const { done, value } = await Promise.race([reader.read(), aborted]);
			if (done) break;
			total += value.byteLength;
			if (total > MAX_RESPONSE_BYTES) throw new Error("HN search API response too large");
			chunks.push(Buffer.from(value));
		}
		return Buffer.concat(chunks).toString("utf8");
	} finally {
		if (signal.aborted || total > MAX_RESPONSE_BYTES) void reader.cancel().catch(() => {});
	}
}

function composeHtml(controls: SearchControls, hits: readonly SearchHit[]): string {
	const heading = `Search results for “${controls.query}”`;
	const results = hits.map((hit) => {
		const permalink = `https://news.ycombinator.com/item?id=${hit.objectID}`;
		const external = safeHttpUrl(hit.url);
		const details = [
			typeof hit.points === "number" ? `${hit.points} points` : undefined,
			typeof hit.num_comments === "number" ? `${hit.num_comments} comments` : undefined,
			hit.author ? `by ${hit.author}` : undefined,
			hit.created_at || undefined,
		].filter((part): part is string => part !== undefined);
		return [
			'<section class="search-result">',
			`<h2><a href="${permalink}">${escapeHtmlText(hit.title)}</a></h2>`,
			external ? `<p><a href="${escapeHtmlText(external)}">${escapeHtmlText(external)}</a></p>` : "",
			hit.story_text?.trim() ? storyParagraphs(hit.story_text) : "",
			details.length ? `<p>${escapeHtmlText(details.join(" · "))}</p>` : "",
			"</section>",
		].join("");
	}).join("");
	return `<html><head><meta charset="utf-8"><title>${escapeHtmlText(heading)}</title></head><body><main><article><h1>${escapeHtmlText(heading)}</h1><p>Story results, page ${controls.page}, sorted by popularity.</p>${results}</article></main></body></html>`;
}

export function initHnSearchSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	const onCrawl: SiteRules["onCrawl"] = async ({ url }) => {
		const controls = searchControls(url);
		if (controls === undefined) return { kind: "skip" };
		const controller = new AbortController();
		const deadline = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			const response = await deps.crawlFetch(apiUrl(controls), { budgetMs: FETCH_TIMEOUT_MS, signal: controller.signal });
			if (response.status !== 200) {
				deps.logError(`[CrawlArticle] HN search API HTTP ${response.status}`);
				return { kind: "skip" };
			}
			const payload: unknown = JSON.parse(await readResponseBody(response, controller.signal));
			const hits = parseHits(payload, controls);
			if (hits === undefined) {
				deps.logError("[CrawlArticle] HN search API response mismatch");
				return { kind: "skip" };
			}
			return { kind: "content", html: composeHtml(controls, hits) };
		} catch (error) {
			deps.logError("[CrawlArticle] HN search API error", error instanceof Error ? error : undefined);
		} finally {
			clearTimeout(deadline);
		}
		return { kind: "skip" };
	};
	return {
		matches: ({ url }) => searchControls(url) !== undefined,
		onCrawl,
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	};
}
