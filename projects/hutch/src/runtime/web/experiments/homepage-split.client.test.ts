import { HOMEPAGE_SPLIT, initHomepageSplit } from "./homepage-split.client";

const STORAGE_KEY = "readplace.homepage-split";
const LANDING_A_URL =
	"/landing-a?utm_campaign=homepage-split&utm_medium=experiment&utm_content=variant-a";
const LANDING_B_URL =
	"/landing-b?utm_campaign=homepage-split&utm_medium=experiment&utm_content=variant-b";

function makeLocation(pathname: string) {
	return { pathname, replace: jest.fn() };
}

function makeStorage(overrides: {
	getItem?: (key: string) => string | null;
	setItem?: (key: string, value: string) => void;
} = {}) {
	return {
		getItem: jest.fn(overrides.getItem ?? ((): string | null => null)),
		setItem: jest.fn(overrides.setItem ?? ((): void => undefined)),
	};
}

describe("initHomepageSplit — guards", () => {
	it("does nothing when the experiment is inactive", () => {
		const location = makeLocation("/");
		const storage = makeStorage({});

		initHomepageSplit({
			config: { ...HOMEPAGE_SPLIT, active: false },
			location,
			storage,
			randomByte: () => 0,
		});

		expect(location.replace).not.toHaveBeenCalled();
		expect(storage.setItem).not.toHaveBeenCalled();
	});

	it("does nothing when already on a landing page (anti-loop)", () => {
		const location = makeLocation("/landing-a");
		const storage = makeStorage({});

		initHomepageSplit({ config: HOMEPAGE_SPLIT, location, storage, randomByte: () => 0 });

		expect(location.replace).not.toHaveBeenCalled();
		expect(storage.setItem).not.toHaveBeenCalled();
	});
});

describe("initHomepageSplit — fresh assignment", () => {
	it("assigns and persists variant A for a low random byte, then redirects", () => {
		const location = makeLocation("/");
		const storage = makeStorage({});

		initHomepageSplit({ config: HOMEPAGE_SPLIT, location, storage, randomByte: () => 0 });

		expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "1:variant-a");
		expect(location.replace).toHaveBeenCalledWith(LANDING_A_URL);
	});

	it("assigns and persists variant B for a high random byte, then redirects", () => {
		const location = makeLocation("/");
		const storage = makeStorage({});

		initHomepageSplit({ config: HOMEPAGE_SPLIT, location, storage, randomByte: () => 200 });

		expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "1:variant-b");
		expect(location.replace).toHaveBeenCalledWith(LANDING_B_URL);
	});
});

describe("initHomepageSplit — persistence", () => {
	it("reuses a stored current-epoch assignment without re-rolling or re-writing", () => {
		const location = makeLocation("/");
		const storage = makeStorage({ getItem: () => "1:variant-b" });
		const randomByte = jest.fn(() => 0);

		initHomepageSplit({ config: HOMEPAGE_SPLIT, location, storage, randomByte });

		expect(randomByte).not.toHaveBeenCalled();
		expect(storage.setItem).not.toHaveBeenCalled();
		expect(location.replace).toHaveBeenCalledWith(LANDING_B_URL);
	});

	it("re-buckets when the stored value is from a stale epoch", () => {
		const location = makeLocation("/");
		const storage = makeStorage({ getItem: () => "0:variant-a" });

		initHomepageSplit({ config: HOMEPAGE_SPLIT, location, storage, randomByte: () => 200 });

		expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "1:variant-b");
		expect(location.replace).toHaveBeenCalledWith(LANDING_B_URL);
	});
});

describe("initHomepageSplit — private-mode storage failures", () => {
	it("treats a throwing getItem as unassigned and still redirects", () => {
		const location = makeLocation("/");
		const storage = makeStorage({
			getItem: () => {
				throw new Error("access denied");
			},
		});

		initHomepageSplit({ config: HOMEPAGE_SPLIT, location, storage, randomByte: () => 0 });

		expect(location.replace).toHaveBeenCalledWith(LANDING_A_URL);
	});

	it("swallows a throwing setItem and still redirects", () => {
		const location = makeLocation("/");
		const storage = makeStorage({
			setItem: () => {
				throw new Error("quota exceeded");
			},
		});

		expect(() =>
			initHomepageSplit({ config: HOMEPAGE_SPLIT, location, storage, randomByte: () => 0 }),
		).not.toThrow();
		expect(location.replace).toHaveBeenCalledWith(LANDING_A_URL);
	});
});
