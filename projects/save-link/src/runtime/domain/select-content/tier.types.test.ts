import { ReaderViewLoadingSucceeded, TierContentExtractedEvent } from "@packages/hutch-infra-components";
import { KNOWN_TIERS } from "./tier.types";

describe("content tiers on the wire", () => {
	it("lets the tier-extracted event carry every tier the selector judges", () => {
		expect(TierContentExtractedEvent.detailSchema.shape.tier.options).toEqual(KNOWN_TIERS);
	});

	it("lets the reader-view event report every tier the selector can promote", () => {
		expect(ReaderViewLoadingSucceeded.detailSchema.shape.contentSourceTier.unwrap().options).toEqual(KNOWN_TIERS);
	});
});
