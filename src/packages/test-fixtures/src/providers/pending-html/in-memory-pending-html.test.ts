import { SaveAttemptIdSchema } from "@packages/domain/article";
import { initInMemoryPendingHtml } from "./in-memory-pending-html";

const saveAttemptId = SaveAttemptIdSchema.parse("attempt-1");

describe("initInMemoryPendingHtml", () => {
	it("stores html under the URL's pending-html key and reads it back", async () => {
		const { putPendingHtml, readPendingHtml } = initInMemoryPendingHtml();

		await putPendingHtml({ url: "https://example.com/article", saveAttemptId, html: "<html>captured</html>" });

		expect(readPendingHtml("https://example.com/article", { saveAttemptId })).toBe("<html>captured</html>");
	});

	it("treats different schemes of the same canonical URL as the same key", async () => {
		const { putPendingHtml, readPendingHtml } = initInMemoryPendingHtml();

		await putPendingHtml({ url: "https://example.com/article", saveAttemptId, html: "<html>captured</html>" });

		expect(readPendingHtml("http://example.com/article", { saveAttemptId })).toBe("<html>captured</html>");
	});

	it("returns undefined when no html has been stored for the URL", () => {
		const { readPendingHtml } = initInMemoryPendingHtml();
		expect(readPendingHtml("https://example.com/never-saved", { saveAttemptId })).toBeUndefined();
	});

	it("overwrites existing html for the same URL", async () => {
		const { putPendingHtml, readPendingHtml } = initInMemoryPendingHtml();

		await putPendingHtml({ url: "https://example.com/article", saveAttemptId, html: "<html>v1</html>" });
		await putPendingHtml({ url: "https://example.com/article", saveAttemptId, html: "<html>v2</html>" });

		expect(readPendingHtml("https://example.com/article", { saveAttemptId })).toBe("<html>v2</html>");
	});
});
