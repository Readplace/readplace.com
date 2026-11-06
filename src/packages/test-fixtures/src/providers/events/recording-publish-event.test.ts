import assert from "node:assert/strict";
import { initRecordingPublishEvent } from "./recording-publish-event";

class RefusedDetailError extends Error {}

const urlDetail = {
	parse: (input: unknown) => {
		if (typeof input !== "object" || input === null || !("url" in input) || typeof input.url !== "string") {
			throw new RefusedDetailError("detail has no url");
		}
		return { url: input.url };
	},
};

const LinkSavedEvent = { detailType: "LinkSaved", detailSchema: urlDetail };
const LinkDroppedEvent = { detailType: "LinkDropped", detailSchema: urlDetail };

describe("initRecordingPublishEvent", () => {
	it("records each publish in the order it happened", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();

		await publishEvent(LinkSavedEvent, { url: "https://example.com/a" });
		await publishEvent(LinkDroppedEvent, { url: "https://example.com/b", extra: true });

		assert.deepEqual(published, [
			{ detailType: "LinkSaved", detail: { url: "https://example.com/a" } },
			{ detailType: "LinkDropped", detail: { url: "https://example.com/b" } },
		]);
	});

	it("rejects a detail its schema refuses and records nothing", async () => {
		const { publishEvent, published } = initRecordingPublishEvent();

		await assert.rejects(publishEvent(LinkSavedEvent, { url: 42 }), RefusedDetailError);

		assert.deepEqual(published, []);
	});
});
