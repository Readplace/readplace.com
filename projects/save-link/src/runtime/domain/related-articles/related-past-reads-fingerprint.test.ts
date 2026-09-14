import assert from "node:assert/strict";
import {
	computePastReadsFingerprint,
} from "./related-past-reads-fingerprint";

const TARGET = {
	url: "example.com/target",
	title: "A title",
	siteName: "Example",
	description: "About the subject",
};

describe("computePastReadsFingerprint", () => {
	it("is a stable sha256 hex digest for the same inputs", () => {
		const a = computePastReadsFingerprint({ target: TARGET, candidateUrls: ["a", "b"] });
		const b = computePastReadsFingerprint({ target: TARGET, candidateUrls: ["a", "b"] });
		assert.equal(a, b);
		assert.match(a, /^[0-9a-f]{64}$/);
	});

	it("ignores candidate order so a reshuffled read index reuses the cache", () => {
		const a = computePastReadsFingerprint({ target: TARGET, candidateUrls: ["a", "b", "c"] });
		const b = computePastReadsFingerprint({ target: TARGET, candidateUrls: ["c", "a", "b"] });
		assert.equal(a, b);
	});

	it("changes when the candidate set changes", () => {
		const a = computePastReadsFingerprint({ target: TARGET, candidateUrls: ["a", "b"] });
		const b = computePastReadsFingerprint({ target: TARGET, candidateUrls: ["a", "b", "c"] });
		assert.notEqual(a, b);
	});

	it("changes when the article being read changes", () => {
		const a = computePastReadsFingerprint({ target: TARGET, candidateUrls: ["a"] });
		const b = computePastReadsFingerprint({
			target: { ...TARGET, description: "A different summary" },
			candidateUrls: ["a"],
		});
		assert.notEqual(a, b);
	});
});
