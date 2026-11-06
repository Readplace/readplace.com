import assert from "node:assert/strict";
import { BOOK, MEDIA_KINDS } from "@packages/media-contracts";
import { acceptAttributeOf, toUploadStartViewModel } from "./upload.viewmodel";

describe("toUploadStartViewModel", () => {
	it("offers each accepted media type and names each kind's ceiling", () => {
		const vm = toUploadStartViewModel(MEDIA_KINDS, true);

		assert.deepEqual(vm.contentTypes, ["application/epub+zip"]);
		assert.equal(vm.ceilingLabel, "Book: up to 200 MB");
	});

	it("names a signed-out viewer a guest and shows them the guest notice", () => {
		const vm = toUploadStartViewModel(MEDIA_KINDS, false);

		assert.equal(vm.viewer, "guest");
		assert.equal(vm.showsGuestNotice, true);
	});

	it("names a signed-in viewer a member and hides the guest notice", () => {
		const vm = toUploadStartViewModel(MEDIA_KINDS, true);

		assert.equal(vm.viewer, "member");
		assert.equal(vm.showsGuestNotice, false);
	});
});

describe("acceptAttributeOf", () => {
	it("lists the kind's file extensions", () => {
		assert.equal(acceptAttributeOf(BOOK), ".epub");
	});
});
