import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ReaderArticleHashId } from "@packages/domain/article";
import { embeddableImageFilename, imageFilenameOf } from "./image-filename-of";

const ARTICLE_URL = "https://example.com/article";
const ID = ArticleResourceUniqueId.parse(ARTICLE_URL);
const IMAGE_PREFIX = ID.toS3ImagePrefix();

function embeddedSrc(filename: string): string {
	return ID.toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename });
}

describe("imageFilenameOf", () => {
	const privateItemUrl = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
	const privateFile = `${"ab".repeat(32)}.png`;
	const privateSrc = `/queue/${ReaderArticleHashId.from(privateItemUrl).value}/media/${privateFile}`;

	it("reads a private item's src as its media route", () => {
		expect(imageFilenameOf(privateItemUrl)(privateSrc)).toBe(privateFile);
	});

	it("does not read a hosted article image as a private item's", () => {
		expect(imageFilenameOf(privateItemUrl)(embeddedSrc("abcdef0123456789.jpg"))).toBeUndefined();
	});

	it("reads a public article's src through the shared branch", () => {
		expect(imageFilenameOf(ARTICLE_URL)(embeddedSrc("abcdef0123456789.jpg"))).toBe("abcdef0123456789.jpg");
	});

	it("does not read a media route src as a public article's", () => {
		expect(imageFilenameOf(ARTICLE_URL)(privateSrc)).toBeUndefined();
	});
});

describe("embeddableImageFilename", () => {
	it("returns the filename for an image hosted under this article's prefix", () => {
		expect(
			embeddableImageFilename({ src: embeddedSrc("abcdef0123456789.jpg"), imagePrefix: IMAGE_PREFIX }),
		).toBe("abcdef0123456789.jpg");
	});

	it.each(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].flatMap((extension) => [64, 32].map((digestLength) => ({ extension, digestLength }))))("accepts an owned image with the supported $extension extension and $digestLength-character digests", ({ extension, digestLength }) => {
		const filename = `attempts/${"a".repeat(digestLength)}/${"b".repeat(digestLength)}.${extension}`;
		expect(embeddableImageFilename({ src: embeddedSrc(filename), imagePrefix: IMAGE_PREFIX })).toBe(filename);
		const otherSrc = ArticleResourceUniqueId.parse("https://example.com/other").toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename });
		expect(embeddableImageFilename({ src: otherSrc, imagePrefix: IMAGE_PREFIX })).toBeUndefined();
	});

	it.each([
		`attempts/short/${"b".repeat(64)}.png`,
		`attempts/${"a".repeat(64)}/short.png`,
		`attempts/${"a".repeat(64)}/${"b".repeat(32)}.png`,
		`attempts/${"a".repeat(32)}/${"b".repeat(64)}.png`,
		`attempts/${"a".repeat(36)}/${"b".repeat(36)}.png`,
		`attempts/${"a".repeat(32)}/${"b".repeat(32)}.png.metadata.json`,
		`attempts/${"a".repeat(64)}/${"b".repeat(64)}.png.metadata.json`,
		`attempts/${"a".repeat(64)}/${"b".repeat(64)}.html`,
		`attempts/${"a".repeat(64)}/../${"b".repeat(64)}.png`,
		`attempts/${"a".repeat(64)}/..%2f${"b".repeat(64)}.png`,
		`attempts/${"a".repeat(64)}/%252e%252e%252f${"b".repeat(64)}.png`,
	])("rejects malformed or traversing owned image path %s", (filename) => {
		expect(embeddableImageFilename({ src: embeddedSrc(filename), imagePrefix: IMAGE_PREFIX })).toBeUndefined();
	});

	it("returns undefined for an image on a foreign path", () => {
		expect(
			embeddableImageFilename({ src: "https://origin.example/photo.jpg", imagePrefix: IMAGE_PREFIX }),
		).toBeUndefined();
	});

	it("returns undefined for another article's prefix", () => {
		const otherSrc = ArticleResourceUniqueId.parse("https://example.com/other").toImageCdnUrl({
			baseUrl: "https://cdn.readplace.test",
			filename: "abcdef0123456789.jpg",
		});
		expect(embeddableImageFilename({ src: otherSrc, imagePrefix: IMAGE_PREFIX })).toBeUndefined();
	});

	it.each(["0123456789abcdef.bin", "0123456789abcdef.ico", "0123456789abcdef.bmp", "0123456789abcdef"])("returns undefined for a stored image %s whose format an EPUB cannot carry", (filename) => {
		expect(embeddableImageFilename({ src: embeddedSrc(filename), imagePrefix: IMAGE_PREFIX })).toBeUndefined();
	});

	it("returns the filename for an image whose extension is upper case", () => {
		expect(embeddableImageFilename({ src: embeddedSrc("0123456789abcdef.JPG"), imagePrefix: IMAGE_PREFIX })).toBe(
			"0123456789abcdef.JPG",
		);
	});

	it("returns undefined for a non-absolute URL", () => {
		expect(embeddableImageFilename({ src: "images/local.jpg", imagePrefix: IMAGE_PREFIX })).toBeUndefined();
	});

	it("returns undefined when the filename would traverse out of the images folder", () => {
		const traversal = ID.toImageCdnUrl({ baseUrl: "https://cdn.readplace.test", filename: "sub/evil.jpg" });
		expect(embeddableImageFilename({ src: traversal, imagePrefix: IMAGE_PREFIX })).toBeUndefined();
	});

	it("returns undefined for a malformed percent-encoding", () => {
		expect(
			embeddableImageFilename({ src: "https://cdn.readplace.test/%E0%A4%A", imagePrefix: IMAGE_PREFIX }),
		).toBeUndefined();
	});
});

