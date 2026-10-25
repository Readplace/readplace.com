import assert from "node:assert";
import type { CreateAiMessage } from "@packages/ai-message";
import { z } from "zod";
import type { ReadlistFitEngine } from "./readlist-fit-engine";
import { READLIST_FIT_ENGINES } from "./readlist-fit-engine";
import {
	MAX_PROMPT_URL_LENGTH,
	READLIST_FIT_MAX_OUTPUT_TOKENS,
	READLIST_FIT_REASON_MAX_CHARS,
} from "./readlist-fit-limits";
import { READLIST_FIT_PROMPT } from "./readlist-fit-prompt";
import type { DecideReadlistFit, ReadlistFitDecision } from "./readlist-fit.types";

const VerdictPayload = z.object({
	links: z.array(
		z.object({
			id: z.string(),
			verdict: z.enum(["keep", "drop", "unsure"]),
			reason: z.string(),
		}),
	),
});

type Verdict = z.infer<typeof VerdictPayload>["links"][number];

function clipReason(reason: string): string {
	return reason.replace(/\s+/g, " ").trim().slice(0, READLIST_FIT_REASON_MAX_CHARS);
}

function labelsById(input: { verdicts: readonly Verdict[]; known: ReadonlySet<string> }): Map<string, Verdict> {
	const labelled = new Map<string, Verdict>();
	for (const verdict of input.verdicts) {
		assert(input.known.has(verdict.id), `model labelled id ${verdict.id}, which is not in the input`);
		assert(!labelled.has(verdict.id), `model labelled id ${verdict.id} more than once`);
		labelled.set(verdict.id, verdict);
	}
	return labelled;
}

export function initDecideReadlistFitWithDeepseek(deps: {
	createAiMessage: CreateAiMessage;
	engine: ReadlistFitEngine;
}): DecideReadlistFit {
	return async (input) => {
		const response = await deps.createAiMessage({
			max_tokens: READLIST_FIT_MAX_OUTPUT_TOKENS[deps.engine],
			system: READLIST_FIT_PROMPT,
			messages: [
				{
					role: "user",
					content: JSON.stringify({
						keep: input.purpose.keep,
						skip: input.purpose.skip,
						examples: input.examples,
						email:
							input.context === undefined
								? undefined
								: { subject: input.context.subject, from: input.context.senderEmail },
						candidates: input.candidates.map((candidate) => ({
							id: candidate.id,
							url: candidate.url.slice(0, MAX_PROMPT_URL_LENGTH),
							text: candidate.text,
							summary: candidate.summary,
						})),
					}),
				},
			],
		});
		const text = response.content.find((block) => block.type === "text")?.text;
		assert(text, "readlist-fit response has no text block");
		const labelled = labelsById({
			verdicts: VerdictPayload.parse(JSON.parse(text)).links,
			known: new Set(input.candidates.map((candidate) => candidate.id)),
		});
		const decisions: ReadlistFitDecision[] = input.candidates.map((candidate) => {
			const verdict = labelled.get(candidate.id);
			assert(verdict, `model left id ${candidate.id} unlabelled`);
			return { id: candidate.id, verdict: verdict.verdict, reason: clipReason(verdict.reason) };
		});
		return {
			decisions,
			engine: deps.engine,
			model: READLIST_FIT_ENGINES[deps.engine].model,
			usage: {
				inputTokens: response.usage.input_tokens,
				outputTokens: response.usage.output_tokens,
				reasoningTokens: response.usage.reasoning_tokens ?? 0,
				cacheHitInputTokens: response.usage.cache_hit_input_tokens,
				cacheMissInputTokens: response.usage.cache_miss_input_tokens,
			},
		};
	};
}
