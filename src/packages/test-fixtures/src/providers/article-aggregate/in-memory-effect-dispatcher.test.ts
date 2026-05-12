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

	it("records the publish-crawl-article-failed payload (Phase 2 cross-axis writer migration)", async () => {
		const { dispatchEffect, dispatched } = initInMemoryEffectDispatcher();

		await dispatchEffect({
			kind: "publish-crawl-article-failed",
			url: "https://example.com/a",
			reason: "exceeded SQS maxReceiveCount",
			receiveCount: 4,
		});

		assert.deepEqual(dispatched, [
			{
				kind: "publish-crawl-article-failed",
				url: "https://example.com/a",
				reason: "exceeded SQS maxReceiveCount",
				receiveCount: 4,
			},
		]);
	});

	it("records the publish-recrawl-completed payload (Phase 2 cross-axis writer migration)", async () => {
		const { dispatchEffect, dispatched } = initInMemoryEffectDispatcher();

		await dispatchEffect({
			kind: "publish-recrawl-completed",
			url: "https://example.com/a",
		});

		assert.deepEqual(dispatched, [
			{ kind: "publish-recrawl-completed", url: "https://example.com/a" },
		]);
	});
});
