import assert from "node:assert/strict";
import type { Expect, Page } from "@playwright/test";
import {
	type VisualCheckpoint,
	captureCheckpoint,
	initCaptureCheckpoint,
	measuredBox,
} from "./visual-checkpoint";

type Box = { x: number; y: number; width: number; height: number };

type LocatorPlan = { count: number; boxes: (Box | null)[] };

type FakeElement = {
	computedTransform: string;
	style: { transform: string };
	getBoundingClientRect: () => Box;
};

type PagePlan = {
	locators: Record<string, LocatorPlan>;
	viewport: { width: number; height: number } | null;
	scroll: { x: number; y: number };
	pinned: Map<string, { textContent: string | null }>;
	elements?: Map<string, FakeElement>;
};

function fakeElement(input: { rect: Box; computedTransform?: string }): FakeElement {
	return {
		computedTransform: input.computedTransform ?? "none",
		style: { transform: "" },
		getBoundingClientRect: () => input.rect,
	};
}

type LocatorFake = { count: () => Promise<number>; boundingBox: () => Promise<Box | null> };

function createCheckpointPage(plan: PagePlan): {
	page: Page;
	calls: string[];
	locatorFor: (selector: string) => LocatorFake;
} {
	const calls: string[] = [];
	const locators = new Map<string, LocatorFake>();
	const windowStub = {
		scrollX: plan.scroll.x,
		scrollY: plan.scroll.y,
		scrollTo: (x: number, y: number) => {
			calls.push(`scrollTo:${x},${y}`);
		},
		getComputedStyle: (el: FakeElement) => ({ transform: el.computedTransform }),
	};
	const documentStub = {
		fonts: {
			forEach: (visit: (font: { family: string; status: string }) => void) => {
				visit({ family: "Inter", status: "loaded" });
			},
		},
		querySelector: (selector: string) =>
			plan.pinned.get(selector) ?? plan.elements?.get(selector) ?? null,
	};
	const inPage = <T>(run: () => T): T => {
		Reflect.set(globalThis, "window", windowStub);
		Reflect.set(globalThis, "document", documentStub);
		try {
			return run();
		} finally {
			Reflect.deleteProperty(globalThis, "window");
			Reflect.deleteProperty(globalThis, "document");
		}
	};
	const locatorFor = (selector: string): LocatorFake => {
		const known = locators.get(selector);
		if (known) return known;
		const locatorPlan = plan.locators[selector];
		assert.ok(locatorPlan, `no locator planned for "${selector}"`);
		let reads = 0;
		const locator: LocatorFake = {
			count: async () => {
				calls.push(`count:${selector}`);
				return locatorPlan.count;
			},
			boundingBox: async () => {
				calls.push(`boundingBox:${selector}`);
				const box = locatorPlan.boxes[Math.min(reads, locatorPlan.boxes.length - 1)];
				reads += 1;
				return box;
			},
		};
		locators.set(selector, locator);
		return locator;
	};
	const page = {
		evaluate: async (run: (arg: unknown) => unknown, arg?: unknown) => {
			calls.push("evaluate");
			return inPage(() => run(arg));
		},
		waitForFunction: async (predicate: (arg: unknown) => unknown, arg?: unknown) => {
			calls.push("waitForFunction");
			return inPage(() => predicate(arg));
		},
		locator: (selector: string) => {
			calls.push(`locator:${selector}`);
			return locatorFor(selector);
		},
		viewportSize: () => plan.viewport,
	};
	return { page: page as unknown as Page, calls, locatorFor };
}

function createExpectFake(calls: string[]): {
	expect: Pick<Expect, "poll" | "soft">;
	screenshots: { target: unknown; name: string; options?: unknown }[];
	probeCount: () => number;
} {
	const screenshots: { target: unknown; name: string; options?: unknown }[] = [];
	let probes = 0;
	const expectFake = {
		poll: (probe: () => Promise<boolean>) => ({
			toBe: async (wanted: boolean) => {
				for (let attempt = 0; attempt < 10; attempt += 1) {
					probes += 1;
					if ((await probe()) === wanted) return;
				}
				throw new Error(`probe never settled on ${wanted}`);
			},
		}),
		soft: (target: unknown) => ({
			toHaveScreenshot: async (name: string, options?: unknown) => {
				calls.push(`screenshot:${name}`);
				screenshots.push({ target, name, options });
			},
		}),
	};
	return {
		expect: expectFake as unknown as Pick<Expect, "poll" | "soft">,
		screenshots,
		probeCount: () => probes,
	};
}

describe("measuredBox", () => {
	it("reports the laid-out geometry of the selector", async () => {
		const { page } = createCheckpointPage({
			locators: { ".card": { count: 1, boxes: [{ x: 8, y: 16, width: 320, height: 96 }] } },
			viewport: null,
			scroll: { x: 0, y: 0 },
			pinned: new Map(),
		});

		expect(await measuredBox(page, ".card")).toEqual({ x: 8, y: 16, width: 320, height: 96 });
	});

	it("rejects a selector the browser cannot measure", async () => {
		const { page } = createCheckpointPage({
			locators: { ".card": { count: 1, boxes: [null] } },
			viewport: null,
			scroll: { x: 0, y: 0 },
			pinned: new Map(),
		});

		await expect(measuredBox(page, ".card")).rejects.toThrow(
			'".card" must be laid out with a measurable bounding box',
		);
	});
});

describe("captureCheckpoint", () => {
	it("captures an element once its box stops moving, then restores the scroll", async () => {
		const clock = { textContent: "just now" };
		const card = fakeElement({ rect: { x: 0, y: 48, width: 320, height: 96 } });
		const { page, calls, locatorFor } = createCheckpointPage({
			locators: {
				"[data-test-card]": {
					count: 1,
					boxes: [
						{ x: 0, y: 40, width: 320, height: 96 },
						{ x: 0, y: 48, width: 320, height: 96 },
						{ x: 0, y: 48, width: 320, height: 96 },
					],
				},
			},
			viewport: { width: 1280, height: 720 },
			scroll: { x: 24, y: 180 },
			pinned: new Map([["[data-test-clock]", clock]]),
			elements: new Map([["[data-test-card]", card]]),
		});
		const { expect: expectFake, screenshots, probeCount } = createExpectFake(calls);
		const checkpoint: VisualCheckpoint = {
			name: "queue-card",
			settled: async () => {
				calls.push("settled");
			},
			geometry: async () => {
				calls.push("geometry");
			},
			target: "[data-test-card]",
			capture: "element",
			pinnedText: [{ selector: "[data-test-clock]", text: "12 minutes ago" }],
		};

		await initCaptureCheckpoint({ expect: expectFake })(page, checkpoint);

		expect(calls).toEqual([
			"settled",
			"evaluate",
			"waitForFunction",
			"locator:[data-test-card]",
			"count:[data-test-card]",
			"evaluate",
			"locator:[data-test-card]",
			"boundingBox:[data-test-card]",
			"locator:[data-test-card]",
			"boundingBox:[data-test-card]",
			"locator:[data-test-card]",
			"boundingBox:[data-test-card]",
			"geometry",
			"evaluate",
			"screenshot:queue-card.png",
			"evaluate",
			"scrollTo:24,180",
		]);
		expect(probeCount()).toBe(3);
		expect(clock.textContent).toBe("12 minutes ago");
		expect(card.style.transform).toBe("");
		expect(screenshots).toHaveLength(1);
		expect(screenshots[0].name).toBe("queue-card.png");
		expect(screenshots[0].target).toBe(locatorFor("[data-test-card]"));
		expect(screenshots[0].options).toBeUndefined();
	});

	it("clips a page-from-top capture to the viewport width and the target's lower edge", async () => {
		const { page, calls } = createCheckpointPage({
			locators: {
				"[data-test-panel]": {
					count: 1,
					boxes: [{ x: 0, y: 10.2, width: 900, height: 30.4 }],
				},
			},
			viewport: { width: 1280, height: 720 },
			scroll: { x: 0, y: 0 },
			pinned: new Map(),
			elements: new Map([
				["[data-test-panel]", fakeElement({ rect: { x: 0, y: 10, width: 900, height: 30 } })],
			]),
		});
		const { expect: expectFake, screenshots } = createExpectFake(calls);
		const checkpoint: VisualCheckpoint = {
			name: "queue-top",
			settled: async () => {},
			geometry: async () => {},
			target: "[data-test-panel]",
			capture: "page-from-top",
			pinnedText: [],
		};

		await initCaptureCheckpoint({ expect: expectFake })(page, checkpoint);

		expect(screenshots).toHaveLength(1);
		expect(screenshots[0].name).toBe("queue-top.png");
		expect(screenshots[0].target).toBe(page);
		expect(screenshots[0].options).toEqual({
			clip: { x: 0, y: 0, width: 1280, height: 41 },
		});
	});

	function snapPlanFor(card: FakeElement): PagePlan {
		return {
			locators: {
				"[data-test-card]": { count: 1, boxes: [{ x: 8, y: 100.5, width: 320, height: 96 }] },
			},
			viewport: { width: 1280, height: 720 },
			scroll: { x: 0, y: 0 },
			pinned: new Map(),
			elements: new Map([["[data-test-card]", card]]),
		};
	}

	const snapCheckpoint: VisualCheckpoint = {
		name: "snapped-card",
		settled: async () => {},
		geometry: async () => {},
		target: "[data-test-card]",
		capture: "element",
		pinnedText: [],
	};

	it("snaps a fractionally-positioned target to whole pixels before the screenshot", async () => {
		const card = fakeElement({ rect: { x: 8, y: 100.5, width: 320, height: 96 } });
		const { page, calls } = createCheckpointPage(snapPlanFor(card));
		const { expect: expectFake, screenshots } = createExpectFake(calls);

		await initCaptureCheckpoint({ expect: expectFake })(page, snapCheckpoint);

		expect(card.style.transform).toBe("translate(0px, 0.5px)");
		expect(screenshots).toHaveLength(1);
	});

	it("leaves a target that carries its own transform unsnapped", async () => {
		const card = fakeElement({
			rect: { x: 8, y: 100.5, width: 320, height: 96 },
			computedTransform: "matrix(1, 0, 0, 1, 4, 0)",
		});
		const { page, calls } = createCheckpointPage(snapPlanFor(card));
		const { expect: expectFake, screenshots } = createExpectFake(calls);

		await initCaptureCheckpoint({ expect: expectFake })(page, snapCheckpoint);

		expect(card.style.transform).toBe("");
		expect(screenshots).toHaveLength(1);
	});

	it("rejects when the snap target has left the document", async () => {
		const card = fakeElement({ rect: { x: 8, y: 100.5, width: 320, height: 96 } });
		const plan = snapPlanFor(card);
		plan.elements = new Map();
		const { page, calls } = createCheckpointPage(plan);
		const { expect: expectFake } = createExpectFake(calls);

		await expect(initCaptureCheckpoint({ expect: expectFake })(page, snapCheckpoint)).rejects.toThrow(
			'snap target "[data-test-card]" matched nothing',
		);
	});

	it("rejects a page-from-top capture when the browser has no fixed viewport", async () => {
		const { page, calls } = createCheckpointPage({
			locators: {
				"[data-test-panel]": { count: 1, boxes: [{ x: 0, y: 0, width: 900, height: 30 }] },
			},
			viewport: null,
			scroll: { x: 0, y: 0 },
			pinned: new Map(),
			elements: new Map([
				["[data-test-panel]", fakeElement({ rect: { x: 0, y: 0, width: 900, height: 30 } })],
			]),
		});
		const { expect: expectFake } = createExpectFake(calls);
		const checkpoint: VisualCheckpoint = {
			name: "viewportless",
			settled: async () => {},
			geometry: async () => {},
			target: "[data-test-panel]",
			capture: "page-from-top",
			pinnedText: [],
		};

		await expect(initCaptureCheckpoint({ expect: expectFake })(page, checkpoint)).rejects.toThrow(
			'visual checkpoint "viewportless": capture "page-from-top" requires a fixed viewport to size the clip',
		);
	});

	it("rejects a target that matches nothing instead of capturing an empty screenshot", async () => {
		const { page } = createCheckpointPage({
			locators: { "[data-test-gone]": { count: 0, boxes: [] } },
			viewport: { width: 1280, height: 720 },
			scroll: { x: 0, y: 0 },
			pinned: new Map(),
		});
		const checkpoint: VisualCheckpoint = {
			name: "stale-target",
			settled: async () => {},
			geometry: async () => {},
			target: "[data-test-gone]",
			capture: "element",
			pinnedText: [],
		};

		await expect(captureCheckpoint(page, checkpoint)).rejects.toThrow(
			'visual checkpoint "stale-target": target "[data-test-gone]" matched 0 elements',
		);
	});

	it("rejects a pinned-text selector that matches nothing", async () => {
		const { page, calls } = createCheckpointPage({
			locators: {
				"[data-test-card]": { count: 1, boxes: [{ x: 0, y: 0, width: 320, height: 96 }] },
			},
			viewport: { width: 1280, height: 720 },
			scroll: { x: 0, y: 0 },
			pinned: new Map(),
		});
		const { expect: expectFake } = createExpectFake(calls);
		const checkpoint: VisualCheckpoint = {
			name: "stale-pin",
			settled: async () => {},
			geometry: async () => {},
			target: "[data-test-card]",
			capture: "element",
			pinnedText: [{ selector: "[data-test-clock]", text: "12 minutes ago" }],
		};

		await expect(initCaptureCheckpoint({ expect: expectFake })(page, checkpoint)).rejects.toThrow(
			'pinned text selector "[data-test-clock]" matched nothing',
		);
	});
});
