import { INSPECTION_POLL_INTERVAL_SECONDS, inspectionPollBudget } from "./inspection-poll-budget";

describe("inspectionPollBudget", () => {
	it("polls for at least the time a poison book takes to reach its notice", () => {
		const budget = inspectionPollBudget({ lambdaTimeoutSeconds: 120, marginSeconds: 0 });
		expect(budget * INSPECTION_POLL_INTERVAL_SECONDS).toBeGreaterThanOrEqual(2 * (2 * 120) + 30);
	});

	it("raises the budget with the inspection timeout", () => {
		const budget = inspectionPollBudget({ lambdaTimeoutSeconds: 300, marginSeconds: 0 });
		expect(budget * INSPECTION_POLL_INTERVAL_SECONDS).toBeGreaterThanOrEqual(2 * (2 * 300) + 30);
	});
});
