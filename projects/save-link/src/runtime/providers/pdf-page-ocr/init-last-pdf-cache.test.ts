import { initLastPdfCache } from "./init-last-pdf-cache";

describe("initLastPdfCache", () => {
	it("returns the underlying download on a cold call", async () => {
		const calls: string[] = [];
		const { downloadStagedPdf } = initLastPdfCache({
			downloadStagedPdf: async ({ key }) => {
				calls.push(key);
				return Buffer.from(`pdf:${key}`);
			},
		});

		const buf = await downloadStagedPdf({ key: "pdf-rasterise-staging/abc/source.pdf" });

		expect(buf.toString()).toBe("pdf:pdf-rasterise-staging/abc/source.pdf");
		expect(calls).toEqual(["pdf-rasterise-staging/abc/source.pdf"]);
	});

	it("returns the cached buffer without calling the underlying download on a same-key re-read", async () => {
		const calls: string[] = [];
		const { downloadStagedPdf } = initLastPdfCache({
			downloadStagedPdf: async ({ key }) => {
				calls.push(key);
				return Buffer.from(`pdf:${key}`);
			},
		});

		const first = await downloadStagedPdf({ key: "pdf-rasterise-staging/abc/source.pdf" });
		const second = await downloadStagedPdf({ key: "pdf-rasterise-staging/abc/source.pdf" });

		expect(first.equals(second)).toBe(true);
		expect(first).toBe(second);
		expect(calls).toEqual(["pdf-rasterise-staging/abc/source.pdf"]);
	});

	it("evicts the previous entry and re-downloads when the key changes", async () => {
		const calls: string[] = [];
		const { downloadStagedPdf } = initLastPdfCache({
			downloadStagedPdf: async ({ key }) => {
				calls.push(key);
				return Buffer.from(`pdf:${key}`);
			},
		});

		await downloadStagedPdf({ key: "pdf-rasterise-staging/abc/source.pdf" });
		await downloadStagedPdf({ key: "pdf-rasterise-staging/xyz/source.pdf" });
		await downloadStagedPdf({ key: "pdf-rasterise-staging/abc/source.pdf" });

		expect(calls).toEqual([
			"pdf-rasterise-staging/abc/source.pdf",
			"pdf-rasterise-staging/xyz/source.pdf",
			"pdf-rasterise-staging/abc/source.pdf",
		]);
	});

	it("does not cache a failed underlying download — the next call re-issues", async () => {
		let attempt = 0;
		const { downloadStagedPdf } = initLastPdfCache({
			downloadStagedPdf: async ({ key }) => {
				attempt += 1;
				if (attempt === 1) throw new Error("S3 transient");
				return Buffer.from(`pdf:${key}`);
			},
		});

		await expect(downloadStagedPdf({ key: "k" })).rejects.toThrow("S3 transient");
		const buf = await downloadStagedPdf({ key: "k" });

		expect(buf.toString()).toBe("pdf:k");
		expect(attempt).toBe(2);
	});
});
