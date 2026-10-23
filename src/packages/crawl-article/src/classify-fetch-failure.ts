import { TERMINAL_NETWORK_CODES } from "./transport-ladder";
import { CurlFetchFailure } from "./curl-fetch";
import { TransportLadderFailure } from "./transport-ladder-failure";

export type FetchFailureClassification =
	| { kind: "origin-unreachable"; httpStatus?: number; code?: string }
	| { kind: "fetch-failed"; httpStatus?: number };

const ORIGIN_UNREACHABLE_STATUSES = new Set([503, 522, 530]);

const ORIGIN_UNREACHABLE_ERROR_CODES = new Set([
	...TERMINAL_NETWORK_CODES,
	"UND_ERR_CONNECT_TIMEOUT",
]);

export function classifyFailedResponse(params: {
	httpStatus: number;
}): FetchFailureClassification {
	if (ORIGIN_UNREACHABLE_STATUSES.has(params.httpStatus)) {
		return { kind: "origin-unreachable", httpStatus: params.httpStatus };
	}
	return { kind: "fetch-failed", httpStatus: params.httpStatus };
}

export function classifyFetchError(error: unknown): FetchFailureClassification {
	if (error instanceof TransportLadderFailure) {
		if (error.retryDisposition === "unclassified") return { kind: "fetch-failed" };
		for (const attempt of [...error.previousErrors, error.cause]) {
			const classification = classifyFetchError(attempt);
			if (classification.kind === "origin-unreachable") return classification;
		}
		return { kind: "fetch-failed" };
	}
	let link: unknown = error;
	while (link instanceof Error) {
		if (link instanceof CurlFetchFailure && link.exitCode === 7) return { kind: "origin-unreachable" };
		if (
			"code" in link &&
			typeof link.code === "string" &&
			ORIGIN_UNREACHABLE_ERROR_CODES.has(link.code)
		) {
			return { kind: "origin-unreachable", code: link.code };
		}
		link = link.cause;
	}
	return { kind: "fetch-failed" };
}
