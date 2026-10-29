import assert from "node:assert";
import { parseHTML } from "linkedom";
import type { CrawlAndFinalizeArticle, CrawlAndFinalizeResult } from "@packages/finalize-article";

const SHELL_WORD_CEILING = 25;

const OK_STATUS = 200;

const MEDIA_ELEMENT = /<(?:img|video|audio|iframe)\b/i;

const EXECUTABLE_SCRIPT_TYPES = new Set([
	"",
	"module",
	"text/javascript",
	"application/javascript",
	"application/x-javascript",
	"text/ecmascript",
	"application/ecmascript",
]);

function javascriptRequired(): CrawlAndFinalizeResult {
	return { status: "unsupported", reason: "javascript-required", unsupportedReason: { kind: "javascript-required" } };
}

type FetchedResult = Extract<CrawlAndFinalizeResult, { status: "fetched" }>;

function hasExecutableScript(html: string): boolean {
	const { document } = parseHTML(html);
	return [...document.querySelectorAll("script")].some((script) =>
		EXECUTABLE_SCRIPT_TYPES.has((script.getAttribute("type") ?? "").trim().toLowerCase()),
	);
}

function isJavascriptShell(page: {
	html: string;
	articleHtml: string;
	wordCount: number;
	httpStatus: number | undefined;
	mediaType: "html" | "image" | "plain-text";
}): boolean {
	if (page.httpStatus === undefined || page.httpStatus < 200 || page.httpStatus >= 300) return false;
	if (page.mediaType !== "html") return false;
	if (page.wordCount >= SHELL_WORD_CEILING) return false;
	if (MEDIA_ELEMENT.test(page.articleHtml)) return false;
	return hasExecutableScript(page.html);
}

function withoutForcedFields(input: { params: Parameters<CrawlAndFinalizeArticle>[0]; result: FetchedResult }): FetchedResult {
	if (input.params.retainResponseBody || input.params.includeEvaluationHtml) return input.result;
	const { evaluationHtml: _evaluationHtml, httpStatus: _httpStatus, ...requested } = input.result;
	return requested;
}

export function deferJavascriptShells(deps: {
	crawlAndFinalizeArticle: CrawlAndFinalizeArticle;
}): CrawlAndFinalizeArticle {
	const { crawlAndFinalizeArticle } = deps;
	return async (params) => {
		if (params.fetchUrl !== undefined) return crawlAndFinalizeArticle(params);
		const result = await crawlAndFinalizeArticle({ ...params, includeEvaluationHtml: true });
		if (result.status !== "fetched") return result;
		if (result.finalUrl === undefined) return withoutForcedFields({ params, result });
		assert(result.evaluationHtml !== undefined, "a fetch with includeEvaluationHtml must carry the evaluation html");
		const shell = isJavascriptShell({
			html: result.evaluationHtml,
			articleHtml: result.article.html,
			wordCount: result.article.metadata.wordCount,
			httpStatus: params.retainResponseBody ? result.httpStatus : OK_STATUS,
			mediaType: result.article.metadata.directResourceKind ?? "html",
		});
		if (shell) return javascriptRequired();
		return withoutForcedFields({ params, result });
	};
}
