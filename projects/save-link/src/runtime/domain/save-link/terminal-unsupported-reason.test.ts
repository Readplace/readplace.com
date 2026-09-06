import { terminalUnsupportedReason } from "./terminal-unsupported-reason";

describe("terminalUnsupportedReason", () => {
	it("returns undefined when there is no structured reason (legacy non-html deferral)", () => {
		expect(terminalUnsupportedReason(undefined)).toBeUndefined();
	});

	it.each([
		{ kind: "non-html-content" as const, contentType: "application/zip" },
		{ kind: "paywall" as const },
		{ kind: "javascript-required" as const },
	])("defers %o to the comprehensive crawl by returning undefined", (reason) => {
		expect(terminalUnsupportedReason(reason)).toBeUndefined();
	});

	it("returns a content-too-large reason unchanged so tier-1 terminalises in-process", () => {
		const reason = { kind: "content-too-large" as const, bytes: 54_090_542 };
		expect(terminalUnsupportedReason(reason)).toBe(reason);
	});
});
