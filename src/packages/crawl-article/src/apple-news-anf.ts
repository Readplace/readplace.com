import { unzipSync } from "node:zlib";
import { z } from "zod";
import type { CrawlFetch } from "./crawl-fetch";
import { escapeHtmlText } from "./pdf-html-helpers";
import { readBodyWithCap } from "./read-capped-body";

const FETCH_TIMEOUT_MS = 10000;
const ANF_ORIGIN = "https://c.apple.news";
const ANF_DOCUMENT_INDEX = 3;
const ANF_HERO_IMAGE_INDEX = 0;
const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;
const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
const STORY_ID = /^[A-Za-z0-9_-]{10,64}$/;
const HEADING_ROLE = /^heading([1-6])?$/;
const HTTP_PROTOCOL = /^https?:$/;

const AnfDocument = z
	.object({
		title: z.string().catch(""),
		components: z.array(z.unknown()).catch([]),
	})
	.catch({ title: "", components: [] });

const AnfLink = z.object({
	type: z.literal("link"),
	URL: z.string(),
	range: z.object({ start: z.number().int().nonnegative(), length: z.number().int().positive() }),
});

type AnfLinkRange = z.infer<typeof AnfLink>;
type TextBlock = { role: string; text: string; links: AnfLinkRange[] };

function storyIdFrom(url: string): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
	if (segments.length !== 1) return undefined;
	if (!STORY_ID.test(segments[0])) return undefined;
	return segments[0];
}

function assetHandle(storyId: string, index: number): string {
	const id = Buffer.from(storyId, "ascii");
	return Buffer.concat([
		Buffer.from([0x02, 0x01, id.length]),
		id,
		Buffer.from([0x00]),
		Buffer.from(String(index), "ascii"),
	]).toString("base64url");
}

function protocolOf(url: string): string {
	try {
		return new URL(url).protocol;
	} catch {
		return "";
	}
}

function linksIn(node: Record<string, unknown>): AnfLinkRange[] {
	const additions = node.additions;
	if (!Array.isArray(additions)) return [];
	const links: AnfLinkRange[] = [];
	for (const addition of additions) {
		const parsed = AnfLink.safeParse(addition);
		if (!parsed.success) continue;
		if (!HTTP_PROTOCOL.test(protocolOf(parsed.data.URL))) continue;
		links.push(parsed.data);
	}
	return links.sort((a, b) => a.range.start - b.range.start);
}

function textBlocksIn(nodes: unknown): TextBlock[] {
	if (!Array.isArray(nodes)) return [];
	const blocks: TextBlock[] = [];
	for (const node of nodes) {
		if (typeof node !== "object" || node === null) continue;
		const record = node as Record<string, unknown>;
		const role = record.role;
		const text = record.text;
		if (typeof role === "string" && typeof text === "string" && text.trim() !== "") {
			blocks.push({ role, text, links: linksIn(record) });
		}
		blocks.push(...textBlocksIn(record.components));
	}
	return blocks;
}

function tagFor(role: string): string | undefined {
	if (role === "body" || role === "intro") return "p";
	if (role === "quote" || role === "pullquote") return "blockquote";
	const heading = HEADING_ROLE.exec(role);
	if (heading === null) return undefined;
	const level = heading[1] === undefined ? 2 : Math.max(Number(heading[1]), 2);
	return `h${level}`;
}

function renderText(block: TextBlock): string {
	let cursor = 0;
	let rendered = "";
	for (const link of block.links) {
		const start = Math.min(link.range.start, block.text.length);
		const end = Math.min(start + link.range.length, block.text.length);
		if (start < cursor) continue;
		rendered += escapeHtmlText(block.text.slice(cursor, start));
		rendered += `<a href="${escapeHtmlText(link.URL)}">${escapeHtmlText(block.text.slice(start, end))}</a>`;
		cursor = end;
	}
	return rendered + escapeHtmlText(block.text.slice(cursor));
}

function renderHtml(params: { title: string; heroImageUrl: string; blocks: TextBlock[] }): string | undefined {
	const body = params.blocks
		.flatMap((block) => {
			const tag = tagFor(block.role);
			if (tag === undefined) return [];
			return [`<${tag}>${renderText(block)}</${tag}>`];
		})
		.join("");
	if (body === "") return undefined;
	const title = escapeHtmlText(params.title);
	const image = escapeHtmlText(params.heroImageUrl);
	return `<html><head><title>${title}</title><meta property="og:image" content="${image}"></head><body><article><h1>${title}</h1><img src="${image}" alt=""/>${body}</article></body></html>`;
}

export type FetchAnfArticle = (params: { url: string }) => Promise<string | undefined>;

export function initFetchAnfArticle(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): FetchAnfArticle {
	const { crawlFetch, logError } = deps;

	return async ({ url }) => {
		const storyId = storyIdFrom(url);
		if (storyId === undefined) return undefined;
		const heroImageUrl = `${ANF_ORIGIN}/${assetHandle(storyId, ANF_HERO_IMAGE_INDEX)}`;
		const documentUrl = `${ANF_ORIGIN}/${assetHandle(storyId, ANF_DOCUMENT_INDEX)}`;
		try {
			const response = await crawlFetch(documentUrl, { budgetMs: FETCH_TIMEOUT_MS });
			if (!response.ok) {
				if (response.status !== 404) {
					logError(`[AppleNewsAnf] document HTTP ${response.status} for ${url}`);
				}
				return undefined;
			}
			const compressed = await readBodyWithCap(response, MAX_COMPRESSED_BYTES);
			const inflated = unzipSync(compressed, { maxOutputLength: MAX_INFLATED_BYTES }).toString("utf8");
			const document = AnfDocument.parse(JSON.parse(inflated));
			const html = renderHtml({
				title: document.title,
				heroImageUrl,
				blocks: textBlocksIn(document.components),
			});
			if (html === undefined) {
				logError(`[AppleNewsAnf] document carries no renderable text for ${url}`);
				return undefined;
			}
			return html;
		} catch (error) {
			logError(`[AppleNewsAnf] document error for ${url}`, error instanceof Error ? error : undefined);
			return undefined;
		}
	};
}
