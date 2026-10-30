import type { ReadlistPurposeFields, ReadlistPurposeVersion } from "@packages/domain/readlist";
import type { ReadlistFitEngine } from "./readlist-fit-engine";

export type ReadlistFitVerdict = "keep" | "drop" | "unsure";
export type ReadlistFitCandidate = { id: string; url: string; text: string; summary?: string };
export type ReadlistFitExample = { text: string; host: string; verdict: "keep" | "drop" };
export type ReadlistFitDecision = { id: string; verdict: ReadlistFitVerdict; reason: string };
export type ReadlistFitResult = {
	decisions: ReadlistFitDecision[];
	engine: ReadlistFitEngine;
	model: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		reasoningTokens: number;
		cacheHitInputTokens?: number;
		cacheMissInputTokens?: number;
	};
};
export type DecideReadlistFit = (input: {
	purpose: ReadlistPurposeFields & { version: ReadlistPurposeVersion };
	examples: ReadlistFitExample[];
	candidates: ReadlistFitCandidate[];
	context?: { subject: string; senderEmail: string };
}) => Promise<ReadlistFitResult>;
