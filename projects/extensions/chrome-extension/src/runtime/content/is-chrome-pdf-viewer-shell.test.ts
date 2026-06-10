import { isChromePdfViewerShell } from "./is-chrome-pdf-viewer-shell";

describe("isChromePdfViewerShell", () => {
	it("detects Chrome's built-in PDF viewer by its embedder fingerprint", () => {
		const selectorsSeen: string[] = [];
		const result = isChromePdfViewerShell({
			querySelector: (selectors) => {
				selectorsSeen.push(selectors);
				return selectors.includes("mhjfbmdgcfjbbpaeojofohoefgiehjai") ? {} : null;
			},
		});
		expect(result).toBe(true);
		expect(selectorsSeen[0]).toContain("mhjfbmdgcfjbbpaeojofohoefgiehjai");
	});

	it("returns false for an ordinary page with no viewer markers", () => {
		expect(isChromePdfViewerShell({ querySelector: () => null })).toBe(false);
	});
});
