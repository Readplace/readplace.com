import assert from "node:assert/strict";
import { cachedImport } from "./cached-import";

describe("cachedImport", () => {
	it("calls the factory only once across multiple invocations", async () => {
		let callCount = 0;
		const load = cachedImport(async () => {
			callCount++;
			return { value: 42 };
		});

		const first = await load();
		const second = await load();

		assert.equal(callCount, 1);
		assert.equal(first.value, 42);
		assert.strictEqual(first, second);
	});

	it("returns the same promise instance on concurrent calls", () => {
		const load = cachedImport(async () => "module");

		const p1 = load();
		const p2 = load();

		assert.strictEqual(p1, p2);
	});
});
