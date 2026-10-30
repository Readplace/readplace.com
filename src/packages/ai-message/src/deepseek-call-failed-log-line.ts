import { z } from "zod";

const ThrownProviderErrorSchema = z.object({
	name: z.string().optional(),
	message: z.string().optional(),
	stack: z.string().optional(),
	status: z.number().nullish(),
	code: z.union([z.string(), z.number()]).nullish(),
	requestID: z.string().nullish(),
	cause: z.unknown().optional(),
});

type ThrownProviderError = z.infer<typeof ThrownProviderErrorSchema>;

export type DeepseekFeature =
	| "select-content"
	| "select-most-complete-content"
	| "recrawl-content-extracted"
	| "refresh-content-extracted"
	| "reselect-after-removal"
	| "generate-summary"
	| "compute-related-articles"
	| "compute-related-past-reads"
	| "filter-email-links"
	| "triage-email-links"
	| "pdf-page-llm-cleanup"
	| "pdf-page-html-convert"
	| "pdf-document-diff-review";

export type AiProviderError = {
	kind: "http" | "timeout" | "connection";
	status?: number;
	code?: string | number;
	message: string;
	stack?: string;
};

function providerErrorKind(error: ThrownProviderError): AiProviderError["kind"] | "unknown" {
	if (typeof error.status === "number") return "http";
	if (
		error.message === "Request timed out." ||
		error.message === "Request was aborted." ||
		error.name === "AbortError"
	) {
		return "timeout";
	}
	if (error.message === "Connection error." || (error.name === "TypeError" && error.cause !== undefined)) {
		return "connection";
	}
	return "unknown";
}

export function describeAiProviderError(thrown: unknown): AiProviderError | { kind: "unknown" } {
	const parsed = ThrownProviderErrorSchema.safeParse(thrown);
	if (!parsed.success) return { kind: "unknown" };
	const error = parsed.data;
	const kind = providerErrorKind(error);
	if (kind === "unknown") return { kind };
	return {
		kind,
		status: error.status ?? undefined,
		code: error.code ?? undefined,
		message: error.message ?? "",
		stack: error.stack,
	};
}

export type DeepseekCallFailedLogLine = {
	level: "ERROR";
	event: "deepseek-call-failed";
	feature: DeepseekFeature;
	kind: AiProviderError["kind"];
	status?: number;
	code?: string | number;
	message: string;
	stack?: string;
	receiveCount?: number;
	messageId?: string;
	saveAttemptId?: string;
	userId?: string;
	receivedAtMessageId?: string;
	readlist?: string;
	attempt?: number;
	pageIndex?: number;
};

export function deepseekCallFailedLogLine(input: {
	feature: DeepseekFeature;
	failure: AiProviderError;
	receiveCount?: number;
	messageId?: string;
	ids: Pick<
		DeepseekCallFailedLogLine,
		"saveAttemptId" | "userId" | "receivedAtMessageId" | "readlist" | "attempt" | "pageIndex"
	>;
}): DeepseekCallFailedLogLine {
	return {
		level: "ERROR",
		event: "deepseek-call-failed",
		feature: input.feature,
		kind: input.failure.kind,
		status: input.failure.status,
		code: input.failure.code,
		message: input.failure.message,
		stack: input.failure.stack,
		receiveCount: input.receiveCount,
		messageId: input.messageId,
		...input.ids,
	};
}
