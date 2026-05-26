import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import { applyDecisions } from "./apply-decisions";
import { buildDiffEntries } from "./build-diff-entries";
import {
	evaluateGuardrails,
	type GuardrailRejection,
} from "../pdf-page-llm-cleanup/guardrails";
import { httpStatusTag } from "../pdf-page-llm-cleanup/http-status-tag";
import type {
	DiffDecision,
	DiffEntry,
	PdfDocumentDiffReviewInput,
	PdfDocumentDiffReviewOutput,
	ReviewDocumentWithLlm,
} from "./pdf-document-diff-review-handler.types";

const DIFF_REVIEW_PROMPT = readFileSync(join(__dirname, "diff-review-prompt.md"), "utf-8");

/* Cap each LLM call's payload at ~100k tokens. Estimated as 4 chars-per-token,
 * so 400k characters of JSON-encoded payload. Past this we chunk by page and
 * run sequential calls — the diff_id numbering is already document-wide so
 * decisions from different chunks can be merged trivially. */
const MAX_TOKENS_PER_CALL = 100_000;
const CHARS_PER_TOKEN = 4;
const TOKEN_BUDGET_CHARS = MAX_TOKENS_PER_CALL * CHARS_PER_TOKEN;

/* Adjacent-page context window. Stage 2 sees the last/first N paragraphs of
 * neighbouring pages so a mid-sentence page break isn't flagged as an error.
 * Three paragraphs is a balance: enough to disambiguate a sentence
 * continuation, not so much that a 75-page document blows the token budget. */
const ADJACENT_PARAGRAPHS = 3;

const InputSchema = z.object({
	pages: z.array(z.object({
		pageIndex: z.number().int().min(0),
		originalText: z.string(),
		cleanedText: z.string(),
	})),
});

const DecisionSchema = z.object({
	diff_id: z.number(),
	decision: z.enum(["APPROVE", "REJECT", "MODIFY", "NEW"]),
	pageIndex: z.number().int().min(0).optional(),
	original: z.string().optional(),
	replacement: z.string().optional(),
	reason: z.string().optional(),
});

const ResponseSchema = z.object({
	decisions: z.array(DecisionSchema),
});

export function initPdfDocumentDiffReviewHandler(deps: {
	reviewDocumentWithLlm: ReviewDocumentWithLlm;
	logger: HutchLogger;
}): (rawInput: unknown) => Promise<PdfDocumentDiffReviewOutput> {
	const { reviewDocumentWithLlm, logger } = deps;

	return async (rawInput) => {
		const input: PdfDocumentDiffReviewInput = InputSchema.parse(rawInput);
		const t0 = Date.now();
		logger.info(`[pdf-document-diff-review] start pages=${input.pages.length}`);

		const entries = buildDiffEntries(input.pages);
		if (entries.length === 0) {
			logger.info(`[pdf-document-diff-review] no diffs to review — passing cleanedText through dt=${Date.now() - t0}ms`);
			return {
				pages: input.pages.map((p) => ({ pageIndex: p.pageIndex, finalText: p.cleanedText })),
				applied: false,
			};
		}

		const chunks = chunkPagesByPayloadSize(input.pages, entries);
		logger.info(`[pdf-document-diff-review] entries=${entries.length} chunks=${chunks.length}`);

		const allDecisions: DiffDecision[] = [];
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		for (const chunk of chunks) {
			const userMessage = buildUserMessage({ allPages: input.pages, chunk });
			try {
				const result = await reviewDocumentWithLlm({
					systemPrompt: DIFF_REVIEW_PROMPT,
					userMessage,
					maxTokens: 8192,
				});
				const parsed = parseDecisions(result.text);
				if (parsed === null) {
					logger.warn(`[pdf-document-diff-review] malformed model response — falling back to cleanedText`);
					return fallbackToCleanedText(input);
				}
				allDecisions.push(...parsed);
				totalInputTokens += result.tokens.input;
				totalOutputTokens += result.tokens.output;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const statusTag = httpStatusTag(error);
				logger.warn(`[pdf-document-diff-review] LLM call failed${statusTag} reason=${message} — falling back to cleanedText`);
				return fallbackToCleanedText(input);
			}
		}

		const { pages: finalPages, log } = applyDecisions({
			pages: input.pages,
			entries,
			decisions: allDecisions,
		});

		// Whole-document guardrail: concatenate originals vs finals (with a
		// blank-line separator) and apply the same length / digit / whitespace
		// checks that Stage 1 uses per page. If the model's decisions taken
		// together would mutate the document beyond the conservative envelope,
		// drop the whole pass back to Stage 1 cleanedText rather than ship a
		// suspect document.
		const documentBefore = input.pages.map((p) => p.originalText).join("\n\n");
		const documentAfter = finalPages.map((p) => p.finalText).join("\n\n");
		const rejection: GuardrailRejection | null = evaluateGuardrails({
			before: documentBefore,
			after: documentAfter,
		});
		if (rejection !== null) {
			logger.warn(`[pdf-document-diff-review] document-level guardrail rejected reason=${rejection} — falling back to cleanedText`);
			return fallbackToCleanedText(input);
		}

		logger.info(`[pdf-document-diff-review] applied=${log.applied} modified=${log.modified} rejected=${log.rejected} newApplied=${log.newApplied} skipped=${log.skippedReasons.length} inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens} dt=${Date.now() - t0}ms`);
		return {
			pages: finalPages,
			applied: true,
			tokens: { input: totalInputTokens, output: totalOutputTokens },
		};
	};
}

function fallbackToCleanedText(input: PdfDocumentDiffReviewInput): PdfDocumentDiffReviewOutput {
	return {
		pages: input.pages.map((p) => ({ pageIndex: p.pageIndex, finalText: p.cleanedText })),
		applied: false,
	};
}

function parseDecisions(text: string): DiffDecision[] | null {
	try {
		const parsed = ResponseSchema.parse(JSON.parse(text));
		return parsed.decisions.map((d) => ({ ...d }));
	} catch {
		return null;
	}
}

interface PageChunk {
	readonly pages: ReadonlyArray<PdfDocumentDiffReviewInput["pages"][number]>;
	readonly entries: ReadonlyArray<DiffEntry>;
}

function chunkPagesByPayloadSize(
	pages: PdfDocumentDiffReviewInput["pages"],
	entries: ReadonlyArray<DiffEntry>,
): PageChunk[] {
	const chunks: PageChunk[] = [];
	let currentPages: typeof pages[number][] = [];
	let currentEntries: DiffEntry[] = [];
	let currentChars = 0;
	for (const page of pages) {
		const pageEntries = entries.filter((e) => e.pageIndex === page.pageIndex);
		const pageChars = estimatePagePayloadChars(page, pageEntries);
		if (pageChars > TOKEN_BUDGET_CHARS && currentPages.length === 0) {
			// A single page already overflows the budget. We still send it on
			// its own — DeepSeek will truncate or error, and the fallback path
			// at the handler level catches that. Bailing here would silently
			// drop a too-large page from review entirely.
			chunks.push({ pages: [page], entries: pageEntries });
			continue;
		}
		if (currentChars + pageChars > TOKEN_BUDGET_CHARS && currentPages.length > 0) {
			chunks.push({ pages: currentPages, entries: currentEntries });
			currentPages = [];
			currentEntries = [];
			currentChars = 0;
		}
		currentPages.push(page);
		currentEntries.push(...pageEntries);
		currentChars += pageChars;
	}
	if (currentPages.length > 0) {
		chunks.push({ pages: currentPages, entries: currentEntries });
	}
	return chunks;
}

function estimatePagePayloadChars(
	page: PdfDocumentDiffReviewInput["pages"][number],
	entries: ReadonlyArray<DiffEntry>,
): number {
	const entryChars = entries.reduce((acc, e) => acc + e.contextBefore.length + e.original.length + e.replacement.length + e.contextAfter.length + 100, 0);
	return page.cleanedText.length + entryChars;
}

function buildUserMessage(params: {
	readonly allPages: PdfDocumentDiffReviewInput["pages"];
	readonly chunk: PageChunk;
}): string {
	const pagesByIndex = new Map(params.allPages.map((p) => [p.pageIndex, p]));
	const pagesPayload = params.chunk.pages.map((page) => {
		const preceding = pagesByIndex.get(page.pageIndex - 1);
		const following = pagesByIndex.get(page.pageIndex + 1);
		return {
			pageIndex: page.pageIndex,
			cleanedText: page.cleanedText,
			...(preceding ? { precedingTail: tailParagraphs(preceding.cleanedText, ADJACENT_PARAGRAPHS) } : {}),
			...(following ? { followingHead: headParagraphs(following.cleanedText, ADJACENT_PARAGRAPHS) } : {}),
		};
	});
	return JSON.stringify({
		pages: pagesPayload,
		diffs: params.chunk.entries,
	});
}

function tailParagraphs(text: string, n: number): string {
	const paragraphs = text.split(/\n\s*\n/);
	return paragraphs.slice(-n).join("\n\n");
}

function headParagraphs(text: string, n: number): string {
	const paragraphs = text.split(/\n\s*\n/);
	return paragraphs.slice(0, n).join("\n\n");
}
