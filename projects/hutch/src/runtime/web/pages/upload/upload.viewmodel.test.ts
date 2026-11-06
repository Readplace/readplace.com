import assert from "node:assert/strict";
import { AUDIO, BOOK, MEDIA_KINDS } from "@packages/media-contracts";
import { acceptAttributeOf, kindsForViewer, toUploadStartViewModel, transcriptAllowanceMinutesOf } from "./upload.viewmodel";

describe("kindsForViewer", () => {
	it("offers a member every kind", () => {
		assert.deepEqual(
			kindsForViewer({
				kinds: MEDIA_KINDS,
				guestKinds: ["book"],
				isSignedIn: true,
			}),
			[BOOK, AUDIO],
		);
	});

	it("offers a guest only the guest kinds", () => {
		assert.deepEqual(
			kindsForViewer({
				kinds: MEDIA_KINDS,
				guestKinds: ["book"],
				isSignedIn: false,
			}),
			[BOOK],
		);
	});
});

describe("toUploadStartViewModel", () => {
	it("names every offered kind in the heading and describes each one", () => {
		const vm = toUploadStartViewModel([BOOK, AUDIO], true, "/upload");

		assert.equal(vm.heading, "Upload a book or an audio file");
		assert.deepEqual(vm.descriptions, [
			"Book: EPUB, DRM-free, up to 200 MB. MOBI and AZW3 are not supported.",
			"Audio: MP3 or M4A, up to 256 MB.",
		]);
	});

	it("names a signed-out viewer a guest and shows them the guest notice", () => {
		const vm = toUploadStartViewModel([BOOK], false, "/upload?features=transcripts");

		assert.equal(vm.heading, "Upload a book");
		assert.equal(vm.startPath, "/upload?features=transcripts");
		assert.equal(vm.viewer, "guest");
		assert.equal(vm.showsGuestNotice, true);
	});

	it("names a signed-in viewer a member and hides the guest notice", () => {
		const vm = toUploadStartViewModel([BOOK, AUDIO], true, "/upload");

		assert.equal(vm.viewer, "member");
		assert.equal(vm.showsGuestNotice, false);
	});
});

describe("transcriptAllowanceMinutesOf", () => {
	it("shows a flagged viewer of a metered kind the allowance in whole minutes", () => {
		assert.equal(transcriptAllowanceMinutesOf({ kinds: [BOOK, AUDIO], metered: true, allowanceSeconds: 1250 }), 20);
	});

	it("shows no allowance to an unflagged viewer or to a viewer offered no metered kind", () => {
		assert.deepEqual(
			[
				transcriptAllowanceMinutesOf({ kinds: [BOOK, AUDIO], metered: false, allowanceSeconds: 1250 }),
				transcriptAllowanceMinutesOf({ kinds: [BOOK], metered: true, allowanceSeconds: 1250 }),
			],
			[undefined, undefined],
		);
	});
});

describe("acceptAttributeOf", () => {
	it("lists every offered kind's file extensions", () => {
		assert.equal(acceptAttributeOf([BOOK, AUDIO]), ".epub,.mp3,.m4a");
	});
});
