import { panelStatusFor } from "./inbox-panel-status";

const SETTLED = {
	isExtracting: false,
	isExtractionFailed: false,
	isStalePending: false,
};

describe("panelStatusFor", () => {
	it("reports each state on its own", () => {
		expect(panelStatusFor({ ...SETTLED, isExtracting: true })).toBe("extracting");
		expect(panelStatusFor({ ...SETTLED, isExtractionFailed: true })).toBe("failed");
		expect(panelStatusFor({ ...SETTLED, isStalePending: true })).toBe("stale");
		expect(panelStatusFor(SETTLED)).toBe("terminal");
	});

	it("keeps polling ahead of a give-up, so a barrier arriving mid-poll does not flip the panel early", () => {
		expect(panelStatusFor({ ...SETTLED, isExtracting: true, isExtractionFailed: true })).toBe(
			"extracting",
		);
	});

	it("prefers the recorded give-up over a spent budget, which only guesses at the same thing", () => {
		expect(
			panelStatusFor({ ...SETTLED, isExtractionFailed: true, isStalePending: true }),
		).toBe("failed");
	});
});
