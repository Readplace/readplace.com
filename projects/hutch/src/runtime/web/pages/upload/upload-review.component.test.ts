import assert from "node:assert/strict";
import { UploadReviewPage } from "./upload-review.component";

describe("UploadReviewPage", () => {
	it("names a video upload as a video", () => {
		const page = UploadReviewPage({
			state: { view: "rejected", notice: "Refused.", uploadAgainUrl: "/upload" },
			uploadId: "upload-1",
			media: "video",
		});

		assert.equal(page.seo.title, "Upload a video — Readplace");
		assert.equal(page.seo.description, "Review an uploaded video before saving it to Readplace.");
		assert.match(page.content.html, /<h1 class="upload__title">Upload a video<\/h1>/);
	});
});
