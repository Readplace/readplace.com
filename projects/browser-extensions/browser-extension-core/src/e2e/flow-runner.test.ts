import { FlowRunner, stateChanged, pickAction } from "./flow-runner";
import type {
	DriverNavigation,
	FlowState,
	FlowStateHandler,
} from "./flow-state-handler.types";

type TestDriver = { navigatedTo: string | null };

function createTestDriver(): TestDriver {
	return { navigatedTo: null };
}

function createTestNavigation(): DriverNavigation<TestDriver> {
	return {
		navigateTo: async (driver, url) => {
			driver.navigatedTo = url;
		},
		waitForStateChange: async () => {},
	};
}

describe("FlowRunner", () => {
	it("completes when state handler returns complete action", async () => {
		const driver = createTestDriver();
		const stateHandler: FlowStateHandler = {
			detectCurrentState: async () => ({
				activeView: "list-view",
				availableActions: ["complete"],
			}),
			executeAction: async () => {},
		};

		const runner = new FlowRunner(driver, stateHandler, createTestNavigation());
		const result = await runner.run("extension://test/popup.html", {
			maxSteps: 10,
		});

		expect(result.success).toBe(true);
		expect(driver.navigatedTo).toBe("extension://test/popup.html");
	});

	it("returns error when no actions are available", async () => {
		const driver = createTestDriver();
		const stateHandler: FlowStateHandler = {
			detectCurrentState: async () => ({
				activeView: "saving-view",
				availableActions: [],
			}),
			executeAction: async () => {},
		};

		const runner = new FlowRunner(driver, stateHandler, createTestNavigation());
		const result = await runner.run("extension://test/popup.html", {
			maxSteps: 10,
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("No available actions at step 0");
	});

	it("returns error when max steps exceeded", async () => {
		const driver = createTestDriver();
		let detectCount = 0;
		const stateHandler: FlowStateHandler = {
			detectCurrentState: async () => ({
				activeView: `view-${detectCount++}`,
				availableActions: ["some-action"],
			}),
			executeAction: async () => {},
		};

		const runner = new FlowRunner(driver, stateHandler, createTestNavigation());
		const result = await runner.run("extension://test/popup.html", {
			maxSteps: 2,
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("Max steps (2) exceeded");
	});

	it("executes actions and waits for state change", async () => {
		const driver = createTestDriver();
		const executedActions: string[] = [];
		let callCount = 0;

		const stateHandler: FlowStateHandler = {
			detectCurrentState: async () => {
				callCount++;
				if (callCount >= 4) {
					return { activeView: "done", availableActions: ["complete"] };
				}
				return { activeView: `view-${callCount}`, availableActions: ["step-action"] };
			},
			executeAction: async (name) => {
				executedActions.push(name);
			},
		};

		let waitCalled = 0;
		const navigation: DriverNavigation<TestDriver> = {
			navigateTo: async (d, url) => { d.navigatedTo = url; },
			waitForStateChange: async () => { waitCalled++; },
		};

		const runner = new FlowRunner(driver, stateHandler, navigation);
		const result = await runner.run("extension://test/popup.html", { maxSteps: 10 });

		expect(result.success).toBe(true);
		expect(executedActions.length).toBeGreaterThan(0);
		expect(waitCalled).toBeGreaterThan(0);
	});
});

describe("stateChanged", () => {
	it("detects changed active view", () => {
		const previous: FlowState = { activeView: "login-view", availableActions: ["a"] };
		const current: FlowState = { activeView: "list-view", availableActions: ["a"] };
		expect(stateChanged(previous, current)).toBe(true);
	});

	it("detects changed action count", () => {
		const previous: FlowState = { activeView: "login-view", availableActions: ["a"] };
		const current: FlowState = { activeView: "login-view", availableActions: ["a", "b"] };
		expect(stateChanged(previous, current)).toBe(true);
	});

	it("detects changed action names", () => {
		const previous: FlowState = { activeView: "login-view", availableActions: ["a"] };
		const current: FlowState = { activeView: "login-view", availableActions: ["b"] };
		expect(stateChanged(previous, current)).toBe(true);
	});

	it("returns false when state is unchanged", () => {
		const previous: FlowState = { activeView: "login-view", availableActions: ["a", "b"] };
		const current: FlowState = { activeView: "login-view", availableActions: ["a", "b"] };
		expect(stateChanged(previous, current)).toBe(false);
	});
});

describe("pickAction", () => {
	it("prefers new actions over previously seen ones", () => {
		const state: FlowState = { activeView: "login-view", availableActions: ["old-action", "new-action"] };
		expect(pickAction(state, ["old-action"])).toBe("new-action");
	});

	it("falls back to first action when all actions were previously seen", () => {
		const state: FlowState = { activeView: "login-view", availableActions: ["a", "b"] };
		expect(pickAction(state, ["a", "b"])).toBe("a");
	});

	it("picks first action when no previous actions exist", () => {
		const state: FlowState = { activeView: "login-view", availableActions: ["first", "second"] };
		expect(pickAction(state, [])).toBe("first");
	});
});
