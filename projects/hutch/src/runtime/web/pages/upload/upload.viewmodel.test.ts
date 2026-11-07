import assert from "node:assert/strict";
import { AUDIO, BOOK, MEDIA_KINDS, VIDEO } from "@packages/media-contracts";
import {
	acceptAttributeOf,
	detectUploadKind,
	kindsForViewer,
	toUploadStartViewModel,
	transcriptAllowanceMinutesOf,
} from "./upload.viewmodel";

describe("kindsForViewer", () => {
	it("offers a member every kind", () => {
		assert.deepEqual(
			kindsForViewer({
				kinds: MEDIA_KINDS,
				guestKinds: ["book"],
				isSignedIn: true,
			}),
			[BOOK, AUDIO, VIDEO],
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

function mp4Prefix(brand: string): Uint8Array {
	return Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(20)]);
}

describe("detectUploadKind", () => {
	it("takes the kind that claims the file's extension when another kind also sniffs the bytes", () => {
		assert.equal(
			detectUploadKind({ kinds: MEDIA_KINDS, offered: [BOOK, AUDIO, VIDEO], fileName: "talk.MP4", prefix: mp4Prefix("isom") }),
			VIDEO,
		);
	});

	it("finds no kind when the kind that claims the extension is not offered", () => {
		assert.equal(
			detectUploadKind({ kinds: MEDIA_KINDS, offered: [BOOK, AUDIO], fileName: "talk.mp4", prefix: mp4Prefix("isom") }),
			undefined,
		);
	});

	it("sniffs every offered kind when the file has no name", () => {
		assert.equal(
			detectUploadKind({ kinds: MEDIA_KINDS, offered: [BOOK, AUDIO, VIDEO], fileName: undefined, prefix: mp4Prefix("isom") }),
			AUDIO,
		);
	});

	it("sniffs every offered kind when no kind claims the extension", () => {
		assert.equal(
			detectUploadKind({ kinds: MEDIA_KINDS, offered: [BOOK, AUDIO, VIDEO], fileName: "talk.bin", prefix: mp4Prefix("avc1") }),
			VIDEO,
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
