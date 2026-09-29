import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "../readlist/readlist-name.schema";
import { isExcludedLink } from "./inbox-email-link.excluded";

const droppedFor = {
	readlist: ReadlistSlugSchema.parse("a1b2c3d4"),
	readlistLabel: "Work",
	reason: "A product launch, not engineering practice.",
};

describe("isExcludedLink", () => {
	it("excludes a skipped link", () => {
		assert.equal(isExcludedLink({ status: "skipped", droppedFor: undefined }), true);
	});

	it("excludes a link the readlist filter dropped even after its preview crawled", () => {
		assert.equal(isExcludedLink({ status: "crawled", droppedFor }), true);
	});

	it("excludes a dropped link whose preview is still pending", () => {
		assert.equal(isExcludedLink({ status: "pending", droppedFor }), true);
	});

	it("keeps a pending link nothing dropped", () => {
		assert.equal(isExcludedLink({ status: "pending", droppedFor: undefined }), false);
	});

	it("keeps a crawled link nothing dropped", () => {
		assert.equal(isExcludedLink({ status: "crawled", droppedFor: undefined }), false);
	});

	it("keeps a failed link nothing dropped", () => {
		assert.equal(isExcludedLink({ status: "failed", droppedFor: undefined }), false);
	});
});
