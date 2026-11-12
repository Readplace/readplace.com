import { CurlFetchFailure } from "./curl-fetch";
import { isBlockClassError } from "./persona-fallback";
import { TransportLadderFailure } from "./transport-ladder-failure";

export type FetchRetryDecision =
	| { readonly kind: "retryable"; readonly scope: "local" | "durable"; readonly cause: unknown }
	| { readonly kind: "terminal"; readonly cause: unknown }
	| { readonly kind: "cancelled"; readonly cause: unknown };

type FailureClass = "local" | "durable" | "terminal";

const EARLY_TRANSIENT_CODES = new Set([
	"ECONNRESET",
	"UND_ERR_SOCKET",
	"UND_ERR_CLOSED",
	"H2_STREAM_ENDED_WITHOUT_RESPONSE",
]);

const TRANSIENT_CURL_EXIT_CODES = new Set([52, 56]);

const RATE_LIMITED_STATUS = 429;

function isDeadlineReason(error: unknown): boolean {
	return typeof error === "object" && error !== null && "name" in error && error.name === "TimeoutError";
}

function isEarlyTransient(error: object): boolean {
	if (error instanceof CurlFetchFailure) {
		return error.exitCode !== undefined && TRANSIENT_CURL_EXIT_CODES.has(error.exitCode);
	}
	return "code" in error && typeof error.code === "string" && EARLY_TRANSIENT_CODES.has(error.code);
}

function classifyLadder(failure: TransportLadderFailure): FailureClass {
	if (failure.escalatedStatuses.some(status => status !== RATE_LIMITED_STATUS)) return "terminal";
	const legs = [...failure.previousErrors, failure.cause].map(classifyLeg);
	return legs.includes("terminal") ? "terminal" : "durable";
}

function classifyLeg(error: unknown): FailureClass {
	if (!(error instanceof TransportLadderFailure) && isBlockClassError(error)) return "terminal";
	return classifyChain(error);
}

function classifyLink(link: object): FailureClass | undefined {
	if (isDeadlineReason(link)) return "durable";
	if (isEarlyTransient(link)) return "local";
	if (link instanceof CurlFetchFailure) return link.signal === undefined ? "terminal" : "durable";
	return undefined;
}

function classifyChain(error: unknown): FailureClass {
	let outermost: FailureClass | undefined;
	let link: unknown = error;
	while (typeof link === "object" && link !== null) {
		if (link instanceof TransportLadderFailure) {
			const ladderClass = classifyLadder(link);
			return ladderClass === "terminal" ? "terminal" : (outermost ?? ladderClass);
		}
		const linkClass = classifyLink(link);
		if (linkClass === "terminal") return "terminal";
		outermost ??= linkClass;
		link = "cause" in link ? link.cause : undefined;
	}
	return outermost ?? "terminal";
}

export function decideFetchFailure(params: { error: unknown; parentSignal: AbortSignal }): FetchRetryDecision {
	const { error, parentSignal } = params;
	if (parentSignal.aborted) {
		if (isDeadlineReason(parentSignal.reason)) return { kind: "retryable", scope: "durable", cause: error };
		return { kind: "cancelled", cause: parentSignal.reason };
	}
	const failureClass = classifyChain(error);
	if (failureClass === "terminal") return { kind: "terminal", cause: error };
	return { kind: "retryable", scope: failureClass, cause: error };
}
