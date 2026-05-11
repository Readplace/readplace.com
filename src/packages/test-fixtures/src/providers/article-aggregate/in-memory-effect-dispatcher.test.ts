import assert from "node:assert/strict";
import { initInMemoryEffectDispatcher } from "./in-memory-effect-dispatcher";

describe("initInMemoryEffectDispatcher", () => {
	it("starts with no dispatched effects", () => {
		const { dispatched } = initInMemoryEffectDispatcher();

		assert.deepEqual(dispatched, []);
	});

	it("records each dispatched effect in call order", async () => {
		const { dispatchEffect, dispatched } = initInMemoryEffectDispatcher();

		await dispatchEffect({ kind: "generate-summary", url: "https://example.com/a" });
		await dispatchEffect({ kind: "generate-summary", url: "https://example.com/b" });

		assert.deepEqual(dispatched, [
			{ kind: "generate-summary", url: "https://example.com/a" },
			{ kind: "generate-summary", url: "https://example.com/b" },
		]);
	});
});
