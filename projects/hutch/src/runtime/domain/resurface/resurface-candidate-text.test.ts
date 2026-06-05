import assert from "node:assert/strict";
import { resurfaceCandidateText } from "./resurface-candidate-text";

describe("resurfaceCandidateText", () => {
	it("prefers a ready summary", () => {
		assert.equal(
			resurfaceCandidateText({ excerpt: "Excerpt.", summary: { status: "ready", summary: "Summary." } }),
			"Summary.",
		);
	});

	it("falls back to the excerpt when the summary is not ready", () => {
		assert.equal(
			resurfaceCandidateText({ excerpt: "Excerpt.", summary: { status: "pending" } }),
			"Excerpt.",
		);
	});

	it("falls back to the excerpt when there is no summary", () => {
		assert.equal(resurfaceCandidateText({ excerpt: "Excerpt.", summary: undefined }), "Excerpt.");
	});

	it("falls back to the excerpt when a ready summary is empty", () => {
		assert.equal(
			resurfaceCandidateText({ excerpt: "Excerpt.", summary: { status: "ready", summary: "" } }),
			"Excerpt.",
		);
	});
});
