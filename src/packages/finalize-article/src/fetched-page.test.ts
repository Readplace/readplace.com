import { SaveAttemptIdSchema } from "@packages/domain/article";
import { finalizeInputOfFetchedPage } from "./fetched-page";

const writeContext = { url: "https://saved.example/a", attemptId: SaveAttemptIdSchema.parse("attempt") };
const thumbnail = { image: undefined, provenUnusable: [], fetched: [] };

describe("finalizeInputOfFetchedPage", () => {
	it("reads a redirected page from where the fetch landed", () => {
		expect(
			finalizeInputOfFetchedPage({
				savedUrl: "https://saved.example/a",
				requestedUrl: "https://short.example/x",
				writeContext,
				fetched: { html: "<p>body</p>", finalUrl: "https://publisher.example/a", thumbnail, mediaType: "image" },
			}),
		).toEqual({
			writeContext,
			url: "https://saved.example/a",
			documentUrl: "https://publisher.example/a",
			html: "<p>body</p>",
			resolvedThumbnail: thumbnail,
			mediaType: "image",
		});
	});

	it("reads a page that did not redirect from the requested URL and keeps its plain text", () => {
		expect(
			finalizeInputOfFetchedPage({
				savedUrl: "https://saved.example/a",
				requestedUrl: "https://short.example/x",
				fetched: { html: "", mediaType: "plain-text", plainText: "text" },
			}),
		).toEqual({
			writeContext: undefined,
			url: "https://saved.example/a",
			documentUrl: "https://short.example/x",
			html: "",
			resolvedThumbnail: undefined,
			mediaType: "plain-text",
			plainText: "text",
		});
	});
});
