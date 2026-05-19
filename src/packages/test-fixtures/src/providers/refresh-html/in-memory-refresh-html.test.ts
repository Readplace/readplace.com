import { initInMemoryRefreshHtml } from "./in-memory-refresh-html";

describe("initInMemoryRefreshHtml", () => {
	it("stores html under the URL's refresh-html key and reads it back", async () => {
		const { putRefreshHtml, readRefreshHtml } = initInMemoryRefreshHtml();

		await putRefreshHtml({ url: "https://example.com/article", html: "<html>refreshed</html>" });

		expect(await readRefreshHtml("https://example.com/article")).toBe("<html>refreshed</html>");
	});

	it("treats different schemes of the same canonical URL as the same key", async () => {
		const { putRefreshHtml, readRefreshHtml } = initInMemoryRefreshHtml();

		await putRefreshHtml({ url: "https://example.com/article", html: "<html>refreshed</html>" });

		expect(await readRefreshHtml("http://example.com/article")).toBe("<html>refreshed</html>");
	});

	it("throws when no html has been staged for the URL so a misordered put/read surfaces as a Lambda failure", async () => {
		const { readRefreshHtml } = initInMemoryRefreshHtml();
		await expect(readRefreshHtml("https://example.com/never-staged")).rejects.toThrow(
			"No refresh-html staged for URL: https://example.com/never-staged",
		);
	});

	it("overwrites existing html for the same URL so a re-refresh wins over the stale entry", async () => {
		const { putRefreshHtml, readRefreshHtml } = initInMemoryRefreshHtml();

		await putRefreshHtml({ url: "https://example.com/article", html: "<html>v1</html>" });
		await putRefreshHtml({ url: "https://example.com/article", html: "<html>v2</html>" });

		expect(await readRefreshHtml("https://example.com/article")).toBe("<html>v2</html>");
	});
});
