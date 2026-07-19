import { isPdfViewerDocument } from "./is-pdf-viewer-document";

describe("isPdfViewerDocument", () => {
	it("detects a tab served directly as application/pdf", () => {
		expect(isPdfViewerDocument({ contentType: "application/pdf" })).toBe(true);
	});

	it("treats an HTML document as not a native PDF viewer", () => {
		expect(isPdfViewerDocument({ contentType: "text/html" })).toBe(false);
	});
});
