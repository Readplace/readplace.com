import { initEventBridgeRefreshArticleContent } from "./eventbridge-refresh-article-content";

const PARAMS = {
	url: "https://example.com/article",
	html: "<html><body><h1>Refreshed</h1></body></html>",
	metadata: {
		title: "Refreshed",
		siteName: "example.com",
		excerpt: "An excerpt",
		wordCount: 250,
	},
	estimatedReadTime: 2,
	etag: '"new-etag"',
	lastModified: "Sun, 10 May 2026 12:00:00 GMT",
	contentFetchedAt: "2026-05-10T12:00:00.000Z",
};

describe("initEventBridgeRefreshArticleContent (put HTML to S3 then publish event without HTML)", () => {
	it("stages the HTML in S3 via putRefreshHtml before publishing the event", async () => {
		const order: string[] = [];
		const putRefreshHtml = jest.fn(async () => {
			order.push("putRefreshHtml");
		});
		const publishEvent = jest.fn(async () => {
			order.push("publishEvent");
		});

		const { publishRefreshArticleContent } = initEventBridgeRefreshArticleContent({
			publishEvent,
			putRefreshHtml,
		});

		await publishRefreshArticleContent(PARAMS);

		expect(order).toEqual(["putRefreshHtml", "publishEvent"]);
		expect(putRefreshHtml).toHaveBeenCalledWith({ url: PARAMS.url, html: PARAMS.html });
	});

	it("publishes the event with no html in detail so the payload stays under EventBridge's 256 KB cap", async () => {
		const putRefreshHtml = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { publishRefreshArticleContent } = initEventBridgeRefreshArticleContent({
			publishEvent,
			putRefreshHtml,
		});

		await publishRefreshArticleContent(PARAMS);

		expect(publishEvent).toHaveBeenCalledTimes(1);
		const call = publishEvent.mock.calls[0][0];
		expect(call.source).toBe("hutch.api");
		expect(call.detailType).toBe("RefreshArticleContentCommand");
		const detail = JSON.parse(call.detail);
		expect(detail).toEqual({
			url: PARAMS.url,
			metadata: PARAMS.metadata,
			estimatedReadTime: PARAMS.estimatedReadTime,
			etag: PARAMS.etag,
			lastModified: PARAMS.lastModified,
			contentFetchedAt: PARAMS.contentFetchedAt,
		});
		expect(detail.html).toBeUndefined();
	});

	it("does not publish when putRefreshHtml rejects so the consumer never reads a missing S3 object", async () => {
		const putRefreshHtml = jest.fn().mockRejectedValue(new Error("s3 throttled"));
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { publishRefreshArticleContent } = initEventBridgeRefreshArticleContent({
			publishEvent,
			putRefreshHtml,
		});

		await expect(publishRefreshArticleContent(PARAMS)).rejects.toThrow("s3 throttled");
		expect(publishEvent).not.toHaveBeenCalled();
	});
});
