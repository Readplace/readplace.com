import { parseHTML } from "linkedom";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	ArticleHeadMetadata,
	ExtractArticleHeadMetadata,
} from "@packages/test-fixtures/providers/article-head-metadata";

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (compatible; ReadplaceBot/1.0; +https://readplace.com/bot)";
const MAX_BODY_LENGTH = 512 * 1024;

function isHtmlContentType(contentType: string): boolean {
	const lower = contentType.toLowerCase();
	return lower.includes("text/html") || lower.includes("application/xhtml+xml");
}

function resolveIfRelative(
	url: string | null | undefined,
	baseUrl: string,
): string | undefined {
	if (!url) return undefined;
	try {
		return new URL(url, baseUrl).href;
	} catch {
		return undefined;
	}
}

function trimOrUndef(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}

export function initExtractArticleHeadMetadata(deps: {
	fetch: typeof globalThis.fetch;
	logger: HutchLogger;
	timeoutMs?: number;
	userAgent?: string;
}): { extractArticleHeadMetadata: ExtractArticleHeadMetadata } {
	const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const userAgent = deps.userAgent ?? DEFAULT_USER_AGENT;

	const extractArticleHeadMetadata: ExtractArticleHeadMetadata = async ({
		articleUrl,
	}) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await deps.fetch(articleUrl, {
				signal: controller.signal,
				headers: {
					"user-agent": userAgent,
					accept: "text/html,application/xhtml+xml;q=0.9",
				},
			});
			if (!response.ok) {
				deps.logger.warn({
					at: "extractArticleHeadMetadata.nonOk",
					articleUrl,
					status: response.status,
				});
				return {};
			}
			const contentType = response.headers.get("content-type") ?? "";
			if (!isHtmlContentType(contentType)) {
				deps.logger.warn({
					at: "extractArticleHeadMetadata.nonHtml",
					articleUrl,
					contentType,
				});
				return {};
			}
			let body = await response.text();
			if (body.length > MAX_BODY_LENGTH) body = body.slice(0, MAX_BODY_LENGTH);
			const { document } = parseHTML(body);
			const result: ArticleHeadMetadata = {};
			// Trim each candidate before the nullish-coalesce so an empty or
			// whitespace-only og:* tag does not block the more reliable
			// twitter:image / <title> / <meta name="description"> fallback.
			const imageRaw =
				trimOrUndef(
					document
						.querySelector('meta[property="og:image"]')
						?.getAttribute("content"),
				) ??
				trimOrUndef(
					document
						.querySelector('meta[name="twitter:image"]')
						?.getAttribute("content"),
				);
			const imageUrl = resolveIfRelative(imageRaw, articleUrl);
			if (imageUrl) result.imageUrl = imageUrl;
			const title =
				trimOrUndef(
					document
						.querySelector('meta[property="og:title"]')
						?.getAttribute("content"),
				) ?? trimOrUndef(document.querySelector("title")?.textContent);
			if (title) result.title = title;
			const excerpt =
				trimOrUndef(
					document
						.querySelector('meta[property="og:description"]')
						?.getAttribute("content"),
				) ??
				trimOrUndef(
					document
						.querySelector('meta[name="description"]')
						?.getAttribute("content"),
				);
			if (excerpt) result.excerpt = excerpt;
			const siteName = trimOrUndef(
				document
					.querySelector('meta[property="og:site_name"]')
					?.getAttribute("content"),
			);
			if (siteName) result.siteName = siteName;
			return result;
		} catch (error) {
			deps.logger.warn({
				at: "extractArticleHeadMetadata.error",
				articleUrl,
				error: error instanceof Error ? error.message : String(error),
			});
			return {};
		} finally {
			clearTimeout(timer);
		}
	};

	return { extractArticleHeadMetadata };
}
