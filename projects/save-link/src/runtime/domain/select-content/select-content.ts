import assert from "node:assert";
import { z } from "zod";
import type { CandidateId } from "@packages/domain/article";
import { createHash } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	SELECT_CONTENT_SYSTEM_PROMPT,
	type SelectorCandidate,
	buildSelectContentUserMessage,
	labelForIndex,
} from "./select-content-prompt";
import {
	type CreateDeepseekChatCompletion,
	DEEPSEEK_FEATURES,
	type DeepseekCallFailedLogLine,
	type DeepseekChatResponse,
	describeAiProviderError,
	deepseekCallFailedLogLine,
} from "@packages/ai-message";
import { retriable } from "@packages/retriable";
import { DEEPSEEK_MAX_OUTPUT_TOKENS } from "./deepseek-limits";

export type ContentDecision =
	| { kind: "winner"; candidateId: CandidateId; reason: string }
	| { kind: "tie"; candidateIds: CandidateId[]; reason: string }
	| { kind: "none"; reason: string };
type CandidateReadability = { candidateId: CandidateId; readable: boolean }[];

const LabelSchema = z.string().min(1);
const ResponseSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("winner"), candidate: LabelSchema, reason: z.string() }),
	z.object({ kind: z.literal("tie"), candidates: z.array(LabelSchema).min(2), reason: z.string() }),
	z.object({ kind: z.literal("none"), reason: z.string() }),
]).and(z.object({ readability: z.array(z.object({ candidate: LabelSchema, readable: z.boolean() })) }));

export interface SelectionAudit {
	judgedCandidates: { id: CandidateId; contentHash: string }[];
	promptHash: string;
	responseStatus: "completed" | "rejected";
}

export type SelectMostCompleteContent = (params: {
	url: string;
	candidates: readonly SelectorCandidate[];
}) => Promise<ContentDecision & { readability: CandidateReadability; audit: SelectionAudit }>;

const invalidResponse = (reason: string): never => assert.fail(`judge returned an invalid response: ${reason}`);

const NonRetryableRejectionSchema = z.object({ status: z.literal(400) });

const JUDGE_MAX_ATTEMPTS = 2;

type JudgeAttempt =
	| { outcome: "judged"; decision: ContentDecision; readability: CandidateReadability }
	| { outcome: "invalid"; reason: string; issues: string[]; text: string | undefined }
	| { outcome: "rejected" };

export function initSelectMostCompleteContent(deps: {
	createChatCompletion: CreateDeepseekChatCompletion;
	logger: HutchLogger;
	deepseekCallFailedLog: HutchLogger.Typed<DeepseekCallFailedLogLine>;
}): { selectMostCompleteContent: SelectMostCompleteContent } {
	const { createChatCompletion, logger, deepseekCallFailedLog } = deps;
	const selectMostCompleteContent: SelectMostCompleteContent = async (params) => {
		const messages: Parameters<CreateDeepseekChatCompletion>[0]["messages"] = [
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
		const judgeOnce = async (): Promise<JudgeAttempt> => {
			let response: DeepseekChatResponse;
			try {
				response = await createChatCompletion({
					feature: DEEPSEEK_FEATURES.contentSelection,
					temperature: 0,
					max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
					response_format: { type: "json_object" },
					messages,
				});
			} catch (error) {
				if (!NonRetryableRejectionSchema.safeParse(error).success) throw error;
				const failure = describeAiProviderError(error);
				assert(failure.kind !== "unknown", "a 400 rejection is an http provider error");
				deepseekCallFailedLog.error(deepseekCallFailedLogLine({ feature: "select-content", failure, ids: {} }));
				return { outcome: "rejected" };
			}
			logger.info("[SelectContent] completed", {
				url: params.url,
				inputTokens: response.usage?.prompt_tokens ?? "unknown",
				outputTokens: response.usage?.completion_tokens ?? "unknown",
				cacheHitInputTokens: response.usage?.prompt_cache_hit_tokens ?? "unknown",
				cacheMissInputTokens: response.usage?.prompt_cache_miss_tokens ?? "unknown",
			});
			const text = response.choices[0]?.message?.content?.trim();
			const invalid = (reason: string, issues: string[] = []): JudgeAttempt => ({ outcome: "invalid", reason, issues, text });
			if (!text) return invalid("empty response");
			let json: unknown;
			try {
				json = JSON.parse(text);
			} catch {
				return invalid("malformed response");
			}
			const parsed = ResponseSchema.safeParse(json);
			if (!parsed.success) return invalid("schema mismatch", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
			const answer = parsed.data;
			const idByLabel = new Map(params.candidates.map((candidate, index) => [labelForIndex(index), candidate.id]));
			const idsOf = (labels: readonly string[]): CandidateId[] => labels.flatMap((label) => idByLabel.get(label.trim().toUpperCase()) ?? []);
			let decision: ContentDecision = { kind: "none", reason: answer.reason };
			if (answer.kind === "winner") {
				const [candidateId] = idsOf([answer.candidate]);
				if (candidateId === undefined) return invalid("unknown winner candidate");
				decision = { kind: "winner", candidateId, reason: answer.reason };
			}
			if (answer.kind === "tie") {
				const candidateIds = idsOf(answer.candidates);
				if (candidateIds.length !== answer.candidates.length || new Set(candidateIds).size !== candidateIds.length) {
					return invalid("invalid tied candidates");
				}
				decision = { kind: "tie", candidateIds, reason: answer.reason };
			}
			const readability = answer.readability.flatMap((assessment) => idsOf([assessment.candidate]).map((candidateId) => ({ candidateId, readable: assessment.readable })));
			if (answer.readability.length !== idByLabel.size || new Set(readability.map((assessment) => assessment.candidateId)).size !== idByLabel.size) {
				return invalid("incomplete candidate readability");
			}
			const readableIds = new Set(readability.filter((assessment) => assessment.readable).map((assessment) => assessment.candidateId));
			const eligibleIds = decision.kind === "winner" ? [decision.candidateId] : decision.kind === "tie" ? decision.candidateIds : [];
			if (eligibleIds.some((id) => !readableIds.has(id)) || (decision.kind === "none" && readableIds.size > 0)) {
				return invalid("decision contradicts candidate readability");
			}
			return { outcome: "judged", decision, readability };
		};
		let attempt = 0;
		const judgeWithRetry = retriable(async () => {
			attempt += 1;
			const result = await judgeOnce();
			if (result.outcome === "invalid") {
				logger.warn("[SelectContent] invalid response", { url: params.url, attempt, maxAttempts: JUDGE_MAX_ATTEMPTS, reason: result.reason, issues: result.issues, text: result.text ?? "" });
			}
			return result;
		}, { maxAttempts: JUDGE_MAX_ATTEMPTS, retryDelayMs: 0, shouldRetry: (result) => result.outcome === "invalid" });
		const result = await judgeWithRetry();
		if (result.outcome === "rejected") return audited({ kind: "none", reason: "provider rejected request" }, "rejected");
		if (result.outcome === "invalid") return invalidResponse(result.reason);
		return audited(result.decision, "completed", result.readability);
	};
	return { selectMostCompleteContent };
}
