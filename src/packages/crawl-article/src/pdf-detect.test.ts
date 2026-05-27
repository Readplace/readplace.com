import { isPDF } from "./pdf-detect";

describe("isPDF — contentType signal", () => {
	it("returns true for application/pdf", () => {
		expect(isPDF({ contentType: "application/pdf" })).toBe(true);
	});

	it("returns true for application/pdf with charset suffix", () => {
		expect(isPDF({ contentType: "application/pdf; charset=utf-8" })).toBe(true);
	});

	it("returns true for the legacy application/x-pdf alias", () => {
		expect(isPDF({ contentType: "application/x-pdf" })).toBe(true);
	});

	it("returns false for application/octet-stream", () => {
		expect(isPDF({ contentType: "application/octet-stream" })).toBe(false);
	});

	it("returns false for text/html", () => {
		expect(isPDF({ contentType: "text/html" })).toBe(false);
	});

	it("returns false when contentType is an empty string", () => {
		expect(isPDF({ contentType: "" })).toBe(false);
	});
});

describe("isPDF — bodyBytes signal", () => {
	it("returns true when buffer starts with %PDF-", () => {
		expect(isPDF({ bodyBytes: Buffer.from("%PDF-1.4\n...") })).toBe(true);
	});

	it("returns false when buffer starts with PDF- (missing leading percent)", () => {
		expect(isPDF({ bodyBytes: Buffer.from("PDF-1.4\n") })).toBe(false);
	});

	it("returns false for HTML body", () => {
		expect(isPDF({ bodyBytes: Buffer.from("<!DOCTYPE html><html>...") })).toBe(false);
	});

	it("returns false for an empty buffer", () => {
		expect(isPDF({ bodyBytes: Buffer.alloc(0) })).toBe(false);
	});

	it("returns false for a buffer shorter than the magic prefix", () => {
		expect(isPDF({ bodyBytes: Buffer.from("%PD") })).toBe(false);
	});

	it("returns false when %PDF- appears later in the buffer, not at offset 0", () => {
		expect(isPDF({ bodyBytes: Buffer.from("garbage%PDF-...") })).toBe(false);
	});
});

describe("isPDF — pathname signal", () => {
	it("returns true for a pathname ending in .pdf", () => {
		expect(isPDF({ pathname: "/docs/report.pdf" })).toBe(true);
	});

	it("returns true for an uppercase .PDF suffix", () => {
		expect(isPDF({ pathname: "/docs/REPORT.PDF" })).toBe(true);
	});

	it("returns true for a pathname with percent-encoded segments preceding .pdf", () => {
		expect(isPDF({ pathname: "/docs/COMPUTERS%20AND%20AUTOMATION%20[16505689].pdf" })).toBe(true);
	});

	it("returns false for a pathname without .pdf suffix", () => {
		expect(isPDF({ pathname: "/articles/example-post" })).toBe(false);
	});

	it("returns false when .pdf appears mid-string but not at the end", () => {
		expect(isPDF({ pathname: "/docs/report.pdf/preview" })).toBe(false);
	});

	it("returns false for the root pathname", () => {
		expect(isPDF({ pathname: "/" })).toBe(false);
	});

	it("returns false for the empty string", () => {
		expect(isPDF({ pathname: "" })).toBe(false);
	});
});

describe("isPDF — composite signals", () => {
	it("returns true when any one signal matches (contentType matches, others don't)", () => {
		expect(isPDF({
			contentType: "application/pdf",
			bodyBytes: Buffer.from("<!DOCTYPE html>"),
			pathname: "/article",
		})).toBe(true);
	});

	it("returns true when only the body bytes signal matches", () => {
		expect(isPDF({
			contentType: "application/octet-stream",
			bodyBytes: Buffer.from("%PDF-1.7"),
		})).toBe(true);
	});

	it("returns false when no signal is provided (empty input)", () => {
		expect(isPDF({})).toBe(false);
	});

	it("returns false when every provided signal is non-PDF", () => {
		expect(isPDF({
			contentType: "text/html",
			bodyBytes: Buffer.from("<!DOCTYPE html>"),
			pathname: "/about",
		})).toBe(false);
	});
});
