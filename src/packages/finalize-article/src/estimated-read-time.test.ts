import { estimatedReadTimeFromWordCount } from "./estimated-read-time";

describe("estimatedReadTimeFromWordCount", () => {
	it("rounds up to whole minutes at 238 words per minute", () => {
		expect(estimatedReadTimeFromWordCount(477)).toBe(3);
	});

	it("never reports less than one minute, even for very short articles", () => {
		expect(estimatedReadTimeFromWordCount(10)).toBe(1);
	});
});
