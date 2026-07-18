import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateAiMessage } from "@packages/ai-message";
import type { HutchLogger } from "@packages/hutch-logger";
import { z } from "zod";
import {
	type EmailLinkOrdinal,
	EmailLinkOrdinalSchema,
	type EmailLinkSkipReason,
} from "@packages/domain/inbox";

const TRIAGE_PROMPT = readFileSync(join(__dirname, "triage-email-links-prompt.md"), "utf-8");

/** Verdicts are keyed by ordinal, so the model never needs the full URL — a
 * shared cap keeps a 200-link email inside the model's context window. */
const MAX_PROMPT_URL_LENGTH = 300;
const TRIAGE_MAX_OUTPUT_TOKENS = 8192;
const TRIAGE_MAX_ATTEMPTS = 2;

const EMAIL_LINK_TRIAGE_CATEGORIES = ["article", "noise", "ad", "menu", "subscription"] as const;
export type EmailLinkTriageCategory = (typeof EMAIL_LINK_TRIAGE_CATEGORIES)[number];

export const LLM_SKIP_REASONS: Record<
	Exclude<EmailLinkTriageCategory, "article">,
	EmailLinkSkipReason
> = {
	noise: "llm-noise",
	ad: "llm-ad",
	menu: "llm-menu",
	subscription: "llm-subscription",
};

const TriagePayload = z.object({
	links: z.array(
		z.object({
			ordinal: z.string(),
			category: z.enum(EMAIL_LINK_TRIAGE_CATEGORIES),
		}),
	),
});

export type TriageEmailLinks = (input: {
	subject: string;
	from: string;
	links: { ordinal: EmailLinkOrdinal; url: string; anchorText: string }[];
}) => Promise<
	| { status: "triaged"; categories: Map<EmailLinkOrdinal, EmailLinkTriageCategory> }
	| { status: "unavailable" }
>;

export function initTriageEmailLinks(deps: {
	createAiMessage: CreateAiMessage;
	logger: HutchLogger;
}): { triageEmailLinks: TriageEmailLinks } {
	const requestVerdicts = async (
		input: Parameters<TriageEmailLinks>[0],
	): Promise<Map<EmailLinkOrdinal, EmailLinkTriageCategory> | undefined> => {
		const response = await deps.createAiMessage({
				max_tokens: TRIAGE_MAX_OUTPUT_TOKENS,
				system: TRIAGE_PROMPT,
				messages: [
					{
						role: "user",
						content: JSON.stringify({
							subject: input.subject,
							from: input.from,
							links: input.links.map((link) => ({
								ordinal: link.ordinal,
								url: link.url.slice(0, MAX_PROMPT_URL_LENGTH),
								anchorText: link.anchorText,
							})),
						}),
					},
				],
				output_config: {
					format: {
						type: "json_schema",
						schema: {
							type: "object",
							properties: {
								links: {
									type: "array",
									items: {
										type: "object",
										properties: {
											ordinal: { type: "string" },
											category: { type: "string", enum: [...EMAIL_LINK_TRIAGE_CATEGORIES] },
										},
										required: ["ordinal", "category"],
										additionalProperties: false,
									},
								},
							},
							required: ["links"],
							additionalProperties: false,
						},
					},
				},
		});
		const textBlock = response.content.find((block) => block.type === "text");
		const text = textBlock?.text;
		if (text === undefined) {
			deps.logger.warn("[triage-email-links] no text block in response");
			return undefined;
		}
		const parsed = TriagePayload.safeParse(JSON.parse(text));
		if (!parsed.success) {
			deps.logger.warn("[triage-email-links] response failed validation", {
				issues: parsed.error.issues,
			});
			return undefined;
		}
		const known = new Set<string>(input.links.map((link) => link.ordinal));
		const categories = new Map<EmailLinkOrdinal, EmailLinkTriageCategory>();
		for (const verdict of parsed.data.links) {
			const ordinal = EmailLinkOrdinalSchema.safeParse(verdict.ordinal);
			if (!ordinal.success || !known.has(ordinal.data)) continue;
			categories.set(ordinal.data, verdict.category);
		}
		return categories;
	};

	const triageEmailLinks: TriageEmailLinks = async (input) => {
		for (let attempt = 1; attempt <= TRIAGE_MAX_ATTEMPTS; attempt += 1) {
			try {
				const categories = await requestVerdicts(input);
				if (categories !== undefined) return { status: "triaged", categories };
			} catch (error) {
				deps.logger.warn("[triage-email-links] attempt failed", { attempt, error });
			}
		}
		deps.logger.error("[triage-email-links] unavailable, remaining links crawl unfiltered");
		return { status: "unavailable" };
	};

	return { triageEmailLinks };
}
