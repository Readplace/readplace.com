import { createE2EFixturePdf } from "./e2e-fixture-pdf";

describe("createE2EFixturePdf", () => {
	it("starts with the PDF-1.4 header and the binary marker", () => {
		const buffer = createE2EFixturePdf("HELLO");
		expect(buffer.toString("binary", 0, 8)).toBe("%PDF-1.4");
	});

	it("ends with the %%EOF trailer", () => {
		const buffer = createE2EFixturePdf("HELLO");
		expect(buffer.toString("binary").endsWith("%%EOF\n")).toBe(true);
	});

	it("embeds the supplied text as both the page content and the Info dict Title", () => {
		const buffer = createE2EFixturePdf("MARKER_TEXT");
		const body = buffer.toString("binary");
		expect(body).toContain("(MARKER_TEXT) Tj");
		expect(body).toContain("/Title (MARKER_TEXT)");
	});

	it("writes xref offsets that point at the matching N 0 obj markers", () => {
		const buffer = createE2EFixturePdf("MARKER");
		const body = buffer.toString("binary");
		const xrefIndex = body.indexOf("xref\n");
		expect(xrefIndex).toBeGreaterThan(0);

		// xref section layout: "xref\n", "0 N\n", free entry, then one entry per
		// object 1..N. Skip the header lines + the free entry by slicing from 3.
		const xrefLines = body.slice(xrefIndex).split("\n").slice(3, 9);
		xrefLines.forEach((entry, i) => {
			const objectNumber = i + 1;
			const offset = Number(entry.slice(0, 10));
			const markerAtOffset = body.slice(offset, offset + `${objectNumber} 0 obj`.length);
			expect(markerAtOffset).toBe(`${objectNumber} 0 obj`);
		});
	});

	it("declares the correct /Length for the content stream", () => {
		const buffer = createE2EFixturePdf("X");
		const body = buffer.toString("binary");
		const streamMatch = body.match(/<<\/Length (\d+)>>\nstream\n([\s\S]*?)\nendstream/);
		expect(streamMatch).not.toBeNull();
		if (!streamMatch) return;
		const declaredLength = Number(streamMatch[1]);
		const actualLength = Buffer.byteLength(`${streamMatch[2]}\n`, "binary");
		expect(declaredLength).toBe(actualLength);
	});

	it("rejects text containing non-printable ASCII", () => {
		expect(() => createE2EFixturePdf("hello\x00world")).toThrow(/printable ASCII/);
	});

	it("rejects text containing PDF literal-string metacharacters", () => {
		expect(() => createE2EFixturePdf("hi (there)")).toThrow(/\(, \), or \\/);
		expect(() => createE2EFixturePdf("back\\slash")).toThrow(/\(, \), or \\/);
	});
});
