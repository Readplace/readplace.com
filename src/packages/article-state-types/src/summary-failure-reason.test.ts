import assert from "node:assert/strict";
import { SummaryFailureReasonSchema } from "./summary-failure-reason";

describe("SummaryFailureReasonSchema", () => {
	it("accepts exhausted-retries with receiveCount", () => {
		const parsed = SummaryFailureReasonSchema.parse({
			kind: "exhausted-retries",
			receiveCount: 3,
		});
		assert.deepEqual(parsed, { kind: "exhausted-retries", receiveCount: 3 });
	});

	it("accepts crawl-failed (no payload)", () => {
		const parsed = SummaryFailureReasonSchema.parse({ kind: "crawl-failed" });
		assert.deepEqual(parsed, { kind: "crawl-failed" });
	});

	it("accepts model-overload (no payload)", () => {
		const parsed = SummaryFailureReasonSchema.parse({ kind: "model-overload" });
		assert.deepEqual(parsed, { kind: "model-overload" });
	});

	it("accepts content-too-large with token count", () => {
		const parsed = SummaryFailureReasonSchema.parse({
			kind: "content-too-large",
			tokens: 70_000,
		});
		assert.deepEqual(parsed, { kind: "content-too-large", tokens: 70_000 });
	});

	it("rejects unknown kinds", () => {
		assert.throws(() => SummaryFailureReasonSchema.parse({ kind: "wat" }));
	});
});
