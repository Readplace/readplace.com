import { batchFromSingular } from "./batch-from-singular";

describe("batchFromSingular", () => {
	it("keys every input url to the singular's result, in one loop", async () => {
		const seen: string[] = [];
		const singular = async (url: string) => {
			seen.push(url);
			return url.endsWith("miss") ? undefined : `value:${url}`;
		};

		const batch = batchFromSingular(singular);
		const result = await batch(["https://a", "https://b", "https://miss"]);

		expect(seen).toEqual(["https://a", "https://b", "https://miss"]);
		expect(result.get("https://a")).toBe("value:https://a");
		expect(result.get("https://b")).toBe("value:https://b");
		expect(result.has("https://miss")).toBe(true);
		expect(result.get("https://miss")).toBeUndefined();
	});

	it("returns an empty map for empty input without calling the singular", async () => {
		let calls = 0;
		const batch = batchFromSingular(async () => {
			calls += 1;
			return "x";
		});

		const result = await batch([]);

		expect(result.size).toBe(0);
		expect(calls).toBe(0);
	});
});
