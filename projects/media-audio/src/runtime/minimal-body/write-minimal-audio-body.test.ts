import assert from "node:assert/strict";
import {
	MediaUploadCommittedEvent,
	TierContentExtractedEvent,
} from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { PutTierSource } from "@packages/tier-source";
import { buildAudioBody } from "../keep-audio/audio-body";
import { initWriteMinimalAudioBody } from "./write-minimal-audio-body";

const PARAMS = {
	url: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef",
	userId: MediaUploadCommittedEvent.detailSchema.shape.userId.parse("user-1"),
	saveAttemptId:
		MediaUploadCommittedEvent.detailSchema.shape.saveAttemptId.parse(
			"a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
		),
	title: undefined,
	fileName: "episode-12.mp3",
	durationSeconds: 600,
	time: "2026-11-05T10:00:00Z",
};

function setUp() {
	const tierSources: Parameters<PutTierSource>[0][] = [];
	const published: { event: string; detail: unknown }[] = [];
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({
			event: event.detailType,
			detail: event.detailSchema.parse(detail),
		});
	};
	const write = initWriteMinimalAudioBody({
		putTierSource: async (params) => {
			tierSources.push(params);
		},
		publishEvent,
	});
	return { write, tierSources, published };
}

describe("initWriteMinimalAudioBody", () => {
	it("writes the keep-audio body for the same inputs and announces it under the given save attempt", async () => {
		const { write, tierSources, published } = setUp();

		await write(PARAMS);

		assert.equal(tierSources.length, 1);
		const [source] = tierSources;
		assert.equal(
			source.html,
			buildAudioBody({
				title: undefined,
				fileName: "episode-12.mp3",
				minutes: 10,
			}).html,
		);
		assert.equal(source.metadata.siteName, "Audio");
		assert.equal(source.metadata.attemptId, PARAMS.saveAttemptId);
		assert.deepEqual(published, [
			{
				event: "TierContentExtracted",
				detail: TierContentExtractedEvent.detailSchema.parse({
					url: PARAMS.url,
					saveAttemptId: PARAMS.saveAttemptId,
					candidates: [{ id: source.metadata.id, tier: "tier-0" }],
					userId: PARAMS.userId,
					extractedAt: PARAMS.time,
				}),
			},
		]);
	});

	it("ends the body with the notice line when one is given", async () => {
		const { write, tierSources } = setUp();

		await write({ ...PARAMS, notice: "A notice line." });

		assert.match(tierSources[0].html, /<p>A notice line\.<\/p>$/);
	});
});
