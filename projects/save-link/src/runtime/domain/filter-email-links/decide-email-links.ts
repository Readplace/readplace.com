import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateAiMessage } from "@packages/ai-message";
import { type EmailLinkOrdinal, EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import type { HutchLogger } from "@packages/hutch-logger";
import { z } from "zod";
import {
	DROP_REASON_MAX_CHARS,
	FILTER_MAX_OUTPUT_TOKENS,
	MAX_PROMPT_URL_LENGTH,
} from "./filter-email-links-limits";

const DECIDE_EMAIL_LINKS_PROMPT = readFileSync(
	join(__dirname, "decide-email-links-prompt.md"),
	"utf-8",
).replace("{{DROP_REASON_MAX_CHARS}}", String(DROP_REASON_MAX_CHARS));

const VerdictPayload = z.object({
	links: z.array(
		z.object({
			ordinal: z.string(),
			verdict: z.enum(["keep", "drop"]),
			reason: z.string(),
		}),
	),
});

type Verdict = z.infer<typeof VerdictPayload>["links"][number];

export type DecideEmailLinks = (input: {
	purpose: string;
	subject: string;
	senderEmail: string;
	links: { ordinal: EmailLinkOrdinal; url: string; anchorText: string }[];
}) => Promise<{
	kept: EmailLinkOrdinal[];
	dropped: { ordinal: EmailLinkOrdinal; reason: string }[];
	inputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
}>;

function clipReason(reason: string): string {
	return reason.replace(/\s+/g, " ").trim().slice(0, DROP_REASON_MAX_CHARS);
}

function labelsByOrdinal(input: {
	verdicts: readonly Verdict[];
	known: ReadonlySet<EmailLinkOrdinal>;
}): Map<EmailLinkOrdinal, Verdict> {
	const labelled = new Map<EmailLinkOrdinal, Verdict>();
	for (const verdict of input.verdicts) {
		const ordinal = EmailLinkOrdinalSchema.parse(verdict.ordinal);
		assert(input.known.has(ordinal), `model labelled ordinal ${ordinal}, which is not in the input`);
		assert(!labelled.has(ordinal), `model labelled ordinal ${ordinal} more than once`);
		labelled.set(ordinal, verdict);
	}
	return labelled;
}

export function initDecideEmailLinks(deps: {
	createMessage: CreateAiMessage;
	logger: HutchLogger;
}): { decideEmailLinks: DecideEmailLinks } {
	const decideEmailLinks: DecideEmailLinks = async (input) => {
		const response = await deps.createMessage({
			max_tokens: FILTER_MAX_OUTPUT_TOKENS,
			system: DECIDE_EMAIL_LINKS_PROMPT,
			messages: [
				{
					role: "user",
					content: JSON.stringify({
						purpose: input.purpose,
						subject: input.subject,
						from: input.senderEmail,
						links: input.links.map((link) => ({
							ordinal: link.ordinal,
							url: link.url.slice(0, MAX_PROMPT_URL_LENGTH),
							anchorText: link.anchorText,
						})),
					}),
				},
			],
		});
		const text = response.content.find((block) => block.type === "text")?.text;
		assert(text, "decide-email-links response has no text block");
		const labelled = labelsByOrdinal({
			verdicts: VerdictPayload.parse(JSON.parse(text)).links,
			known: new Set(input.links.map((link) => link.ordinal)),
		});

		const kept: EmailLinkOrdinal[] = [];
		const dropped: { ordinal: EmailLinkOrdinal; reason: string }[] = [];
		for (const link of input.links) {
			const verdict = labelled.get(link.ordinal);
			assert(verdict, `model left ordinal ${link.ordinal} unlabelled`);
			if (verdict.verdict === "keep") kept.push(link.ordinal);
			else dropped.push({ ordinal: link.ordinal, reason: clipReason(verdict.reason) });
		}

		const outcome = {
			kept,
			dropped,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
			reasoningTokens: response.usage.reasoning_tokens ?? 0,
		};
		deps.logger.info("[decide-email-links] decided", {
			links: input.links.length,
			kept: kept.length,
			dropped: dropped.length,
			inputTokens: outcome.inputTokens,
			outputTokens: outcome.outputTokens,
			reasoningTokens: outcome.reasoningTokens,
		});
		return outcome;
	};

	return { decideEmailLinks };
}
