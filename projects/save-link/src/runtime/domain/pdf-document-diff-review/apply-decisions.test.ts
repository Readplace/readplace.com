import { applyDecisions } from "./apply-decisions";
import type { DiffEntry } from "./pdf-document-diff-review-handler.types";

const samplePage = (overrides: Partial<{ pageIndex: number; originalText: string; cleanedText: string }> = {}) => ({
	pageIndex: 0,
	originalText: "the Vepository in the room.",
	cleanedText: "the Repository in the room.",
	...overrides,
});

const sampleEntry = (overrides: Partial<DiffEntry> = {}): DiffEntry => ({
	diff_id: 1,
	pageIndex: 0,
	charOffset: 4,
	contextBefore: "the",
	original: "Vepository",
	replacement: "Repository",
	contextAfter: "in the room.",
	...overrides,
});

describe("applyDecisions", () => {
	it("APPROVE applies the stage-1 replacement", () => {
		const result = applyDecisions({
			pages: [samplePage()],
			entries: [sampleEntry()],
			decisions: [{ diff_id: 1, decision: "APPROVE" }],
		});
		expect(result.pages[0].finalText).toBe("the Repository in the room.");
		expect(result.log.applied).toBe(1);
	});

	it("REJECT keeps the original Tesseract text for the span", () => {
		const result = applyDecisions({
			pages: [samplePage()],
			entries: [sampleEntry()],
			decisions: [{ diff_id: 1, decision: "REJECT" }],
		});
		expect(result.pages[0].finalText).toBe("the Vepository in the room.");
		expect(result.log.rejected).toBe(1);
	});

	it("MODIFY splices the decision's replacement instead of the stage-1 one", () => {
		const result = applyDecisions({
			pages: [samplePage()],
			entries: [sampleEntry()],
			decisions: [{ diff_id: 1, decision: "MODIFY", replacement: "Depository" }],
		});
		expect(result.pages[0].finalText).toBe("the Depository in the room.");
		expect(result.log.modified).toBe(1);
	});

	it("MODIFY falls back to stage-1 replacement when the decision omits replacement", () => {
		// Strict interpretation: a MODIFY decision without a `replacement` field
		// is malformed; we apply stage 1's replacement so the diff is at least
		// not lost. The decision count still lands in the `modified` bucket so
		// the operator can spot the malformed entry in logs.
		const result = applyDecisions({
			pages: [samplePage()],
			entries: [sampleEntry()],
			decisions: [{ diff_id: 1, decision: "MODIFY" }],
		});
		expect(result.pages[0].finalText).toBe("the Repository in the room.");
	});

	it("an unmatched decision (diff_id not in entries) is silently dropped", () => {
		const result = applyDecisions({
			pages: [samplePage()],
			entries: [sampleEntry({ diff_id: 1 })],
			decisions: [{ diff_id: 99, decision: "APPROVE" }],
		});
		// No matching entry → no change; the page entry has no matching
		// decision → counted as reject (the default for missing decisions).
		expect(result.pages[0].finalText).toBe("the Vepository in the room.");
		expect(result.log.rejected).toBe(1);
	});

	it("rejects an APPROVE that would mutate a digit (per-span guardrail)", () => {
		const result = applyDecisions({
			pages: [{
				pageIndex: 0,
				originalText: "year 1968 happened",
				cleanedText: "year 1986 happened",
			}],
			entries: [sampleEntry({
				original: "1968",
				replacement: "1986",
				charOffset: 5,
			})],
			decisions: [{ diff_id: 1, decision: "APPROVE" }],
		});
		expect(result.pages[0].finalText).toBe("year 1968 happened");
		expect(result.log.skippedReasons).toEqual([
			{ diff_id: 1, reason: "guardrail:digits-mutated" },
		]);
	});

	it("rejects an APPROVE that mutates only one of several digit runs", () => {
		// Sanity check that the multiset comparison fires on a mismatched run
		// even when some runs in the span are identical.
		const result = applyDecisions({
			pages: [{
				pageIndex: 0,
				originalText: "between 12 and 1968 and onward",
				cleanedText: "between 12 and 1986 and onward",
			}],
			entries: [sampleEntry({
				original: "12 and 1968",
				replacement: "12 and 1986",
				charOffset: 8,
			})],
			decisions: [{ diff_id: 1, decision: "APPROVE" }],
		});
		expect(result.pages[0].finalText).toBe("between 12 and 1968 and onward");
		expect(result.log.skippedReasons[0].reason).toBe("guardrail:digits-mutated");
	});

	it("rejects a MODIFY that exceeds 50% length delta", () => {
		const result = applyDecisions({
			pages: [samplePage()],
			entries: [sampleEntry()],
			decisions: [{ diff_id: 1, decision: "MODIFY", replacement: "x" }],
		});
		expect(result.pages[0].finalText).toBe("the Vepository in the room.");
		expect(result.log.skippedReasons[0].reason).toBe("guardrail:length-delta-exceeded");
	});

	it("applies multiple decisions on the same page in reverse-offset order without shifting subsequent offsets", () => {
		const original = "alpha BAD1 beta BAD2 gamma";
		const entries: DiffEntry[] = [
			{ diff_id: 1, pageIndex: 0, charOffset: 6, contextBefore: "alpha", original: "BAD1", replacement: "FIX1", contextAfter: "beta BAD2 gamma" },
			{ diff_id: 2, pageIndex: 0, charOffset: 16, contextBefore: "BAD1 beta", original: "BAD2", replacement: "FIX2", contextAfter: "gamma" },
		];
		const result = applyDecisions({
			pages: [{ pageIndex: 0, originalText: original, cleanedText: "alpha FIX1 beta FIX2 gamma" }],
			entries,
			decisions: [
				{ diff_id: 1, decision: "APPROVE" },
				{ diff_id: 2, decision: "APPROVE" },
			],
		});
		expect(result.pages[0].finalText).toBe("alpha FIX1 beta FIX2 gamma");
		expect(result.log.applied).toBe(2);
	});

	it("NEW entry finds and replaces the literal substring in the post-decision text", () => {
		const result = applyDecisions({
			pages: [{
				pageIndex: 0,
				originalText: "Good text JxagaR garbage continues here.",
				cleanedText: "Good text JxagaR garbage continues here.",
			}],
			entries: [],
			decisions: [{
				diff_id: 100,
				decision: "NEW",
				pageIndex: 0,
				original: "JxagaR garbage ",
				replacement: "",
			}],
		});
		expect(result.pages[0].finalText).toBe("Good text continues here.");
		expect(result.log.newApplied).toBe(1);
	});

	it("NEW entry without pageIndex is silently dropped", () => {
		const result = applyDecisions({
			pages: [samplePage()],
			entries: [],
			decisions: [{ diff_id: 100, decision: "NEW", original: "Vepository", replacement: "" }],
		});
		expect(result.pages[0].finalText).toBe("the Vepository in the room.");
		// No pageIndex → couldn't route to any page → not even tracked in skippedReasons.
		expect(result.log.newApplied).toBe(0);
	});

	it("NEW entry without original or replacement is logged as malformed", () => {
		const result = applyDecisions({
			pages: [samplePage()],
			entries: [],
			decisions: [{ diff_id: 100, decision: "NEW", pageIndex: 0 }],
		});
		expect(result.log.skippedReasons).toEqual([
			{ diff_id: 100, reason: "new:missing-fields" },
		]);
	});

	it("NEW entry whose substring is not found is logged as not-found", () => {
		const result = applyDecisions({
			pages: [samplePage()],
			entries: [],
			// Both sides same length so the per-span length-delta guardrail
			// passes and we exercise the "string not in page" branch.
			decisions: [{ diff_id: 100, decision: "NEW", pageIndex: 0, original: "missing", replacement: "present" }],
		});
		expect(result.log.skippedReasons).toEqual([
			{ diff_id: 100, reason: "new:not-found" },
		]);
		expect(result.pages[0].finalText).toBe("the Vepository in the room.");
	});

	it("NEW entry whose substring matches twice is logged as ambiguous", () => {
		const result = applyDecisions({
			pages: [{
				pageIndex: 0,
				originalText: "alpha JxagaR beta JxagaR gamma",
				cleanedText: "alpha JxagaR beta JxagaR gamma",
			}],
			entries: [],
			decisions: [{ diff_id: 100, decision: "NEW", pageIndex: 0, original: " JxagaR", replacement: "" }],
		});
		expect(result.log.skippedReasons[0].reason).toBe("new:ambiguous-match");
	});

	it("NEW entry that would mutate digits is rejected by the per-span guardrail", () => {
		const result = applyDecisions({
			pages: [{ pageIndex: 0, originalText: "year 1968 here", cleanedText: "year 1968 here" }],
			entries: [],
			decisions: [{ diff_id: 100, decision: "NEW", pageIndex: 0, original: "1968", replacement: "1986" }],
		});
		expect(result.log.skippedReasons[0].reason).toBe("guardrail:digits-mutated");
	});

	it("NEW entry with non-empty original and replacement is bounded by the 50% per-span length delta", () => {
		// "AB" (2 chars) → "AB inserted" (11 chars) is +450% — far above the
		// 0.5 cap. When both sides are non-empty the cap applies, so the model
		// can't replace short OCR runs with arbitrarily long expansions.
		const result = applyDecisions({
			pages: [{ pageIndex: 0, originalText: "ABXYZ", cleanedText: "ABXYZ" }],
			entries: [],
			decisions: [{ diff_id: 100, decision: "NEW", pageIndex: 0, original: "AB", replacement: "AB inserted" }],
		});
		expect(result.log.skippedReasons[0].reason).toBe("guardrail:length-delta-exceeded");
	});

	it("NEW entry that is purely a removal (empty replacement) bypasses the length-delta check so gibberish can be deleted", () => {
		const result = applyDecisions({
			pages: [{
				pageIndex: 0,
				originalText: "Good text JxagaR garbage. More text.",
				cleanedText: "Good text JxagaR garbage. More text.",
			}],
			entries: [],
			decisions: [{ diff_id: 100, decision: "NEW", pageIndex: 0, original: " JxagaR garbage.", replacement: "" }],
		});
		expect(result.log.newApplied).toBe(1);
		expect(result.pages[0].finalText).toBe("Good text More text.");
	});

	it("entries on different pages are applied independently", () => {
		const result = applyDecisions({
			pages: [
				{ pageIndex: 0, originalText: "the Vepository", cleanedText: "the Repository" },
				{ pageIndex: 1, originalText: "anten- na", cleanedText: "antenna" },
			],
			entries: [
				{ diff_id: 1, pageIndex: 0, charOffset: 4, contextBefore: "the", original: "Vepository", replacement: "Repository", contextAfter: "" },
				{ diff_id: 2, pageIndex: 1, charOffset: 0, contextBefore: "", original: "anten- na", replacement: "antenna", contextAfter: "" },
			],
			decisions: [
				{ diff_id: 1, decision: "APPROVE" },
				{ diff_id: 2, decision: "APPROVE" },
			],
		});
		expect(result.pages.map((p) => p.finalText)).toEqual([
			"the Repository",
			"antenna",
		]);
	});
});
