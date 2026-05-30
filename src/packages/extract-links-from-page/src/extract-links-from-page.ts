import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { CrawlFetch } from "@packages/crawl-article";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import {
	collectImportLinks,
	type ImportLinksResult,
} from "@packages/domain/import-session";

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const HTML_CONTENT_TYPES: readonly string[] = ["text/html", "application/xhtml+xml"];

export type ExtractLinksFromPageResult =
	| { readonly status: "OK"; readonly links: ImportLinksResult }
	| { readonly status: "INVALID_URL" }
	| { readonly status: "UNSUPPORTED_CONTENT_TYPE"; readonly contentType: string }
	| {
			readonly status: "FETCH_FAILED";
			readonly reason: "timeout" | "network" | "http" | "too_large";
			readonly httpStatus?: number;
	  };

export type ExtractLinksFromPageUrl = (
	pageUrl: string,
) => Promise<ExtractLinksFromPageResult>;

function contentTypeIsHtml(contentType: string): boolean {
	const lower = contentType.toLowerCase().split(";")[0].trim();
	return HTML_CONTENT_TYPES.includes(lower);
}

function resolveHref(href: string | null, base: URL): string | undefined {
	assert(href !== null, "a[href] selector must produce a non-null href");
	const trimmed = href.trim();
	if (trimmed === "") return undefined;
	if (trimmed.startsWith("#")) return undefined;
	try {
		return new URL(trimmed, base.href).toString();
	} catch {
		return undefined;
	}
}

function harvestLinks(html: string, baseUrl: string, sourceUrl: string): ImportLinksResult {
	const { document } = parseHTML(html);
	const base = new URL(baseUrl);
	const sourceNormalized = new URL(sourceUrl).toString();
	const anchors = Array.from(document.querySelectorAll("a[href]"));
	const raw = anchors
		.map((anchor) => resolveHref(anchor.getAttribute("href"), base))
		.filter((url): url is string => url !== undefined)
		.filter((url) => new URL(url).host !== base.host)
		.filter((url) => url !== sourceNormalized);
	return collectImportLinks(raw);
}

export function initExtractLinksFromPageUrl(deps: {
	crawlFetch: CrawlFetch;
	validateUrl: ValidateSaveableUrl;
}): ExtractLinksFromPageUrl {
	return async (pageUrl) => {
		const validation = deps.validateUrl(pageUrl);
		if (validation.status === "ERROR") return { status: "INVALID_URL" };

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		let response: Response;
		try {
			response = await deps.crawlFetch(validation.url, { signal: controller.signal });
		} catch (error) {
			if (controller.signal.aborted) {
				return { status: "FETCH_FAILED", reason: "timeout" };
			}
			const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network";
			return { status: "FETCH_FAILED", reason };
		} finally {
			clearTimeout(timer);
		}

		if (!response.ok) {
			return { status: "FETCH_FAILED", reason: "http", httpStatus: response.status };
		}

		const contentType = response.headers.get("content-type") ?? "";
		if (!contentTypeIsHtml(contentType)) {
			return { status: "UNSUPPORTED_CONTENT_TYPE", contentType };
		}

		const declaredLength = response.headers.get("content-length");
		if (declaredLength !== null && Number(declaredLength) > MAX_PAGE_BYTES) {
			return { status: "FETCH_FAILED", reason: "too_large" };
		}

		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > MAX_PAGE_BYTES) {
			return { status: "FETCH_FAILED", reason: "too_large" };
		}

		const html = new TextDecoder("utf-8").decode(buffer);
		const baseUrl = response.url === "" ? validation.url : response.url;
		const links = harvestLinks(html, baseUrl, validation.url);
		return { status: "OK", links };
	};
}
