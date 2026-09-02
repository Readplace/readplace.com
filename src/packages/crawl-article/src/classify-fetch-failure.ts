import { TERMINAL_NETWORK_CODES } from "./transport-ladder";

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
	let link: unknown = error;
	while (link instanceof Error) {
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
