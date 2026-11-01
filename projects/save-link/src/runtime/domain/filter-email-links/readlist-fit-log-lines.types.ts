import type { ReadlistFitEngine } from "@packages/readlist-fit";

export type ReadlistFitDecidedLine = {
	level: "INFO";
	event: "readlist-fit-decided";
	userId: string;
	readlist: string;
	receivedAtMessageId: string;
	engine: ReadlistFitEngine;
	model: string;
	purposeVersion: string;
	links: number;
	kept: number;
	dropped: number;
	unsure: number;
	inputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	cacheHitInputTokens?: number;
	cacheMissInputTokens?: number;
	latencyMs: number;
};

export type ReadlistFitUnsureLine = {
	level: "ERROR";
	event: "readlist-fit-unsure";
	userId: string;
	readlist: string;
	receivedAtMessageId: string;
	ordinal: string;
	reason: string;
	engine: ReadlistFitEngine;
	purposeVersion: string;
};
