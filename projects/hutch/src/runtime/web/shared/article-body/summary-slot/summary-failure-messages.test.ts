import { messageForSummaryFailure } from "./summary-failure-messages";

describe("messageForSummaryFailure", () => {
	it("maps exhausted-retries to a user-friendly retry explanation (not the raw 'maxReceiveCount' string)", () => {
		const message = messageForSummaryFailure({
			kind: "exhausted-retries",
			receiveCount: 4,
		});

		expect(message).toContain("retried");
		expect(message).not.toContain("SQS");
	});

	it("maps crawl-failed to the cross-axis failure explanation", () => {
		expect(
			messageForSummaryFailure({ kind: "crawl-failed" }),
		).toContain("crawl");
	});

	it("maps model-overload to a transient-failure message", () => {
		expect(messageForSummaryFailure({ kind: "model-overload" })).toContain(
			"overloaded",
		);
	});

	it("maps content-too-large to a payload-size explanation", () => {
		expect(
			messageForSummaryFailure({
				kind: "content-too-large",
				tokens: 70_000,
			}),
		).toContain("too long");
	});
});
