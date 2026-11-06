import assert from "node:assert/strict";
import { MediaUploadStagedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { UploadIdSchema } from "@packages/media-contracts";
import { initEventBridgeMediaUploadStaged } from "./eventbridge-media-upload-staged";

describe("initEventBridgeMediaUploadStaged", () => {
	it("publishes the staged upload as a MediaUploadStaged event", async () => {
		const published: { detailType: string; detail: unknown }[] = [];
		const publishEvent: PublishEvent = async (event, detail) => {
			published.push({ detailType: event.detailType, detail });
		};
		const { publishMediaUploadStaged } = initEventBridgeMediaUploadStaged({ publishEvent });
		const detail = {
			uploadId: UploadIdSchema.parse("0123456789abcdef0123456789abcdef"),
			kind: "book" as const,
			mediaType: "application/epub+zip",
			fileName: "dune.epub",
			size: 2048,
			etag: '"etag-1"',
			stagedAt: "2026-11-06T00:00:00.000Z",
		};

		await publishMediaUploadStaged(detail);

		assert.equal(published.length, 1);
		assert.equal(published[0]?.detailType, "MediaUploadStaged");
		assert.deepEqual(MediaUploadStagedEvent.detailSchema.parse(published[0]?.detail), detail);
	});
});
