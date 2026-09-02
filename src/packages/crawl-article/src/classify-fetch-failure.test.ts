import { classifyFailedResponse, classifyFetchError } from "./classify-fetch-failure";

describe("classifyFailedResponse", () => {
	it.each([503, 522, 530])(
		"classifies HTTP %i as origin-unreachable with the status",
		(httpStatus) => {
			expect(classifyFailedResponse({ httpStatus })).toEqual({
				kind: "origin-unreachable",
				httpStatus,
			});
		},
	);

	it.each([500, 502, 504, 521])(
		"leaves HTTP %i as fetch-failed carrying the status",
		(httpStatus) => {
			expect(classifyFailedResponse({ httpStatus })).toEqual({
				kind: "fetch-failed",
				httpStatus,
			});
		},
	);
});

describe("classifyFetchError", () => {
	it.each(["ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"])(
		"classifies terminal network error %s as origin-unreachable with its code",
		(code) => {
			const error = Object.assign(new Error("getaddrinfo failed"), { code });
			expect(classifyFetchError(error)).toEqual({
				kind: "origin-unreachable",
				code,
			});
		},
	);

	it("walks the cause chain to the undici connect-timeout code", () => {
		const cause = Object.assign(new Error("Connect Timeout Error"), {
			code: "UND_ERR_CONNECT_TIMEOUT",
		});
		const wrapper = new Error("fetch failed", { cause });
		expect(classifyFetchError(wrapper)).toEqual({
			kind: "origin-unreachable",
			code: "UND_ERR_CONNECT_TIMEOUT",
		});
	});

	it("classifies a coded error whose code is not origin-unreachable as fetch-failed", () => {
		const error = Object.assign(new Error("socket hang up"), {
			code: "ECONNRESET",
		});
		expect(classifyFetchError(error)).toEqual({ kind: "fetch-failed" });
	});

	it("classifies our own budget TimeoutError (no code) as fetch-failed", () => {
		const timeout = new Error("no response headers within 100000ms");
		timeout.name = "TimeoutError";
		expect(classifyFetchError(timeout)).toEqual({ kind: "fetch-failed" });
	});

	it("classifies a non-Error throw as fetch-failed", () => {
		expect(classifyFetchError("boom")).toEqual({ kind: "fetch-failed" });
	});
});
