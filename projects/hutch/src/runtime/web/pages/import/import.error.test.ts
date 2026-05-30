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
});
