import { KNOWN_TIERS } from "@packages/article-state-types";
import { KIND_BY_TIER } from "./kind-by-tier";

describe("KIND_BY_TIER", () => {
	it("names a candidate kind for every known tier", () => {
		expect(Object.keys(KIND_BY_TIER)).toEqual([...KNOWN_TIERS]);
	});
	it("treats a tier-0 source as a reader's own capture", () => {
		expect(KIND_BY_TIER["tier-0"]).toBe("extension");
	});
});
