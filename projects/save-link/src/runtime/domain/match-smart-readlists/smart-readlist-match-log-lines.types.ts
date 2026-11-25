import type { ReadlistFitEngine, ReadlistFitVerdict } from "@packages/readlist-fit";

export type SmartReadlistMatchDecidedLine = {
	level: "INFO";
	event: "smart-readlist-match-decided";
	userId: string;
	readlist: string;
	storedKey: string;
	revision: number;
	verdict: ReadlistFitVerdict;
	reason: string;
	filing?: string;
	engine: ReadlistFitEngine;
	model: string;
	purposeVersion: string;
	inputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	cacheHitInputTokens?: number;
	cacheMissInputTokens?: number;
};
