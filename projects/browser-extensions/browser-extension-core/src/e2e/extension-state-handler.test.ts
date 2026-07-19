import { ExtensionStateHandler } from "./extension-state-handler";
import type { ElementQueries } from "./element-queries.types";
import type { FlowAction } from "./flow-state-handler.types";

type TestDriver = Record<string, never>;

function createTestDriver(): TestDriver {
	return {};
}

function createElementQueries(overrides?: Partial<ElementQueries<TestDriver>>): ElementQueries<TestDriver> {
	return {
		findVisibleViewById: async () => false,
		hasBodyClass: async () => false,
		isWindowClosed: async () => false,
		...overrides,
	};
}

describe("ExtensionStateHandler", () => {
	it("returns transitioning view when no visible view is found", async () => {
		const driver = createTestDriver();
		const handler = new ExtensionStateHandler(
			driver,
			async () => false,
			new Map(),
			createElementQueries(),
		);

		const state = await handler.detectCurrentState();
		expect(state.activeView).toBe("transitioning");
	});

	it("detects tab-closed when window is closed", async () => {
		const driver = createTestDriver();
		const handler = new ExtensionStateHandler(
			driver,
			async () => false,
			new Map(),
			createElementQueries({ isWindowClosed: async () => true }),
		);

		const state = await handler.detectCurrentState();
		expect(state.activeView).toBe("tab-closed");
	});

	it("detects server-login view from body class", async () => {
		const driver = createTestDriver();
		const handler = new ExtensionStateHandler(
			driver,
			async () => false,
			new Map(),
			createElementQueries({
				hasBodyClass: async (_d, className) => className === "page-login",
			}),
		);

		const state = await handler.detectCurrentState();
		expect(state.activeView).toBe("server-login");
	});

	it("detects oauth-authorize view from body class", async () => {
		const driver = createTestDriver();
		const handler = new ExtensionStateHandler(
			driver,
			async () => false,
			new Map(),
			createElementQueries({
				hasBodyClass: async (_d, className) => className === "page-oauth-authorize",
			}),
		);

		const state = await handler.detectCurrentState();
		expect(state.activeView).toBe("oauth-authorize");
	});

	it("detects extension view by visible view ID", async () => {
		const driver = createTestDriver();
		const handler = new ExtensionStateHandler(
			driver,
			async () => false,
			new Map(),
			createElementQueries({
				findVisibleViewById: async (_d, viewId) => viewId === "list-view",
			}),
		);

		const state = await handler.detectCurrentState();
		expect(state.activeView).toBe("list-view");
	});

	it("returns complete when success detector returns true", async () => {
		const driver = createTestDriver();
		const handler = new ExtensionStateHandler(
			driver,
			async () => true,
			new Map(),
			createElementQueries({
				findVisibleViewById: async (_d, viewId) => viewId === "list-view",
			}),
		);

		const state = await handler.detectCurrentState();
		expect(state.availableActions).toEqual(["complete"]);
	});

	it("includes available actions in state", async () => {
		const driver = createTestDriver();
		const action: FlowAction<TestDriver> = {
			isAvailable: async () => true,
			execute: async () => {},
		};

		const handler = new ExtensionStateHandler(
			driver,
			async () => false,
			new Map([["click-login", action]]),
			createElementQueries(),
		);

		const state = await handler.detectCurrentState();
		expect(state.availableActions).toEqual(["click-login"]);
	});

	it("excludes unavailable actions from state", async () => {
		const driver = createTestDriver();
		const action: FlowAction<TestDriver> = {
			isAvailable: async () => false,
			execute: async () => {},
		};

		const handler = new ExtensionStateHandler(
			driver,
			async () => false,
			new Map([["unavailable-action", action]]),
			createElementQueries(),
		);

		const state = await handler.detectCurrentState();
		expect(state.availableActions).toEqual([]);
	});

	it("executes a known action", async () => {
		const driver = createTestDriver();
		let executed = false;
		const action: FlowAction<TestDriver> = {
			isAvailable: async () => true,
			execute: async () => { executed = true; },
		};

		const handler = new ExtensionStateHandler(
			driver,
			async () => false,
			new Map([["click-login", action]]),
			createElementQueries(),
		);

		await handler.executeAction("click-login");
		expect(executed).toBe(true);
	});

	it("throws when executing an unknown action", async () => {
		const driver = createTestDriver();
		const handler = new ExtensionStateHandler(
			driver,
			async () => false,
			new Map(),
			createElementQueries(),
		);

		await expect(handler.executeAction("nonexistent")).rejects.toThrow(
			"Action 'nonexistent' not found",
		);
	});
});
