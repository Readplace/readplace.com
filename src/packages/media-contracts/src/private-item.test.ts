import assert from "node:assert/strict";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	isPrivateItemIdentity,
	mintPrivateItemUrl,
	PrivateItemUrlSchema,
	uploadIdOfPrivateItemUrl,
} from "./private-item";
import { UploadIdSchema } from "./upload-id";

const HEX = "0123456789abcdef0123456789abcdef";
const UPLOAD_ID = UploadIdSchema.parse(HEX);

describe("mintPrivateItemUrl", () => {
	it("places the upload id under the private host", () => {
		assert.equal(mintPrivateItemUrl(UPLOAD_ID), `https://uploads.readplace.invalid/${HEX}`);
	});

	it("mints a URL the schema parses back", () => {
		const url = mintPrivateItemUrl(UPLOAD_ID);

		assert.equal(PrivateItemUrlSchema.parse(`${url}`), url);
	});

	it("normalises to the identity the article tables key on", () => {
		const id = ArticleResourceUniqueId.parse(mintPrivateItemUrl(UPLOAD_ID));

		assert.equal(id.value, `uploads.readplace.invalid/${HEX}`);
	});
});

describe("PrivateItemUrlSchema", () => {
	it("refuses a URL that does not hold an upload id", () => {
		assert.equal(PrivateItemUrlSchema.safeParse("https://uploads.readplace.invalid/x").success, false);
	});

	it("refuses another host", () => {
		assert.equal(PrivateItemUrlSchema.safeParse(`https://example.com/${HEX}`).success, false);
	});

	it.each([
		["plain http", `http://uploads.readplace.invalid/${HEX}`],
		["a trailing path", `https://uploads.readplace.invalid/${HEX}/x`],
		["uppercase hex", `https://uploads.readplace.invalid/${"A".repeat(32)}`],
	])("refuses %s", (_case, url) => {
		assert.equal(PrivateItemUrlSchema.safeParse(url).success, false);
	});
});

describe("uploadIdOfPrivateItemUrl", () => {
	it("returns the upload id the URL was minted from", () => {
		assert.equal(uploadIdOfPrivateItemUrl(mintPrivateItemUrl(UPLOAD_ID)), UPLOAD_ID);
	});
});

describe("isPrivateItemIdentity", () => {
	const identityOf = (url: string) => ArticleResourceUniqueId.parse(url);

	it("is true for a minted private URL", () => {
		assert.equal(isPrivateItemIdentity(identityOf(mintPrivateItemUrl(UPLOAD_ID))), true);
	});

	it("is true for a URL that differs only by scheme", () => {
		assert.equal(isPrivateItemIdentity(identityOf(`http://uploads.readplace.invalid/${HEX}`)), true);
	});

	it("is true for a URL whose identity keeps a port", () => {
		assert.equal(isPrivateItemIdentity(identityOf(`http://uploads.readplace.invalid:8080/${HEX}`)), true);
	});

	it("is false for an ordinary host", () => {
		assert.equal(isPrivateItemIdentity(identityOf("https://example.com/article")), false);
	});

	it("is false for a host that only begins with the private host", () => {
		assert.equal(isPrivateItemIdentity(identityOf("https://uploads.readplace.invalid.example.com/x")), false);
	});

	it("is false for a path that names the private host", () => {
		assert.equal(isPrivateItemIdentity(identityOf("https://example.com/uploads.readplace.invalid")), false);
	});
});
