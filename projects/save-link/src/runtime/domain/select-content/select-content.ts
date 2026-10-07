import assert from "node:assert";
import { z } from "zod";
import { type CandidateId, CandidateIdSchema } from "@packages/domain/article";
import { createHash } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	SELECT_CONTENT_SYSTEM_PROMPT,
	type SelectorCandidate,
	buildSelectContentUserMessage,
} from "./select-content-prompt";
import { DEEPSEEK_MODEL, DEEPSEEK_NON_THINKING } from "@packages/ai-message";
import { DEEPSEEK_MAX_OUTPUT_TOKENS } from "./deepseek-limits";

const DecisionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("winner"), candidateId: CandidateIdSchema, reason: z.string() }),
	z.object({ kind: z.literal("tie"), candidateIds: z.array(CandidateIdSchema).min(2), reason: z.string() }),
	z.object({ kind: z.literal("none"), reason: z.string() }),
]);

export type ContentDecision = z.infer<typeof DecisionSchema>;
const ReadabilitySchema = z.array(z.object({ candidateId: CandidateIdSchema, readable: z.boolean() }));
const ResponseSchema = DecisionSchema.and(z.object({ readability: ReadabilitySchema }));
type CandidateReadability = z.infer<typeof ReadabilitySchema>;

export interface SelectionAudit {
	judgedCandidates: { id: CandidateId; contentHash: string }[];
	promptHash: string;
	responseStatus: "completed" | "rejected";
}

export type SelectMostCompleteContent = (params: {
	url: string;
	candidates: readonly SelectorCandidate[];
}) => Promise<ContentDecision & { readability: CandidateReadability; audit: SelectionAudit }>;

type ChatCompletionResponse = {
	choices: Array<{ message?: { content?: string | null } }>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		prompt_cache_hit_tokens?: number;
		prompt_cache_miss_tokens?: number;
	} | null;
};

export type CreateSelectorChatCompletion = (params: {
	model: string;
	max_tokens: number;
	thinking: { type: "disabled" };
	response_format: { type: "json_object" };
	messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}) => Promise<ChatCompletionResponse>;

const invalidResponse = (reason: string): never => assert.fail(`judge returned an invalid response: ${reason}`);

const NonRetryableRejectionSchema = z.object({ status: z.literal(400) });

export function initSelectMostCompleteContent(deps: {
	createChatCompletion: CreateSelectorChatCompletion;
	logger: HutchLogger;
}): { selectMostCompleteContent: SelectMostCompleteContent } {
	const { createChatCompletion, logger } = deps;
	const selectMostCompleteContent: SelectMostCompleteContent = async (params) => {
		const messages: Parameters<CreateSelectorChatCompletion>[0]["messages"] = [
			{ role: "system", content: SELECT_CONTENT_SYSTEM_PROMPT },
			{ role: "user", content: buildSelectContentUserMessage({ ...params, logger }) },
		];
		const audited = (decision: ContentDecision, responseStatus: SelectionAudit["responseStatus"], readability: CandidateReadability = []) => ({
			...decision,
			readability,
			audit: {
				judgedCandidates: params.candidates.map((candidate) => ({ id: candidate.id, contentHash: createHash("sha256").update(candidate.html).digest("hex") })),
				promptHash: createHash("sha256").update(JSON.stringify(messages)).digest("hex"),
				responseStatus,
			},
		});
		let response: ChatCompletionResponse;
		try {
			response = await createChatCompletion({
				model: DEEPSEEK_MODEL,
				thinking: DEEPSEEK_NON_THINKING,
				max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
				response_format: { type: "json_object" },
				messages,
			});
		} catch (error) {
			if (!NonRetryableRejectionSchema.safeParse(error).success) throw error;
			logger.error("[SelectContent] provider rejected the request", { url: params.url, error });
			return audited({ kind: "none", reason: "provider rejected request" }, "rejected");
		}
		logger.info("[SelectContent] completed", {
			url: params.url,
			inputTokens: response.usage?.prompt_tokens ?? "unknown",
			outputTokens: response.usage?.completion_tokens ?? "unknown",
			cacheHitInputTokens: response.usage?.prompt_cache_hit_tokens ?? "unknown",
			cacheMissInputTokens: response.usage?.prompt_cache_miss_tokens ?? "unknown",
		});
		const text = response.choices[0]?.message?.content?.trim();
		if (!text) return invalidResponse("empty response");
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			return invalidResponse("malformed response");
		}
		const parsed = ResponseSchema.safeParse(json);
		if (!parsed.success) return invalidResponse("schema mismatch");
		const decision = parsed.data;
		const ids = new Set(params.candidates.map((candidate) => candidate.id));
		if (decision.kind === "winner" && !ids.has(decision.candidateId)) {
			return invalidResponse("unknown winner candidate");
		}
		if (decision.kind === "tie" && (
			new Set(decision.candidateIds).size !== decision.candidateIds.length ||
			decision.candidateIds.some((id) => !ids.has(id))
		)) {
			return invalidResponse("invalid tied candidates");
		}
		const assessedIds = new Set(decision.readability.map((assessment) => assessment.candidateId));
		if (decision.readability.length !== ids.size || assessedIds.size !== ids.size || decision.readability.some((assessment) => !ids.has(assessment.candidateId))) {
			return invalidResponse("incomplete candidate readability");
		}
		const readableIds = new Set(decision.readability.filter((assessment) => assessment.readable).map((assessment) => assessment.candidateId));
		const eligibleIds = decision.kind === "winner" ? [decision.candidateId] : decision.kind === "tie" ? decision.candidateIds : [];
		if (eligibleIds.some((id) => !readableIds.has(id)) || (decision.kind === "none" && readableIds.size > 0)) {
			return invalidResponse("decision contradicts candidate readability");
		}
		return audited(decision, "completed", decision.readability);
	};
	return { selectMostCompleteContent };
}
