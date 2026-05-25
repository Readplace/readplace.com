import { importErrorMessageMapping } from "./import.error";

describe("importErrorMessageMapping", () => {
	it("returns undefined when error_code is absent", () => {
		expect(importErrorMessageMapping({})).toBeUndefined();
	});

	it("returns undefined when error_code is not a string", () => {
		expect(importErrorMessageMapping({ error_code: 42 })).toBeUndefined();
	});

	it("returns undefined for an unknown error code", () => {
		expect(importErrorMessageMapping({ error_code: "save_failed" })).toBeUndefined();
	});

	it("maps import_too_large to the 5 MiB / contact fallback message", () => {
		expect(importErrorMessageMapping({ error_code: "import_too_large" })).toBe(
			"That file is too large. The limit is 5 MiB — please get in touch at readplace+migrate@readplace.com to increase the limit.",
		);
	});

	it("maps import_no_urls to the no-links message", () => {
		expect(importErrorMessageMapping({ error_code: "import_no_urls" })).toBe(
			"We couldn't find any links in that file.",
		);
	});

	it("maps import_session_not_found to the expired-session message", () => {
		expect(importErrorMessageMapping({ error_code: "import_session_not_found" })).toBe(
			"That import session has expired. Please upload the file again.",
		);
	});

	it("maps import_url_invalid to the private-network message", () => {
		expect(importErrorMessageMapping({ error_code: "import_url_invalid" })).toBe(
			"That URL can't be crawled — Readplace blocks private-network and non-http(s) addresses.",
		);
	});

	it("maps import_url_fetch_failed to the can't-fetch message", () => {
		expect(importErrorMessageMapping({ error_code: "import_url_fetch_failed" })).toBe(
			"We couldn't fetch that page. It might be down, blocking automated requests, or returned an error. If the page is slow, try saving its HTML and using the upload tab.",
		);
	});

	it("maps import_url_unsupported to the non-HTML message", () => {
		expect(importErrorMessageMapping({ error_code: "import_url_unsupported" })).toBe(
			"That URL doesn't point at an HTML page. Paste a link to an article index or newsletter web view.",
		);
	});

	it("maps import_url_too_large to the too-large message", () => {
		expect(importErrorMessageMapping({ error_code: "import_url_too_large" })).toBe(
			"That page is too large to scan for links.",
		);
	});
});
