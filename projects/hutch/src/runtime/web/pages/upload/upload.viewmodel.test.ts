import assert from "node:assert/strict";
import { BOOK, MEDIA_KINDS } from "@packages/media-contracts";
import { acceptAttributeOf, toUploadStartViewModel } from "./upload.viewmodel";

describe("toUploadStartViewModel", () => {
	it("offers each accepted media type and names each kind's ceiling", () => {
		const vm = toUploadStartViewModel(MEDIA_KINDS);

		assert.deepEqual(vm.contentTypes, ["application/epub+zip"]);
		assert.equal(vm.ceilingLabel, "Book: up to 200 MB");
	});
});

describe("acceptAttributeOf", () => {
	it("lists the kind's file extensions", () => {
		assert.equal(acceptAttributeOf(BOOK), ".epub");
	});
});
