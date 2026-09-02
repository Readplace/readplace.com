import { crawlFailureReasonForFetchFailure } from "./crawl-failure-reason-for-fetch-failure";

describe("crawlFailureReasonForFetchFailure", () => {
	it("maps an unclassified failure (no crawler verdict) to a bare fetch-failed reason", () => {
		expect(crawlFailureReasonForFetchFailure(undefined)).toEqual({
			kind: "fetch-failed",
		});
	});

	it("carries an origin-unreachable HTTP status through", () => {
		expect(
			crawlFailureReasonForFetchFailure({
				kind: "origin-unreachable",
				httpStatus: 522,
			}),
		).toEqual({ kind: "origin-unreachable", httpStatus: 522 });
	});

	it("carries an origin-unreachable network code through", () => {
		expect(
			crawlFailureReasonForFetchFailure({
				kind: "origin-unreachable",
				code: "ENOTFOUND",
			}),
		).toEqual({ kind: "origin-unreachable", code: "ENOTFOUND" });
	});

	it("carries a fetch-failed HTTP status through", () => {
		expect(
			crawlFailureReasonForFetchFailure({ kind: "fetch-failed", httpStatus: 500 }),
		).toEqual({ kind: "fetch-failed", httpStatus: 500 });
	});
});
