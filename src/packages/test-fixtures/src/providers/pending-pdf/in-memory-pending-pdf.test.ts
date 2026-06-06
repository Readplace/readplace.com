import { initInMemoryPendingPdf } from "./in-memory-pending-pdf";

describe("initInMemoryPendingPdf", () => {
	it("stores bytes under the URL's pending-pdf key and reads them back", async () => {
		const { putPendingPdf, readPendingPdfSync, readPendingPdf } = initInMemoryPendingPdf();
		const bytes = Buffer.from("%PDF-1.4 fake");

		await putPendingPdf({ url: "https://example.com/x.pdf", bytes });

		expect(readPendingPdfSync("https://example.com/x.pdf")).toEqual(bytes);
		await expect(readPendingPdf("https://example.com/x.pdf")).resolves.toEqual(bytes);
	});

	it("treats different schemes of the same canonical URL as the same key", async () => {
		const { putPendingPdf, readPendingPdfSync } = initInMemoryPendingPdf();
		const bytes = Buffer.from("%PDF-1.4 fake");

		await putPendingPdf({ url: "https://example.com/x.pdf", bytes });

		expect(readPendingPdfSync("http://example.com/x.pdf")).toEqual(bytes);
	});

	it("readPendingPdfSync returns undefined for an unknown URL", () => {
		const { readPendingPdfSync } = initInMemoryPendingPdf();
		expect(readPendingPdfSync("https://example.com/never-saved.pdf")).toBeUndefined();
	});

	it("readPendingPdf rejects when no bytes have been stored", async () => {
		const { readPendingPdf } = initInMemoryPendingPdf();
		await expect(readPendingPdf("https://example.com/never-saved.pdf")).rejects.toThrow(
			"pending-pdf missing for https://example.com/never-saved.pdf",
		);
	});

	it("overwrites existing bytes for the same URL", async () => {
		const { putPendingPdf, readPendingPdfSync } = initInMemoryPendingPdf();

		await putPendingPdf({ url: "https://example.com/x.pdf", bytes: Buffer.from("v1") });
		await putPendingPdf({ url: "https://example.com/x.pdf", bytes: Buffer.from("v2") });

		expect(readPendingPdfSync("https://example.com/x.pdf")).toEqual(Buffer.from("v2"));
	});
});
