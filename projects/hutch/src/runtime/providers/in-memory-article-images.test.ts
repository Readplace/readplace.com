import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { initFinalizeArticle } from "@packages/finalize-article";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { initInMemoryArticleImages } from "./in-memory-article-images";

const ORIGIN = "http://localhost:3000";
const URL = "https://example.com/a/b.png?variant=a%2Fb&size=2";
const RESOURCE_PATH = "/content/example.com%252Fa%252Fb.png%253Fsize%253D2%2526variant%253Da%25252Fb/images/";

describe("in-memory article image hosting", () => {
	it.each([false, true])("serves the finalizer's exact CDN URL with attempt scoping %s", async (scoped) => {
		const images = initInMemoryArticleImages();
		const app = express().use(images.router);
		const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const finalizeArticle = initFinalizeArticle({
			parseHtml: jest.fn(), downloadMedia: jest.fn(), processContent: jest.fn(), fetchThumbnailImage: jest.fn(),
			putImageObject: images.putImageObject, imagesCdnBaseUrl: ORIGIN,
		});
		const result = await finalizeArticle({
			url: URL,
			documentUrl: URL,
			html: "",
			mediaType: "image",
			writeContext: scoped ? { url: URL, attemptId: SaveAttemptIdSchema.parse("local-attempt") } : undefined,
			resolvedThumbnail: { image: { url: URL, body, contentType: "image/png", extension: ".png" }, provenUnusable: [] },
		});

		assert(result.ok);
		const imageUrl = result.article.metadata.imageUrl;
		assert(imageUrl !== undefined);
		expect(imageUrl.startsWith(`${ORIGIN}${RESOURCE_PATH}`)).toBe(true);
		const filename = imageUrl.slice(`${ORIGIN}${RESOURCE_PATH}`.length);
		expect(filename).toMatch(scoped ? /^attempts\/[a-f0-9]{64}\/[a-f0-9]{64}\.png$/ : /^[a-f0-9]{16}\.png$/);
		expect(result.article.metadata.directResourceKind).toBe("image");

		const response = await request(app).get(imageUrl.slice(ORIGIN.length));

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("image/png");
		expect(response.body).toEqual(body);
	});

	it("returns 404 when the requested image has not been hosted", async () => {
		const images = initInMemoryArticleImages();
		const app = express().use(images.router);

		const response = await request(app).get(`${RESOURCE_PATH}missing.png`);

		expect(response.status).toBe(404);
	});
});
