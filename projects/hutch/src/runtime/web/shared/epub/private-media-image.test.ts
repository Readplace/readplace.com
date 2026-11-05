import { ReaderArticleHashId } from "@packages/domain/article";
import { privateMediaImageFilenameOf } from "./private-media-image";

const ITEM_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const OTHER_ITEM_URL = "https://uploads.readplace.invalid/fedcba9876543210fedcba9876543210";
const FILE = `${"ab".repeat(32)}.png`;
const ROUTE_ID = ReaderArticleHashId.from(ITEM_URL).value;

describe("privateMediaImageFilenameOf", () => {
	it("returns the filename of an image under the item's own route id", () => {
		expect(privateMediaImageFilenameOf(ITEM_URL)(`/queue/${ROUTE_ID}/media/${FILE}`)).toBe(FILE);
	});

	it("returns undefined for an image under another item's route id", () => {
		const otherRouteId = ReaderArticleHashId.from(OTHER_ITEM_URL).value;

		expect(privateMediaImageFilenameOf(ITEM_URL)(`/queue/${otherRouteId}/media/${FILE}`)).toBeUndefined();
	});

	it.each(["abc.exe", `${"AB".repeat(32)}.png`, `${"ab".repeat(32)}.exe`])("returns undefined for the invalid file name %s", (file) => {
		expect(privateMediaImageFilenameOf(ITEM_URL)(`/queue/${ROUTE_ID}/media/${file}`)).toBeUndefined();
	});

	it.each([
		`https://cdn.readplace.test/queue/${ROUTE_ID}/media/${FILE}`,
		`/queue/${ROUTE_ID}/media/../${FILE}`,
		`/queue/${ROUTE_ID}/${FILE}`,
	])("returns undefined for the src %s, which is not the media route", (src) => {
		expect(privateMediaImageFilenameOf(ITEM_URL)(src)).toBeUndefined();
	});
});
