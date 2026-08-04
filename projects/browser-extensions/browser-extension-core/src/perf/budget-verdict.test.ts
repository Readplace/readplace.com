import { assertWithinBudget, measureUntilVerdict } from "./budget-verdict";

describe("assertWithinBudget", () => {
	it("accepts a mean under the budget", () => {
		expect(() =>
			assertWithinBudget({ what: "a save", meanMs: 99.4, budgetMs: 110 }),
		).not.toThrow();
	});

	it("reports a mean that exactly reaches the budget as a breach", () => {
		expect(() =>
			assertWithinBudget({ what: "a save", meanMs: 110, budgetMs: 110 }),
		).toThrow("a save took 110ms on average, over the 110ms budget");
	});

	it("reports a breached save budget with the rounded mean", () => {
		expect(() =>
			assertWithinBudget({ what: "a save", meanMs: 137.6, budgetMs: 110 }),
		).toThrow("a save took 138ms on average, over the 110ms budget");
	});

	it("reports a breached bulk budget naming the tabs it saved", () => {
		expect(() =>
			assertWithinBudget({
				what: "saving 100 tabs",
				meanMs: 2400,
				budgetMs: 2000,
			}),
		).toThrow("saving 100 tabs took 2400ms on average, over the 2000ms budget");
	});
});

describe("measureUntilVerdict", () => {
	it("measures once when the first attempt reaches a verdict", async () => {
		const diagnostics: string[] = [];
		let measures = 0;

		await measureUntilVerdict({
			maxAttempts: 3,
			diagnostic: (message) => diagnostics.push(message),
			measure: async () => {
				measures += 1;
			},
		});

		expect(measures).toBe(1);
		expect(diagnostics).toEqual([]);
	});

	it("re-runs a suite whose browser died and keeps the verdict of the run that finished", async () => {
		const diagnostics: string[] = [];
		let measures = 0;

		await measureUntilVerdict({
			maxAttempts: 3,
			diagnostic: (message) => diagnostics.push(message),
			measure: async () => {
				measures += 1;
				if (measures < 3) {
					const err = new Error("session deleted as the browser has closed");
					err.name = "NoSuchSessionError";
					throw err;
				}
			},
		});

		expect(measures).toBe(3);
		expect(diagnostics).toEqual([
			"perf attempt 1 of 3 failed, re-running: NoSuchSessionError: session deleted as the browser has closed",
			"perf attempt 2 of 3 failed, re-running: NoSuchSessionError: session deleted as the browser has closed",
		]);
	});

	it("reports a breached budget on the first attempt rather than re-rolling it", async () => {
		const diagnostics: string[] = [];
		let measures = 0;

		await expect(
			measureUntilVerdict({
				maxAttempts: 3,
				diagnostic: (message) => diagnostics.push(message),
				measure: async () => {
					measures += 1;
					assertWithinBudget({ what: "a save", meanMs: 400, budgetMs: 110 });
				},
			}),
		).rejects.toThrow("a save took 400ms on average, over the 110ms budget");

		expect(measures).toBe(1);
		expect(diagnostics).toEqual([]);
	});

	it("surfaces the last failure when every attempt fails", async () => {
		const diagnostics: string[] = [];
		let measures = 0;

		await expect(
			measureUntilVerdict({
				maxAttempts: 3,
				diagnostic: (message) => diagnostics.push(message),
				measure: async () => {
					measures += 1;
					throw new Error(`login stalled on attempt ${measures}`);
				},
			}),
		).rejects.toThrow("login stalled on attempt 3");

		expect(measures).toBe(3);
		expect(diagnostics).toEqual([
			"perf attempt 1 of 3 failed, re-running: Error: login stalled on attempt 1",
			"perf attempt 2 of 3 failed, re-running: Error: login stalled on attempt 2",
		]);
	});

	it("measures once when the caller allows a single attempt", async () => {
		const diagnostics: string[] = [];
		let measures = 0;

		await expect(
			measureUntilVerdict({
				maxAttempts: 1,
				diagnostic: (message) => diagnostics.push(message),
				measure: async () => {
					measures += 1;
					throw new Error("chrome exited");
				},
			}),
		).rejects.toThrow("chrome exited");

		expect(measures).toBe(1);
		expect(diagnostics).toEqual([]);
	});

	it("describes a thrown value that is not an error", async () => {
		const diagnostics: string[] = [];
		let measures = 0;

		await measureUntilVerdict({
			maxAttempts: 2,
			diagnostic: (message) => diagnostics.push(message),
			measure: async () => {
				measures += 1;
				if (measures === 1) throw "geckodriver went away";
			},
		});

		expect(diagnostics).toEqual([
			"perf attempt 1 of 2 failed, re-running: geckodriver went away",
		]);
	});
});
